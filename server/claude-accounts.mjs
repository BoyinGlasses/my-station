// Claude Code multi-account discovery, OAuth plan usage polling, account switching, editor wrapper, and session moves.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createAutoResume } from './auto-resume.mjs';
import { editorByDot, claudeEditorSettings } from './editors.mjs';

const PLAN_NAME = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const SHARED = ['projects', 'sessions', 'ide', 'plugins', 'skills', 'agents', 'commands', 'output-styles', 'file-history', 'todos', 'plans', 'settings.json', 'CLAUDE.md', 'keybindings.json'];
const WRAP_KEY = 'claudeCode.claudeProcessWrapper';
const SID_RE = /^[0-9a-f-]{36}$/i;
const PARK_MS = 24 * 3600e3;
const FULL_PCT = 98;
const RENEW_EVERY = 6 * 3600e3;

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const slugOf = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');

async function fetchOauthUsage(accessToken) {
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 429) return { ok: false, status: 429, retryAfter: Number(r.headers.get('retry-after')) || 0 };
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, body: await r.json() };
  } catch { return { ok: false, offline: true }; }
}

export function createClaudeAccounts({
  root, dataDir, port, home, claudeDir, prefs, osAdapter, findClaude,
  sysSnapshot, sysAction, sessions, pending, chat, pub, broadcast, watching, actionLog, tr,
}) {
  const tilde = (p) => (!p ? '' : p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);
  const LIMITS_FILE = path.join(dataDir, 'limits.json');
  const ACCOUNT_FILE = process.env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const NOW_FILE = path.join(dataDir, 'account-now');
  const SWITCH_FILE = path.join(dataDir, 'claude-switch.sh');
  const CLOSING_DIR = path.join(dataDir, 'closing');
  const PIN_DIR = path.join(dataDir, 'resume-on');
  const OTHERS_FILE = path.join(dataDir, 'others-usage.json');

  let planLimits = null;
  try { planLimits = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8')); } catch { /* none yet */ }
  let planBusy = null, usageNote = null, usageWait = 0, usageBackoff = 0;
  const noteText = () => (usageNote ? tr(...usageNote) : '');

  const hits = new Map();
  let nowDir = '', modelAt = 0, modelNow = '', editorsNow = [], switchAlias = '';
  try { nowDir = fs.readFileSync(NOW_FILE, 'utf8').split('\n')[0].trim(); } catch { /* the main account */ }
  let otherDirs = [];
  const others = new Map();
  const otherBusy = new Map();
  try { for (const [d, o] of Object.entries(JSON.parse(fs.readFileSync(OTHERS_FILE, 'utf8')))) others.set(d, { ...o }); } catch { /* none yet */ }

  const accName = (d) => clip(path.basename(d).replace(/^\.claude-?/, '') || path.basename(d), 16);
  const loggedIn = (d) => { try { return !!JSON.parse(fs.readFileSync(path.join(d, '.claude.json'), 'utf8')).oauthAccount; } catch { return false; } };
  const winLabel = (w) => clip(String(w.key === 'session' ? tr('server.limits.fiveHour') : w.key === 'weekly' ? tr('server.limits.week') : w.weekOf ? tr('server.limits.modelWeek', { model: w.weekOf }) : w.label), 30);

  function loginAccount(login, file = ACCOUNT_FILE) {
    let a = {}; try { a = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount || {}; } catch { /* not logged in */ }
    const plan = PLAN_NAME[String(login?.subscriptionType || '').toLowerCase()] || (login?.subscriptionType ? String(login.subscriptionType) : '');
    const org = String(a.organizationName || '');
    const personal = !org || org.includes('@') || /'s Organi[sz]ation$/i.test(org);
    return { id: `${a.accountUuid || ''}:${a.organizationUuid || ''}`, plan, org: personal ? '' : clip(org, 40) };
  }

  function loginMissingNote() {
    let signedIn = false;
    try { signedIn = !!JSON.parse(fs.readFileSync(process.env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json'), 'utf8')).oauthAccount; } catch { /* none */ }
    if (signedIn) return ['server.usage.keychain'];
    return [otherDirs.length ? 'server.usage.mainSignedOutOthers' : 'server.usage.mainSignedOut', { dir: tilde(claudeDir) }];
  }

  function usageWindows(j) {
    const out = [], iso = (t) => (t ? Date.parse(t) || null : null);
    for (const l of Array.isArray(j.limits) ? j.limits : []) {
      if (typeof l?.percent !== 'number') continue;
      const model = l.scope?.model?.display_name, kind = String(l.kind || ''), group = String(l.group || '');
      const session = kind === 'session' || /five|5h|session/i.test(kind), weekly = !session && (group === 'weekly' || /week|seven|7d/i.test(kind));
      const key = session ? 'session' : weekly && !model ? 'weekly' : `${kind}:${model || group}`;
      const w = { key, label: model || group || kind, pct: l.percent, resetsAt: iso(l.resets_at), active: l.is_active !== false, ...(weekly && model ? { weekOf: model } : {}) };
      out.push({ ...w, label: winLabel(w) });
    }
    const has = (k) => out.some((w) => w.key === k);
    if (!has('session') && typeof j.five_hour?.utilization === 'number') out.unshift({ key: 'session', label: tr('server.limits.fiveHour'), pct: j.five_hour.utilization, resetsAt: iso(j.five_hour.resets_at) });
    if (!has('weekly') && typeof j.seven_day?.utilization === 'number') out.push({ key: 'weekly', label: tr('server.limits.week'), pct: j.seven_day.utilization, resetsAt: iso(j.seven_day.resets_at) });
    for (const [k, name] of [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet']]) {
      if (typeof j[k]?.utilization !== 'number' || out.some((w) => w.weekOf === name)) continue;
      out.push({ key: `weekly:${name}`, label: tr('server.limits.modelWeek', { model: name }), weekOf: name, pct: j[k].utilization, resetsAt: iso(j[k].resets_at) });
    }
    return out;
  }

  function setLimits(windows, source, account = planLimits?.account || null) {
    const next = { at: Date.now(), source, windows, account, five: windows.find((w) => w.key === 'session') || null, seven: windows.find((w) => w.key === 'weekly') || null };
    const sig = (l) => JSON.stringify(l?.windows?.map((w) => [w.key, w.pct, w.resetsAt]) || null);
    const moved = sig(planLimits) !== sig(next);
    planLimits = next;
    if (moved) { broadcast({ k: 'limits', limits: limitsOut(), note: '' }); repick(); }
    fsp.writeFile(LIMITS_FILE, JSON.stringify(planLimits)).catch(() => {});
  }

  function acctLabel(slug) { return clip(String(prefs.get('accountNames')?.[slug] || ''), 24); }
  function acctShown(slug) { return acctLabel(slug) || slug || tr('server.account.main'); }
  function mainModel() {
    if (Date.now() - modelAt > 60e3) { modelAt = Date.now(); try { modelNow = String(JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')).model || '').toLowerCase(); } catch { modelNow = ''; } }
    return modelNow;
  }
  function blockedUntil(windows, hit = 0) {
    const now = Date.now(), model = mainModel();
    let until = hit > now ? hit : 0;
    for (const w of windows || []) {
      if (!(w.pct >= FULL_PCT) || (w.resetsAt && w.resetsAt <= now)) continue;
      if (w.key === 'session' || w.key === 'weekly' || (w.weekOf && model.includes(String(w.weekOf).toLowerCase()))) until = Math.max(until, w.resetsAt || now + 15 * 60e3);
    }
    return until;
  }
  const dirOfSlug = (slug) => otherDirs.find((d) => accName(d) === slug) || '';
  const nowSlug = () => { const d = nowDir && otherDirs.find((x) => path.resolve(x) === path.resolve(nowDir)); return d ? accName(d) : ''; };
  function orderOf() {
    const all = ['', ...otherDirs.map(accName)], pick = prefs.get('accountPick');
    const saved = (prefs.get('accountOrder') || (pick ? [pick] : [])).filter((s) => all.includes(s));
    return [...new Set([...saved, ...all])];
  }
  const pickSlug = () => orderOf()[0] || '';
  const switching = () => !!prefs.get('autoSwitch') || !!pickSlug();
  function writeNow(dir) {
    nowDir = dir;
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(NOW_FILE, `${dir}\n`); } catch { /* read-only data */ }
  }

  const dead = (login) => !!login?.expiresAt && login.expiresAt < Date.now();
  const renewing = new Map();
  function refreshLogin(dir) {
    if (renewing.has(dir)) return renewing.get(dir);
    const bin = findClaude();
    if (!bin) return Promise.resolve(false);
    const cwd = path.join(dataDir, 'renew');
    try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* best effort */ }
    const run = new Promise((resolve) => {
      const child = execFile(bin.file, [...(bin.args || []), '-p', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--tools', '', '--settings', '{"disableAllHooks":true}', 'Reply with the single word: ok'],
        { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, timeout: 90_000, maxBuffer: 1 << 20, windowsHide: true }, (err) => resolve(!err));
      child.stdin?.end();
    }).then(async (ok) => {
      const now = await osAdapter.claudeLogin(dir).catch(() => null);
      fsp.appendFile(actionLog, `${new Date().toISOString()} renew login ${accName(dir)} -> ${now?.accessToken && !dead(now) ? 'renewed' : 'failed'}${ok ? '' : ' (its run ended in an error)'}\n`).catch(() => {});
      return ok;
    }).finally(() => renewing.delete(dir));
    renewing.set(dir, run);
    return run;
  }

  function saveOthers() {
    const keep = Object.fromEntries([...others].filter(([, o]) => o.windows).map(([d, o]) => [d, { windows: o.windows, at: o.at, account: o.account }]));
    fsp.writeFile(OTHERS_FILE, JSON.stringify(keep)).catch(() => {});
  }

  function fetchPlanUsage(force = false) {
    if (process.env.OFFICE_USAGE === '0') return Promise.resolve();
    if (Date.now() < usageWait || (!force && planLimits?.source === 'api' && Date.now() - planLimits.at < 110_000)) return Promise.resolve();
    return (planBusy ??= (async () => {
      const login = await osAdapter.claudeLogin();
      if (!login?.accessToken) { usageNote = loginMissingNote(); return; }
      const res = await fetchOauthUsage(login.accessToken);
      if (res.offline) { usageNote = ['server.usage.offline']; }
      else if (res.status === 429) {
        usageBackoff = Math.min(30, (usageBackoff || 2.5) * 2);
        usageWait = Date.now() + Math.max(usageBackoff * 60e3, res.retryAfter * 1000);
        usageNote = ['server.usage.rateLimited', { n: usageBackoff }];
        return;
      } else if (!res.ok) {
        usageNote = res.status === 401 ? ['server.usage.expired'] : ['server.usage.httpError', { status: res.status }];
        return;
      } else {
        usageBackoff = 0;
        const body = res.body;
        try { fs.writeFileSync(path.join(dataDir, 'usage-raw.json'), JSON.stringify({ at: Date.now(), plan: loginAccount(login).plan, keys: Object.keys(body || {}), limits: body?.limits ?? null, five_hour: body?.five_hour ?? null, seven_day: body?.seven_day ?? null, seven_day_opus: body?.seven_day_opus ?? null, seven_day_sonnet: body?.seven_day_sonnet ?? null }, null, 1)); } catch { /* best effort */ }
        usageNote = null;
        setLimits(usageWindows(body), 'api', loginAccount(login));
      }
      if (usageNote) broadcast({ k: 'limits', limits: limitsOut(), note: noteText() });
    })().finally(() => { planBusy = null; }));
  }

  function fetchOtherUsage(dir, force = false) {
    if (process.env.OFFICE_USAGE === '0') return Promise.resolve();
    const o = others.get(dir) || {}; others.set(dir, o);
    if ((!force && o.at && Date.now() - o.at < 290_000) || otherBusy.has(dir)) return Promise.resolve();
    const job = (async () => {
      let login = await osAdapter.claudeLogin(dir);
      if (!login?.accessToken) { o.note = ['server.usage.keychain']; return; }
      if (dead(login)) {
        o.expired = true;
        if (!force && Date.now() - (o.renewAt || 0) < RENEW_EVERY) { o.note = ['server.usage.tokenExpired']; return; }
        o.renewAt = Date.now(); o.note = ['server.usage.renewing']; broadcast({ k: 'limits', limits: limitsOut(), note: noteText() });
        await refreshLogin(dir);
        login = await osAdapter.claudeLogin(dir);
        if (!login?.accessToken || dead(login)) { o.note = ['server.usage.renewFailed']; return; }
        o.expired = false; o.wait = 0; o.backoff = 0;
      }
      if (Date.now() < (o.wait || 0)) return;
      const res = await fetchOauthUsage(login.accessToken);
      if (res.offline) { o.note = ['server.usage.offline']; return; }
      if (res.status === 429) {
        o.backoff = Math.min(30, (o.backoff || 2.5) * 2);
        const ms = Math.max(o.backoff * 60e3, res.retryAfter * 1000);
        o.wait = Date.now() + ms; o.note = ['server.usage.rateLimited', { n: Math.ceil(ms / 60e3) }];
        return;
      }
      if (!res.ok) { o.note = res.status === 401 ? ['server.usage.expired'] : ['server.usage.httpError', { status: res.status }]; return; }
      o.backoff = 0; o.note = null; o.windows = usageWindows(res.body); o.at = Date.now(); o.account = loginAccount(login, path.join(dir, '.claude.json'));
      saveOthers();
    })().finally(() => { otherBusy.delete(dir); broadcast({ k: 'limits', limits: limitsOut(), note: noteText() }); repick(); });
    otherBusy.set(dir, job);
    return job;
  }

  function othersOut() {
    return otherDirs.map((d) => {
      const o = others.get(d) || {}, slug = accName(d);
      return { name: slug, label: acctLabel(slug), until: blockedUntil(o.windows, hits.get(slug)), at: o.at || 0, account: o.account || null, expired: !!o.expired, renewing: renewing.has(d), windows: (o.windows || []).map((w) => ({ ...w, label: winLabel(w) })), note: o.note ? tr(...o.note) : '' };
    });
  }

  function autoOut() {
    return { on: !!prefs.get('autoSwitch'), move: prefs.get('autoMove') !== false, resume: prefs.get('autoResume') !== false, pick: pickSlug(), order: orderOf(), now: nowSlug(), editors: editorsNow, script: SWITCH_FILE, alias: switchAlias, win: process.platform === 'win32' };
  }

  function limitsOut() {
    const l = planLimits, more = othersOut(), main = { label: acctLabel(''), until: blockedUntil(l?.windows, hits.get('')), auto: autoOut() };
    if (!l) return more.length ? { windows: [], others: more, ...main } : l;
    return {
      ...l, windows: Array.isArray(l.windows) ? l.windows.map((w) => ({ ...w, label: winLabel(w) })) : l.windows,
      five: l.five && { ...l.five, label: tr('server.limits.fiveHour') }, seven: l.seven && { ...l.seven, label: tr('server.limits.week') }, others: more, ...main,
    };
  }

  function closingOnPurpose(pids) {
    try { fs.mkdirSync(CLOSING_DIR, { recursive: true }); for (const p of pids) if (p) fs.writeFileSync(path.join(CLOSING_DIR, String(p)), ''); } catch { /* read-only data */ }
  }

  function scanAccounts() {
    const h = os.homedir(), found = new Set();
    for (const d of String(process.env.OFFICE_CLAUDE_DIRS || '').split(path.delimiter).filter(Boolean)) found.add(path.resolve(d.replace(/^~(?=$|[\\/])/, h)));
    try { for (const e of fs.readdirSync(h, { withFileTypes: true })) if (/^\.claude-./.test(e.name) && (e.isDirectory() || e.isSymbolicLink())) found.add(path.join(h, e.name)); } catch { /* no home */ }
    const next = [...found].filter((d) => path.resolve(d) !== path.resolve(claudeDir) && loggedIn(d)).sort();
    if (next.join('|') !== otherDirs.join('|')) {
      otherDirs = next;
      for (const d of others.keys()) if (!next.includes(d)) others.delete(d);
      for (const d of next) fetchOtherUsage(d, true);
      broadcast({ k: 'limits', limits: limitsOut(), note: noteText() });
      repick();
    }
  }

  const acctOf = (s) => { if (s.agent && s.agent !== 'claude') return null; if (s.parked) return s.parked.to; const t = s.transcript || ''; const d = otherDirs.find((x) => t.startsWith(x + path.sep)); return d ? accName(d) : ''; };

  function accountCmd(slug) {
    const bin = findClaude(), cli = !bin || bin.onPath ? 'claude' : `"${bin.file}"`;
    return process.platform === 'win32'
      ? { run: `$env:CLAUDE_CONFIG_DIR="$HOME\\.claude-${slug}"; ${bin && !bin.onPath ? `& ${cli}` : cli}`, alias: `function claude-${slug} { $env:CLAUDE_CONFIG_DIR="$HOME\\.claude-${slug}"; ${bin && !bin.onPath ? `& ${cli}` : cli} @args }` }
      : { run: `CLAUDE_CONFIG_DIR="$HOME/.claude-${slug}" ${cli}`, alias: `alias claude-${slug}='CLAUDE_CONFIG_DIR="$HOME/.claude-${slug}" ${cli}'` };
  }

  const logins = new Map();
  function browserScript() {
    const f = path.join(dataDir, 'open-login.sh');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(f, '#!/bin/sh\n[ -n "$OFFICE_LOGIN_URL_FILE" ] && printf \'%s\\n\' "$1" > "$OFFICE_LOGIN_URL_FILE"\nif command -v open >/dev/null 2>&1; then exec open "$1"; else exec xdg-open "$1"; fi\n', { mode: 0o755 });
    return f;
  }
  const pushLogin = (L) => broadcast({ k: 'acctlogin', name: L.slug, state: L.state, url: L.url || '', note: L.note || '' });
  let watchUntil = 0, watchTimer = null;
  function watchLogins() {
    watchUntil = Date.now() + 15 * 60e3;
    if (watchTimer) return;
    watchTimer = setInterval(() => { scanAccounts(); if (Date.now() > watchUntil) { clearInterval(watchTimer); watchTimer = null; } }, 4000);
    watchTimer.unref();
  }
  function startLogin(slug) {
    const was = logins.get(slug);
    if (was?.state === 'waiting') return was;
    const bin = findClaude();
    if (!bin) return { slug, state: 'failed', note: tr('server.account.noCli') };
    const urlFile = path.join(dataDir, `login-${slug}.url`), env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(os.homedir(), `.claude-${slug}`) };
    try { fs.rmSync(urlFile, { force: true }); } catch { /* none */ }
    if (process.platform !== 'win32') Object.assign(env, { BROWSER: browserScript(), OFFICE_LOGIN_URL_FILE: urlFile });
    const L = { slug, state: 'waiting', url: '', note: '' };
    try { L.child = spawn(bin.file, [...(bin.args || []), 'auth', 'login', '--claudeai'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch { return { slug, state: 'failed', note: tr('server.account.noCli') }; }
    logins.set(slug, L);
    let out = '';
    const seen = (d) => { out = (out + d).slice(-4000); const m = !L.url && /visit:\s*(https:\/\/\S+)/.exec(out); if (m) { L.url = m[1]; pushLogin(L); } };
    L.child.stdout.on('data', seen); L.child.stderr.on('data', seen); L.child.stdin.on('error', () => {});
    const look = setInterval(() => { try { const u = fs.readFileSync(urlFile, 'utf8').trim(); if (u && u !== L.url) { L.url = u; pushLogin(L); } } catch { /* not yet */ } }, 500);
    const stop = setTimeout(() => L.child.kill(), 15 * 60e3);
    L.child.on('error', () => { L.state = 'failed'; L.note = tr('server.account.noCli'); });
    L.child.on('exit', (code) => {
      clearInterval(look); clearTimeout(stop);
      if (L.state === 'waiting') { L.state = code === 0 ? 'done' : 'failed'; if (code !== 0) L.note = clip(oneLine(out.trim().split('\n').filter(Boolean).pop() || ''), 140); }
      scanAccounts(); pushLogin(L);
    });
    watchLogins();
    return L;
  }

  async function prepareAccount(name) {
    const slug = slugOf(name);
    if (!slug) return { ok: false, message: tr('server.account.badName') };
    const dir = path.join(os.homedir(), `.claude-${slug}`), settings = path.join(dir, 'settings.json');
    if (path.resolve(dir) === path.resolve(claudeDir)) return { ok: false, message: tr('server.account.isMain') };
    await fsp.mkdir(dir, { recursive: true });
    let ownStatus = false;
    try { ownStatus = !!JSON.parse(await fsp.readFile(settings, 'utf8')).statusLine; } catch { /* a new folder */ }
    const res = await new Promise((resolve) => execFile(process.execPath, [path.join(root, 'bin', 'cli.mjs'), 'install', '--settings', settings, ...(ownStatus ? ['--no-status'] : [])],
      { timeout: 20000, env: { ...process.env, OFFICE_PORT: String(port) }, windowsHide: true }, (err) => resolve(!err)));
    if (!res) return { ok: false, message: tr('server.account.installFailed') };
    const done = loggedIn(dir), L = done ? null : startLogin(slug);
    watchLogins();
    return { ok: true, name: slug, dir: `~/.claude-${slug}`, loggedIn: done, login: L && { state: L.state, url: L.url || '', note: L.note || '' }, win: process.platform === 'win32', ...accountCmd(slug) };
  }

  function shareWithMain(dir) {
    if (!otherDirs.includes(dir)) return;
    const officeOnly = (f) => {
      try {
        const own = JSON.parse(fs.readFileSync(f, 'utf8')), main = fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8');
        return Object.keys(own).every((k) => ['hooks', 'statusLine', '$schema'].includes(k)) && main.includes(`:${port}/event`);
      } catch { return false; }
    };
    for (const n of SHARED) {
      const from = path.join(claudeDir, n), to = path.join(dir, n);
      if (!fs.existsSync(from)) continue;
      try {
        let st = null; try { st = fs.lstatSync(to); } catch { /* not there */ }
        if (st?.isSymbolicLink()) continue;
        if (st && n === 'settings.json' && officeOnly(to)) fs.renameSync(to, path.join(dir, 'settings.office-bak.json'));
        else if (st && st.isDirectory() && !fs.readdirSync(to).length) fs.rmdirSync(to);
        else if (st) continue;
        fs.symlinkSync(from, to, process.platform === 'win32' && fs.statSync(from).isDirectory() ? 'junction' : undefined);
      } catch { /* left as it is */ }
    }
    try {
      const servers = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')).mcpServers, f = path.join(dir, '.claude.json'), acc = JSON.parse(fs.readFileSync(f, 'utf8'));
      const merged = { ...(servers || {}), ...(acc.mcpServers || {}) };
      if (servers && JSON.stringify(merged) !== JSON.stringify(acc.mcpServers || {})) { acc.mcpServers = merged; fs.writeFileSync(`${f}.office-tmp`, JSON.stringify(acc, null, 2), { mode: 0o600 }); fs.renameSync(`${f}.office-tmp`, f); }
    } catch { /* not logged in yet, or busy */ }
  }

  function switchScript() {
    const pin = `${shq(PIN_DIR + path.sep)}"$sid"`;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(SWITCH_FILE, [
      '#!/bin/sh',
      '# My Office: Claude Code started on the account the office picked (the plan card). The editor passes the claude',
      '# program first (claudeCode.claudeProcessWrapper). A CLAUDE_CONFIG_DIR set already is kept. A conversation the office',
      '# moved to another account (its id in data/resume-on) starts on that one when the editor resumes it.',
      'if [ -z "$CLAUDE_CONFIG_DIR" ]; then',
      '  sid= prev=',
      '  for a in "$@"; do',
      '    case "$a" in --resume=*) sid=${a#--resume=} ;; *) [ "$prev" = --resume ] && sid=$a ;; esac',
      '    prev=$a',
      '  done',
      '  case "$sid" in *[!0-9A-Fa-f-]*) sid= ;; esac',
      `  if [ -n "$sid" ] && [ -f ${pin} ]; then d=$(head -n 1 ${pin})`,
      `  elif [ -r ${shq(NOW_FILE)} ]; then d=$(head -n 1 ${shq(NOW_FILE)})`,
      '  else d=',
      '  fi',
      '  if [ -n "$d" ] && [ -d "$d" ]; then CLAUDE_CONFIG_DIR=$d; export CLAUDE_CONFIG_DIR; fi',
      'fi',
      '[ -t 0 ] && exec "$@"   # (in a terminal: Claude Code itself, as always)',
      `if command -v perl >/dev/null 2>&1; then perl -e '$SIG{INT} = $SIG{QUIT} = "DEFAULT"; exec { $ARGV[0] } @ARGV or exit 127' -- "$@" <&0 &`,
      'else "$@" <&0 &',
      'fi',
      'child=$!',
      `trap 'kill -TERM "$child" 2>/dev/null' TERM`,
      "trap ':' INT",
      `trap 'kill -HUP "$child" 2>/dev/null' HUP`,
      'while :; do',
      '  wait "$child"; status=$?',
      '  kill -0 "$child" 2>/dev/null || break',
      'done',
      `if [ -f ${shq(CLOSING_DIR + path.sep)}"$child" ]; then rm -f ${shq(CLOSING_DIR + path.sep)}"$child"; exit 0; fi`,
      'exit "$status"',
      '',
    ].join('\n'));
    fs.chmodSync(SWITCH_FILE, 0o755);
    return SWITCH_FILE;
  }

  function claudeRows(rows) {
    const byPid = new Map([...sessions.values()].filter((s) => s.pid).map((s) => [s.pid, s]));
    const you = [...byPid.values()].filter((s) => s.saidAt > Date.now() - 3 * 3600e3).sort((a, b) => b.saidAt - a.saidAt)[0];
    return rows.map((c) => {
      const s = byPid.get(c.pid), ed = editorByDot(c.editor);
      return { ...c, title: s?.title || '', app: ed ? ed.label : s?.origin || '', agents: s ? Object.keys(s.subs).length : 0, you: !!s && s === you };
    });
  }

  function setEditorWrapper(on) {
    if (process.platform === 'win32') return [];
    const script = on ? switchScript() : SWITCH_FILE;
    return claudeEditorSettings().map(({ app, file }) => {
      let cfg = {}, real = file;
      try { real = fs.realpathSync(file); const t = fs.readFileSync(real, 'utf8'); cfg = t.trim() ? JSON.parse(t) : {}; } catch (e) { if (e.code !== 'ENOENT') return { app, ok: false }; }
      const cur = cfg[WRAP_KEY];
      if (on ? cur === script : cur !== script) return { app, ok: true };
      if (on && cur) return { app, ok: false, other: true };
      if (on) cfg[WRAP_KEY] = script; else delete cfg[WRAP_KEY];
      try { fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(`${real}.office-tmp`, `${JSON.stringify(cfg, null, 4)}\n`); fs.renameSync(`${real}.office-tmp`, real); } catch { return { app, ok: false }; }
      return { app, ok: true };
    });
  }

  function pinned() { try { return fs.readdirSync(PIN_DIR).filter((f) => SID_RE.test(f)); } catch { return []; } }
  const homeOf = (slug) => (slug ? dirOfSlug(slug) : claudeDir);
  function sharesHistory(slug) { try { return fs.realpathSync(path.join(homeOf(slug), 'projects')) === fs.realpathSync(path.join(claudeDir, 'projects')); } catch { return false; } }
  const untilOf = (slug) => blockedUntil(slug ? others.get(dirOfSlug(slug))?.windows : planLimits?.windows, hits.get(slug));

  function repick(why = 'auto') {
    if (!switching()) { if (nowDir) writeNow(''); return; }
    const all = [{ slug: '', dir: '', until: blockedUntil(planLimits?.windows, hits.get('')) },
      ...otherDirs.map((d) => ({ slug: accName(d), dir: d, until: blockedUntil(others.get(d)?.windows, hits.get(accName(d))) }))];
    const order = orderOf(), list = [...all].sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
    const cur = all.find((a) => a.dir === nowDir), next = !prefs.get('autoSwitch') ? list[0] : list.find((a) => !a.until) || cur || list[0];
    if (next.dir === nowDir && fs.existsSync(NOW_FILE)) return;
    if (next.dir) shareWithMain(next.dir);
    writeNow(next.dir);
    if (cur !== next) broadcast({ k: 'acctswitch', why, from: cur ? acctShown(cur.slug) : '', to: acctShown(next.slug), until: cur?.until || 0 });
    if (cur && cur !== next && cur.until) autoMoveSoon(cur.slug);
    broadcast({ k: 'limits', limits: limitsOut(), note: noteText() });
  }

  function limitHit(slug) {
    const dir = dirOfSlug(slug), ws = slug ? others.get(dir)?.windows : planLimits?.windows, now = Date.now();
    hits.set(slug, Math.max(0, ...(ws || []).filter((w) => w.pct >= 90 && w.resetsAt > now).map((w) => w.resetsAt)) || now + 5 * 60e3);
    if (slug && dir) fetchOtherUsage(dir, true); else if (!slug) fetchPlanUsage(true);
    repick();
    const to = nowSlug();
    return { to: prefs.get('autoSwitch') && to !== slug ? acctShown(to) : '' };
  }

  function setSwitch({ auto, pick, order, move, resume } = {}) {
    if (auto !== undefined) prefs.set('autoSwitch', auto || undefined);
    if (move !== undefined) prefs.set('autoMove', move ? undefined : false);
    if (resume !== undefined) prefs.set('autoResume', resume ? undefined : false);
    if (pick !== undefined) order = [pick, ...orderOf().filter((s) => s !== pick)];
    if (order !== undefined) { prefs.set('accountOrder', order); prefs.set('accountPick', undefined); }
    const on = switching() || pinned().length > 0;
    editorsNow = setEditorWrapper(on);
    const bin = on && findClaude();
    switchAlias = bin ? `alias claude='${SWITCH_FILE} "${bin.file}"'` : '';
    if (on && prefs.get('autoSwitch')) for (const d of otherDirs) shareWithMain(d);
    repick(pick !== undefined || order !== undefined ? 'pick' : 'auto');
    broadcast({ k: 'limits', limits: limitsOut(), note: noteText() });
    return { ok: true, ...autoOut() };
  }

  async function moveSession(s, to, why = 'you') {
    if (s.moving) return { ok: false, message: tr('server.move.busy') };
    s.moving = true;
    try { return await moveNow(s, to, why); } finally { s.moving = false; }
  }

  async function moveNow(s, to, why) {
    const from = acctOf(s), name = s.title || s.name;
    if (!s.pid || !s.sid || !SID_RE.test(s.sid) || s.parked) return { ok: false, message: tr('server.move.notOpen') };
    if (to && !dirOfSlug(to)) return { ok: false, message: tr('server.move.noAccount') };
    if (to === from) return { ok: false, message: tr('server.move.same', { to: acctShown(to) }) };
    if (s.status !== 'rest' || s.busy || [...pending.values()].some((p) => p.sess === s.id)) return { ok: false, message: tr('server.move.busy') };
    if (to) shareWithMain(dirOfSlug(to));
    if (!sharesHistory(from) || !sharesHistory(to)) return { ok: false, message: tr('server.move.noShare') };
    if (s.entry !== 'claude-vscode') {
      const cmd = `cd ${shq(s.cwd)} && ${to ? `CLAUDE_CONFIG_DIR=${shq(dirOfSlug(to))} ` : ''}claude --resume ${s.sid}`;
      return { ok: true, terminal: true, cmd, message: tr('server.move.terminal', { to: acctShown(to) }) };
    }
    const eds = setEditorWrapper(true), hostEd = eds.find((e) => e.app === s.origin);
    if (!(hostEd ? hostEd.ok : eds.some((e) => e.ok))) return { ok: false, message: tr('server.move.noScript') };
    editorsNow = eds;
    const proc = (await sysSnapshot().catch(() => null))?.claude?.find((c) => c.pid === s.pid);
    if (!proc) return { ok: false, message: tr('server.move.notOpen') };
    const pin = path.join(PIN_DIR, s.sid);
    try { fs.mkdirSync(PIN_DIR, { recursive: true }); fs.writeFileSync(pin, `${to ? dirOfSlug(to) : ''}\n`); } catch { return { ok: false, message: tr('server.move.failed') }; }
    s.parked = { to, at: Date.now() };
    closingOnPurpose([s.pid]);
    const r = await sysAction({ action: 'closeIdle', items: [{ target: s.pid, start: proc.start }] }).catch(() => null);
    if (!r?.closed?.length) { delete s.parked; fs.rmSync(pin, { force: true }); return { ok: false, message: tr('server.move.failed') }; }
    s.pid = null;
    chat.onMoved(s.id, acctShown(to));
    fsp.appendFile(actionLog, `${new Date().toISOString()} move ${name} ${from || 'main'} -> ${to || 'main'} (${why})\n`).catch(() => {});
    broadcast({ k: 'sess', s: pub(s) });
    return { ok: true, name, to: acctShown(to), message: tr('server.move.done', { name, to: acctShown(to) }) };
  }

  const autoResume = createAutoResume({
    findClaude, dirOfSlug, prefs, pinDir: PIN_DIR, spawn, prompt: () => tr('server.move.resumePrompt'),
    log: (msg) => fsp.appendFile(actionLog, msg).catch(() => {}),
  });

  async function autoMove(slug) {
    const to = nowSlug(), now = Date.now();
    if (!prefs.get('autoSwitch') || prefs.get('autoMove') === false || to === slug || untilOf(slug) - now < 15 * 60e3 || untilOf(to)) return;
    const moved = [];
    for (const s of [...sessions.values()]) {
      if (acctOf(s) !== slug || s.entry !== 'claude-vscode' || s.status !== 'rest' || s.parked || !s.pid) continue;
      const r = await moveSession(s, to, 'auto');
      if (r.ok) { moved.push(r.name); autoResume.resumeSession(s, to); }
    }
    if (moved.length) broadcast({ k: 'acctmove', names: moved, from: acctShown(slug), to: acctShown(to) });
  }
  function autoMoveSoon(slug) { for (const ms of [5000, 30000]) setTimeout(() => { autoMove(slug).catch(() => {}); }, ms).unref(); }

  function unpark(s) {
    if (!s.parked) return;
    s.transcript = path.join(homeOf(s.parked.to), 'projects', s.cwd.replace(/[^A-Za-z0-9-]/g, '-'), `${s.sid}.jsonl`);
    delete s.parked;
    fs.rmSync(path.join(PIN_DIR, s.sid), { force: true });
  }

  let accountMtime = 0, usageSoon = 0;
  const usageAfterTurn = () => { clearTimeout(usageSoon); usageSoon = setTimeout(fetchPlanUsage, 15_000); };

  // Background maintenance timers
  scanAccounts();
  if (switching() || pinned().length) setSwitch();
  setInterval(() => { if (watching()) { fetchPlanUsage(); for (const d of otherDirs) setTimeout(() => fetchOtherUsage(d), Math.random() * 40e3).unref(); } }, 120_000).unref();
  setInterval(() => { try { for (const f of fs.readdirSync(CLOSING_DIR)) { const p = path.join(CLOSING_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60e3) fs.rmSync(p, { force: true }); } } catch { /* none */ } }, 10 * 60e3).unref();
  setInterval(scanAccounts, 60_000).unref();
  setInterval(repick, 60_000).unref();
  setInterval(() => {
    fs.stat(ACCOUNT_FILE, (err, st) => {
      if (err || st.mtimeMs === accountMtime) return;
      accountMtime = st.mtimeMs;
      const now = loginAccount(null).id;
      if (planLimits?.account?.id && planLimits.account.id !== now) {
        planLimits = null; usageNote = ['server.usage.newAccount'];
        broadcast({ k: 'limits', limits: null, note: noteText() });
        usageWait = 0; fetchPlanUsage(true);
      }
    });
  }, 15_000).unref();
  setInterval(() => { for (const slug of ['', ...otherDirs.map(accName)]) if (untilOf(slug) - Date.now() >= 15 * 60e3) autoMove(slug).catch(() => {}); }, 60_000).unref();
  setInterval(() => {
    for (const f of pinned()) { try { const p = path.join(PIN_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > PARK_MS) fs.rmSync(p, { force: true }); } catch { /* gone */ } }
  }, 3600e3).unref();

  return {
    PIN_DIR, PARK_MS, logins, slugOf,
    getPlanLimits: () => planLimits,
    getOtherDirs: () => otherDirs,
    getNowDir: () => nowDir,
    resetModelCache: () => { modelAt = 0; },
    setEditorsNow: (eds) => { editorsNow = eds; },
    setLimits, limitsOut, noteText, fetchPlanUsage, fetchOtherUsage, usageAfterTurn,
    scanAccounts, othersOut, orderOf, untilOf, acctOf, acctLabel, acctShown, dirOfSlug, nowSlug,
    closingOnPurpose, shareWithMain, setSwitch, autoOut, claudeRows, limitHit, moveSession, autoMoveSoon, unpark,
    prepareAccount, startLogin, refreshLogin, setEditorWrapper,
  };
}
