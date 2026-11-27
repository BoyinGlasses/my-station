// Work orchestration: running agent tasks from the office/phone, mid-turn steering,
// editor session parking, background session lifecycle, and red-CI auto-fix cards.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTasks } from './tasks.mjs';
import { createBg, bgSettings, printSettings } from './bg-sessions.mjs';
import { steerable, inboundFrom, isSocket, deliver } from './steer.mjs';
import { SHOT_ASK, shoot, shotsIn } from './shots.mjs';
import { redact } from './redact.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const runIdOf = (url) => /\/actions\/runs\/(\d+)/.exec(url || '')?.[1] || '';

export function createWork({
  root, dataDir, port, claudeDir, prefs, tr, actionLog,
  sessions, bySid, sessionsIn, pub, broadcast, chat,
  getKnownDirs, getStranded, cacheOut, tilde, sameDir,
  findClaude, findCodex, findOpenCode, findAntigravity, findZCode,
  getNowDir, acctOf, dirOfSlug, getPinDir, closingOnPurpose, setEditorWrapper, setEditorsNow,
  sysSnapshot, sysAction,
  getPending, giveBack, taskPermission, onHook, pushOut,
}) {
  const taskSids = new Set(), taskQuote = new Map();
  const bgRun = createBg(), WIN = process.platform === 'win32';
  const fwd = (p) => p.replace(/\\/g, '/');
  const SEND = `"${fwd(process.execPath)}" "${fwd(path.join(root, 'hooks', 'send.mjs'))}"`;
  const bgOn = () => !!prefs.get('phoneTasksBg');
  const bgOut = () => { const k = bgRun.known(findClaude()); return { on: bgOn(), ok: k ? k.ok : null, version: k?.version || null }; };

  const threads = new Map();
  const THREADS_FILE = path.join(dataDir, 'task-threads.json');
  try {
    for (const [key, t] of JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8')).slice(-300)) {
      if (typeof key === 'string' && typeof t?.sid === 'string' && !t.running && Date.now() - t.at < 6 * 3600e3) threads.set(key, t);
    }
  } catch { /* no completed conversations yet */ }
  function saveThreads() {
    try {
      fs.writeFileSync(THREADS_FILE + '.tmp', JSON.stringify([...threads].filter(([, t]) => !t.running).slice(-300)), { mode: 0o600 });
      fs.renameSync(THREADS_FILE + '.tmp', THREADS_FILE);
    } catch (e) { console.error('save conversations', e.message); }
  }

  const cards = new Map();
  function cardStep(taskId, step) {
    const c = cards.get(taskId); if (!c) return;
    c.steps.push(step); c.n++; if (c.steps.length > 40) c.steps.shift();
    if (!c.timer) c.timer = setTimeout(() => { c.timer = 0; chat.setWork(c.id, { steps: c.steps, n: c.n }); }, 700);
  }

  function attachCmd(t) {
    const bin = findClaude(), cli = !bin || bin.onPath ? 'claude' : tilde(bin.file), dir = t.env?.CLAUDE_CONFIG_DIR;
    const acct = dir && path.resolve(dir) !== path.resolve(claudeDir) ? (WIN ? `$env:CLAUDE_CONFIG_DIR="${dir}"; ` : `CLAUDE_CONFIG_DIR=${tilde(dir)} `) : '';
    return `${acct}${WIN && bin && !bin.onPath ? `& "${bin.file}"` : cli} attach ${t.job}`;
  }

  function onBgTask(t, what, detail) {
    const card = cards.get(t.id), folder = path.basename(t.dir);
    if (what === 'started') { if (card) chat.setWork(card.id, { attach: attachCmd(t) }); fsp.appendFile(actionLog, `${new Date().toISOString()} task ${t.id} background session ${t.job}${t.copy ? ' (a copy)' : ''}\n`).catch(() => {}); return; }
    if (what === 'fallback') {
      fsp.appendFile(actionLog, `${new Date().toISOString()} task ${t.id} as claude -p (${detail})\n`).catch(() => {});
      if (detail === 'untrusted') chat.system(tr('chat.task.bgUntrusted', { folder }));
      else if (detail !== 'old') chat.system(tr('chat.task.bgFailed', { folder }));
      return;
    }
    if (!card || (card.wait && !card.macWait)) return;
    if (what === 'wait') { card.macWait = true; card.wait = tr(`chat.card.waitMac.${/permission/.test(detail || '') ? 'perm' : /input/.test(detail || '') ? 'input' : 'other'}`); chat.setWork(card.id, { state: 'wait', ask: card.wait, perm: null, steps: card.steps, n: card.n }); }
    else if (what === 'work' && card.macWait) { card.macWait = false; card.wait = null; chat.setWork(card.id, { state: 'work', ask: null, perm: null }); }
  }

  function stepOf(name, i = {}) {
    const f = (p) => path.basename(String(p || '')), c = (t, n = 70) => clip(redact(oneLine(String(t || ''))), n);
    switch (name) {
      case 'Read': return `📖 ${tr('chat.step.read', { f: f(i.file_path) })}`;
      case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `✏️ ${tr('chat.step.edit', { f: f(i.file_path || i.notebook_path) })}`;
      case 'Write': return `📝 ${tr('chat.step.write', { f: f(i.file_path) })}`;
      case 'Bash': return `▶ ${c(i.description || i.command)}`;
      case 'Grep': case 'Glob': return `🔍 ${c(i.pattern, 50)}`;
      case 'WebSearch': return `🌐 ${c(i.query, 60)}`;
      case 'WebFetch': try { return `🌐 ${new URL(i.url).host}`; } catch { return '🌐'; }
      case 'Task': case 'Agent': return `🤖 ${c(i.description, 60)}`;
      case 'TodoWrite': return `☑️ ${tr('chat.step.todo')}`;
      default: return `⚙️ ${c(name, 40)}`;
    }
  }

  const steerLater = new Map();
  const tasks = createTasks({
    dataDir, claude: findClaude, codex: findCodex, opencode: findOpenCode, antigravity: findAntigravity, zcode: findZCode,
    env: () => { const e = { ...process.env }; const nd = getNowDir(); if (nd) e.CLAUDE_CONFIG_DIR = nd; return e; },
    bg: { ...bgRun, want: bgOn, settings: () => bgSettings({ port, win: WIN, send: SEND }) },
    printSettings: (t) => printSettings({ port, task: t.id, win: WIN, send: SEND }),
    onStep: (t, x) => cardStep(t.id, stepOf(x.name, x.input)),
    onBg: (t, what, detail) => onBgTask(t, what, detail),
    onEvent: (_t, event) => onHook(event),
    onPermission: (t, request) => taskPermission(t, request),
    onDone: (t) => {
      for (const [id, p] of getPending()) if (p.task === t.id) giveBack(id, 'hook');
      const sid = t.sid && (t.agent === 'claude' ? t.sid : `${t.agent}:${t.sid}`);
      if (sid) { taskSids.add(sid); if (taskSids.size > 500) taskSids.delete(taskSids.values().next().value); }
      const card = cards.get(t.id); cards.delete(t.id);
      if (card) { clearTimeout(card.timer); chat.setWork(card.id, { state: t.stopped ? 'stopped' : t.error ? 'fail' : 'done', steps: card.steps, n: card.n, end: Date.now(), perm: null, ask: null }); }
      for (const x of sessions.values()) if (x.viaOffice === t.id) delete x.viaOffice;
      const dm = t.from?.chat, folder = path.basename(t.dir);
      const all = [...sessions.values()], who = (t.from?.id && all.some((x) => x.id === t.from.id) && t.from.id) || (dm ? t.agent || 'claude' : sid && all.find((x) => x.sid === sid)?.id);
      const { text: said, urls } = shotsIn(t.result);
      const answer = `${redact(said) || (t.error ? '' : tr('chat.task.doneEmpty'))}${urls.length ? `\n\n📸 ${tr('chat.task.shots', { pages: urls.map((u) => new URL(u).pathname).join(', ') })}` : ''}`;
      const text = t.stopped && !t.result ? tr('chat.task.stopped') : clip(`${t.error ? `${tr('chat.task.failed', { folder, error: clip(redact(oneLine(t.error)), 200) })}${answer ? '\n\n' : ''}` : ''}${answer}`, dm ? 3800 : 560);
      const quote = taskQuote.get(t.id) || null; taskQuote.delete(t.id);
      if (dm) { chat.working(t.from.id || t.agent || 'claude', false); if (t.sid) threads.set(t.from.orig, { sid: t.sid, at: Date.now(), running: false }); else threads.delete(t.from.orig); saveThreads(); }
      if (who) chat.say(who, text, { now: true, long: true, reply: quote, tag: t.agent || 'claude', react: ['❤️', '👍'], reacts: 2 });
      else chat.system(`📋 ${folder}: ${clip(oneLine(text), 300)}`);
      pushOut({ title: `💬 ${t.from?.name || folder}`, body: clip(oneLine(text), 180), tag: `task-${t.id}`, url: '/?chat' });
      if (who && urls.length) (async () => { for (const u of urls) { const photo = await shoot(u).catch(() => null); if (photo) chat.say(who, '', { photo, now: true }); } })();
      if (t.from?.orig && steerLater.has(t.from.orig)) setTimeout(() => sendLater(t.from.orig), 1500);
    },
  });

  function runOf(sid, cwd, now = Date.now()) {
    return tasks.of(sid) || (!/^(codex|opencode|antigravity|zcode):/.test(sid) && tasks.list().find((t) => t.agent === 'claude' && !t.sid && !t.from?.sid && t.dir === cwd && now - t.at < 30e3)) || null;
  }

  const acctEnv = (slug) => ({ CLAUDE_CONFIG_DIR: slug ? dirOfSlug(slug) : null });

  async function parkForPhone(s) {
    const name = s.title || s.name;
    if (s.entry !== 'claude-vscode') return { ok: false, message: tr('chat.task.macTerminal', { name }) };
    const eds = setEditorWrapper(true), host = eds.find((e) => e.app === s.origin);
    if (!(host ? host.ok : eds.some((e) => e.ok))) return { ok: false, message: tr('server.move.noScript') };
    setEditorsNow(eds);
    const proc = (await sysSnapshot().catch(() => null))?.claude?.find((c) => c.pid === s.pid);
    if (!proc) return { ok: true };
    const acct = acctOf(s) || '', pinDir = getPinDir(), pin = path.join(pinDir, s.sid);
    try { fs.mkdirSync(pinDir, { recursive: true }); fs.writeFileSync(pin, `${acct ? dirOfSlug(acct) : ''}\n`); } catch { return { ok: false, message: tr('server.move.failed') }; }
    s.parked = { to: acct, at: Date.now(), phone: true };
    closingOnPurpose([s.pid]);
    const r = await sysAction({ action: 'closeIdle', items: [{ target: s.pid, start: proc.start }] }).catch(() => null);
    if (!r?.closed?.length) { delete s.parked; fs.rmSync(pin, { force: true }); return { ok: false, message: tr('server.move.failed') }; }
    s.pid = null;
    chat.system(tr('chat.task.parked', { name }));
    fsp.appendFile(actionLog, `${new Date().toISOString()} phone carries on ${name} (${s.sid})\n`).catch(() => {});
    broadcast({ k: 'sess', s: pub(s) });
    return { ok: true };
  }

  async function stopBgSession(s) {
    const bin = findClaude(), slug = acctOf(s) || '', e = { ...process.env };
    if (slug) e.CLAUDE_CONFIG_DIR = dirOfSlug(slug); else delete e.CLAUDE_CONFIG_DIR;
    return !!bin && bgRun.stop(bin.file, s.jobId, e);
  }

  const tasksOut = (local) => ({
    ok: true, allowed: local || !!prefs.get('phoneTasks'), running: tasks.list(), bg: bgOut(),
    agents: [{ id: 'claude', name: 'Claude Code', bin: findClaude() }, { id: 'codex', name: 'Codex', bin: findCodex() }, { id: 'opencode', name: 'OpenCode', bin: findOpenCode() }, { id: 'antigravity', name: 'Antigravity', bin: findAntigravity() }, { id: 'zcode', name: 'ZCode', bin: findZCode() }].filter((a) => a.bin).map(({ id, name }) => ({ id, name })),
    projects: getKnownDirs().filter((d) => fs.existsSync(d)).map((d) => ({ dir: tilde(d), name: path.basename(d) })),
    sessions: [...sessions.values()].filter((s) => (!s.agent || ['claude', 'codex', 'opencode', 'antigravity'].includes(s.agent)) && s.sid && s.cwd).map((s) => ({ id: s.id, sid: s.sid, agent: s.agent || 'claude', name: s.title || s.name, dir: tilde(s.cwd), status: s.status, cache: cacheOut(s) })),
  });

  const workLocks = new Set();
  async function giveWork(b, who) {
    const s = b?.sid && [...sessions.values()].find((x) => (!x.agent || ['claude', 'codex', 'opencode', 'antigravity'].includes(x.agent)) && x.sid === String(b.sid) && x.cwd);
    const want = String(b?.dir || '').replace(/^~(?=$|[\\/])/, os.homedir()), pdir = !s && (getKnownDirs().find((d) => sameDir(d, want)) || getStranded().dirOf(want));
    if (!s && !pdir) return [400, { ok: false, code: 'noDir', message: tr('chat.task.noDir') }];
    const text = String(b?.text || '').trim().slice(0, 4000), images = (Array.isArray(b?.images) ? b.images : []).slice(0, 4).map(String);
    if (!text) return [400, { ok: false, code: 'empty' }];
    const agent = s?.agent || String(b?.agent || 'claude');
    if (!['claude', 'codex', 'opencode', 'antigravity', 'zcode'].includes(agent)) return [400, { ok: false, code: 'noAgent', message: tr('chat.task.why.noAgent') }];
    const model = b?.model ?? '';
    if (typeof model !== 'string' || (model && (!/^[a-zA-Z0-9][a-zA-Z0-9._:/#-]{0,199}$/.test(model) || agent === 'zcode'))) return [400, { ok: false, code: 'badModel', message: tr('chat.task.badModel') }];
    const name = s ? s.title || s.name : path.basename(pdir), key = s ? s.sid : `dir:${agent === 'claude' ? '' : agent + ':'}${pdir}`, th = threads.get(key);
    if (th?.running || workLocks.has(key)) return [409, { ok: false, code: 'busy', message: tr('chat.task.threadBusy', { name }) }];
    workLocks.add(key);
    try {
      let from;
      if (s) {
        if (agent !== 'claude' && s.status !== 'rest') return [409, { ok: false, code: 'macBusy', message: tr('chat.task.macBusy', { name }) }];
        const open = s.pid && !s.parked;
        if (open && (s.status !== 'rest' || s.busy || [...getPending().values()].some((p) => p.sess === s.id))) return [409, { ok: false, code: 'macBusy', message: tr('chat.task.macBusy', { name }) }];
        if (open && s.jobId) { if (!bgOn() && !(await stopBgSession(s))) return [409, { ok: false, code: 'macOpen', message: tr('server.move.failed') }]; }
        else if (open) { const pk = await parkForPhone(s); if (!pk.ok) return [409, { ok: false, code: 'macOpen', message: pk.message }]; }
        if (['codex', 'opencode'].includes(agent)) {
          const branch = th?.sid && Date.now() - th.at < 6 * 3600e3 ? th.sid : null;
          from = { sid: branch || s.sid.slice(agent.length + 1), agent, fork: !branch, name, id: s.id, orig: key, chat: true };
        } else from = { sid: agent === 'antigravity' ? s.sid.slice(agent.length + 1) : s.sid, agent, fork: false, name, id: s.id, orig: key, chat: true, acct: acctOf(s) || '' };
      } else {
        const on = th?.sid && !b.fresh && Date.now() - th.at < 6 * 3600e3 ? th.sid : null;
        const live = on && bySid(agent === 'claude' ? on : `${agent}:${on}`);
        if (live?.pid && (live.status !== 'rest' || live.busy)) return [409, { ok: false, code: 'macBusy', message: tr('chat.task.macBusy', { name: live.title || live.name }) }];
        from = { sid: on, agent, fork: false, name, orig: key, chat: true };
      }
      chat.say('me', `@${name} ${redact(text)}`, { now: true, long: true });
      const mine = chat.state.msgs.at(-1);
      for (const img of images) if (/^data:image\/jpeg;base64,/.test(img) && img.length < 500_000) chat.photo(img);
      const r = tasks.start({ dir: s ? s.cwd : pdir, text, model, images, from, env: s && agent === 'claude' ? acctEnv(from.acct) : null, system: SHOT_ASK, stopAfter: s?.entry === 'claude-vscode' });
      if (r.ok) {
        threads.set(key, { sid: from.sid, at: Date.now(), running: true });
        saveThreads();
        if (s) s.viaOffice = r.task.id;
        const card = chat.workCard(s ? s.id : agent, { state: 'work', steps: [], n: 0, at: Date.now(), task: r.task.id });
        if (card) cards.set(r.task.id, { id: card.id, steps: [], n: 0, at: Date.now(), timer: 0 });
        taskQuote.set(r.task.id, mine ? { id: mine.id, name: tr('chat.boss'), text: clip(redact(text), 90) } : null);
      } else chat.system(tr('chat.task.notStarted', { why: tr(`chat.task.why.${r.code}`) }));
      fsp.appendFile(actionLog, `${new Date().toISOString()} message ${who} ${s ? `${s.sid}${from.acct ? ` on ${from.acct}` : ''}` : from.sid ? `carry ${from.sid}` : `new in ${pdir}`} ${r.ok ? 'started' : r.code} ${clip(redact(oneLine(text)), 100)}\n`).catch(() => {});
      return [r.ok ? 200 : 409, r.ok ? { ok: true, task: r.task } : { ok: false, code: r.code, message: tr(`chat.task.why.${r.code}`) }];
    } finally { workLocks.delete(key); }
  }

  async function steerTo(b, who) {
    const text = String(b?.text || '').trim().slice(0, 2000);
    if (!text) return [400, { ok: false, code: 'empty' }];
    const want = String(b?.dir || '').replace(/^~(?=$|[\\/])/, os.homedir()), pdir = !b?.sid && getKnownDirs().find((d) => sameDir(d, want));
    const agent = String(b?.agent || 'claude'), projectKey = pdir ? `dir:${agent === 'claude' ? '' : agent + ':'}${pdir}` : null;
    let t = b?.task ? tasks.get(String(b.task)) : b?.sid ? tasks.of(String(b.sid)) : tasks.byKey(projectKey);
    const key = t?.from?.orig || (b?.sid ? String(b.sid) : projectKey);
    if (!t && key) t = tasks.byKey(key);
    const s = (t?.from?.id && [...sessions.values()].find((x) => x.id === t.from.id)) || (t?.sid && bySid(t.agent === 'claude' ? t.sid : `${t.agent}:${t.sid}`)) || (b?.sid && bySid(String(b.sid))) || (key?.startsWith('dir:') && threads.get(key)?.sid && bySid(threads.get(key).sid)) || null;
    const name = t?.from?.name || (s && (s.title || s.name)) || (pdir && path.basename(pdir)) || 'Claude';
    if (!t && !(s?.pid && (s.status !== 'rest' || s.busy))) return [409, { ok: false, code: 'notBusy', message: tr('chat.steer.notBusy', { name }) }];
    const inbox = t?.inbox || s?.inbox || null, acct = s && acctOf(s);
    const can = (t?.agent || s?.agent || agent) === 'claude' ? steerable({ inbox, mode: s?.mode || '', inbound: inboundFrom({ configDir: t?.env?.CLAUDE_CONFIG_DIR || (acct ? dirOfSlug(acct) : claudeDir), cwd: s?.cwd || t?.dir }), isSocket }) : { ok: false, why: 'noInbox' };
    chat.say('me', `💬 @${name} ${redact(text)}`, { now: true, long: true });
    const now = can.ok && await deliver(inbox, tr('server.steer.note', { text }));
    fsp.appendFile(actionLog, `${new Date().toISOString()} note ${who} ${t ? `task ${t.id}` : s?.sid || key} ${now ? 'delivered' : `kept (${can.ok ? 'failed' : can.why})`} ${clip(redact(oneLine(text)), 100)}\n`).catch(() => {});
    if (now) {
      if (t) cardStep(t.id, `💬 ${clip(redact(oneLine(text)), 70)}`);
      chat.system(tr('chat.steer.sent', { name }));
      return [200, { ok: true, how: 'now' }];
    }
    const why = can.ok ? 'failed' : can.why, k = key || s?.sid;
    if (!k) return [409, { ok: false, code: 'notBusy', message: tr('chat.steer.notBusy', { name }) }];
    const was = steerLater.get(k);
    steerLater.set(k, { body: k.startsWith('dir:') ? { dir: t?.dir || pdir, agent: t?.agent || agent } : { sid: k }, text: clip(was ? `${was.text}\n${text}` : text, 4000), name, at: Date.now() });
    for (const [x, v] of steerLater) if (steerLater.size > 8 || Date.now() - v.at > 6 * 3600e3) steerLater.delete(x);
    chat.system(tr('chat.steer.later', { name, why: tr(`chat.steer.why.${why}`) }));
    return [200, { ok: true, how: 'later', why }];
  }

  async function sendLater(key) {
    const x = steerLater.get(key); if (!x) return;
    steerLater.delete(key);
    const [code, out] = await giveWork({ ...x.body, text: x.text }, 'queued').catch(() => [500, {}]);
    if (code !== 200) chat.system(tr('chat.steer.notSent', { name: x.name, why: out?.message || tr('drawer.unreachable') }));
  }

  function ciCard(r) {
    const red = chat.state.msgs.findLast((m) => m.kind === 'ci' && m.ci?.repo === r.name && m.ci?.branch === r.branch && m.ci?.state === 'red');
    if (r.ci === 'green') { if (red) chat.setCi(red.id, { state: 'green' }); return; }
    if (r.ci !== 'red' || !r.ciUrl || chat.state.msgs.some((m) => m.kind === 'ci' && m.ci?.url === r.ciUrl)) return;
    const s = sessionsIn(r.root)[0]; if (!s) return;
    if (red) chat.setCi(red.id, { state: 'over' });
    chat.ciCard(s.id, { repo: r.name, branch: r.branch, wf: r.ciName, url: r.ciUrl, sess: s.id, sid: s.sid || '', dir: s.cwd, state: 'red', fix: null });
    pushOut({ title: tr('server.ci.pushTitle', { repo: r.name }), body: tr('server.ci.pushBody', { wf: r.ciName || 'CI', branch: r.branch }), tag: `ci-${r.name}`, url: '/?chat' });
  }

  async function ciFix(b, who) {
    const m = chat.byId(String(b?.id || ''));
    if (m?.kind !== 'ci') return [404, { ok: false, message: tr('server.ci.gone') }];
    const c = m.ci;
    if (c.state !== 'red') return [409, { ok: false, message: tr('server.ci.notRed') }];
    const text = tr('server.ci.fix', { wf: c.wf || 'CI', branch: c.branch, url: c.url, run: runIdOf(c.url) || c.url });
    const s = (c.sid && bySid(c.sid)) || [...sessions.values()].find((x) => x.id === c.sess) || null;
    const busy = !!s?.sid && s.pid && (s.status !== 'rest' || s.busy);
    const [code, out] = busy ? await steerTo({ sid: s.sid, text }, who) : await giveWork(s?.sid ? { sid: s.sid, text } : { dir: c.dir, text }, who);
    if (code === 200) chat.setCi(m.id, { fix: busy ? 'note' : 'sent' });
    fsp.appendFile(actionLog, `${new Date().toISOString()} ci fix ${c.repo}@${c.branch} from ${who}: ${code === 200 ? (busy ? 'note' : 'sent') : out?.code || code}\n`).catch(() => {});
    return [code, code === 200 ? { ok: true, how: busy ? 'note' : 'sent' } : out];
  }

  return {
    tasks, bgRun, bgOn, bgOut, threads, cards, taskSids, steerLater,
    cardStep, stepOf, runOf, tasksOut, giveWork, steerTo, sendLater, ciCard, ciFix,
  };
}
