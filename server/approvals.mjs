// Approval, question, plan, and PermissionDenied holding for desktop focus, menu bar, and phone away-mode.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dangerKey } from '../src/shared/danger.js';
import { holdPlan, createBarWatch, backAtMac, PHONE_HOLD_MS, BACK_SEC } from './mac-hold.mjs';
import { redact } from './redact.mjs';

const HOLD_MS = Math.min(45_000, Number(process.env.OFFICE_HOLD_MS) || 45_000);
const DENY_HOLD_MS = 40_000;
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const NO_VERDICT = /^(Auto mode could not evaluate|Classifier unavailable)/i;

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const base = (p) => (p ? path.basename(String(p)) : '');

export function createApprovals({
  prefs, push, tasks, cards, chat, sessions, bySid, scanSessions, pub, broadcast,
  classifyVi, normalizeTool, undo, undoTools, fileOf, loopLabel, actionLog, tr, idleSeconds,
}) {
  const presence = new Map();   // page id -> { focused, at }
  const officeFocused = () => {
    const now = Date.now();
    let focused = false;
    for (const [k, p] of presence) {
      if (now - p.at >= 30_000) presence.delete(k);
      else if (p.focused && now - p.at < 5000) focused = true;
    }
    return focused;
  };
  const pushOut = (msg) => { if (push.count() && !officeFocused()) push.notify(msg).catch(() => {}); };

  const barWatch = createBarWatch({
    idle: () => (process.env.OFFICE_IDLE_SEC !== undefined ? Number(process.env.OFFICE_IDLE_SEC) : process.platform === 'darwin' ? idleSeconds() : Infinity),
  });
  const macApprove = () => prefs.get('macApprove') !== false;
  const phoneCanAnswer = () => !!prefs.get('phoneApprove') && push.count() > 0;
  const planNow = (idleSec, limit = HOLD_MS) => holdPlan({
    focused: officeFocused(), barAlive: barWatch.alive(), idleSec, pref: macApprove(), normalMs: HOLD_MS,
    phone: phoneCanAnswer(), phoneMs: Math.min(PHONE_HOLD_MS, limit),
  });
  const holdNow = async (limit) => planNow(await barWatch.fresh(), limit);
  const barHolds = () => !officeFocused() && planNow(barWatch.idleSec()).by === 'bar';
  const hookLimit = (req) => { const w = Number(req.headers['x-office-wait']); return Number.isFinite(w) && w > 10 ? Math.min(PHONE_HOLD_MS, (w - 5) * 1000) : HOLD_MS; };

  const pending = new Map();
  const released = new Map();
  const deniedHeld = new Map();
  let backTimer = 0;

  function watchBack() {
    if (backTimer) return;
    backTimer = setInterval(async () => {
      if (![...pending.values()].some((x) => x.phone)) { clearInterval(backTimer); backTimer = 0; return; }
      const idle = await barWatch.fresh(4000);
      if (backAtMac(idle)) for (const [id, x] of [...pending]) if (x.phone) giveBack(id, 'back');
    }, 5000);
    backTimer.unref?.();
  }

  function phonePush(entry, text) {
    const title = tr(entry.kind === 'ask' ? 'server.push.askTitle' : entry.kind === 'plan' ? 'server.push.planTitle' : 'server.push.waitTitle', { name: entry.name });
    push.notify({ title, body: clip(text, 180), tag: `perm-${entry.id}`, url: '/', urgent: true }).catch(() => {});
  }

  function noteBack(p, why) {
    released.set(p.id, { at: Date.now(), why });
    if (released.size > 100) released.delete(released.keys().next().value);
    fsp.appendFile(actionLog, `${new Date().toISOString()} back to Claude Code (${why}) ${p.kind || 'perm'} ${p.name} ${p.tool}${p.phone ? ' (held for the phone)' : ''}\n`).catch(() => {});
  }

  function giveBack(id, why) {
    const p = pending.get(id); if (!p) return;
    noteBack(p, why);
    settlePerm(id);
  }

  const permPub = (p) => ({
    id: p.id, agent: p.agent || 'claude', sess: p.sess, name: p.name, tool: p.tool, type: p.type,
    label: p.label, detail: p.detail, remember: p.remember, at: p.at, until: p.until,
    kind: p.kind || 'perm', questions: p.questions, plan: p.plan,
  });

  async function keepForPhone(id, why) {
    const p = pending.get(id); if (!p || p.long) return;
    const left = p.at + p.limit - Date.now();
    if (!p.phone && phoneCanAnswer() && left > 15_000) {
      const idle = await barWatch.fresh(4000);
      if (!pending.has(id)) return;
      if (Number.isFinite(idle) && idle >= BACK_SEC) {
        clearTimeout(p.timer); p.phone = true; p.until = p.at + p.limit;
        p.timer = setTimeout(() => giveBack(id, 'timeout'), p.until - Date.now());
        broadcast({ k: 'perm', p: permPub(p) });
        phonePush(p, p.pushText); watchBack();
        return;
      }
    }
    giveBack(id, why);
  }

  function settlePerm(id, body = '') {
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (p.resolve) p.resolve(body);
    else try { p.res.writeHead(200, { 'Content-Type': 'application/json' }).end(body); } catch { /* hook already gone */ }
    broadcast({ k: 'permDone', id });
    if (p.task && ![...pending.values()].some((x) => x.task === p.task)) {
      const card = cards.get(p.task); if (card) chat.setWork(card.id, { state: 'work', ask: null, perm: null });
    }
    const s = body && p.sess && [...sessions.values()].find((x) => x.id === p.sess);
    if (s && s.status === 'wait' && ![...pending.values()].some((x) => x.sess === s.id)) { s.status = 'work'; broadcast({ k: 'sess', s: pub(s) }); }
  }

  function permDecision(p, choice) {
    if (choice === 'deny') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: tr('server.perm.denied') } } };
    const decision = { behavior: 'allow' };
    if (choice === 'always' && p.suggestion) decision.updatedPermissions = [p.suggestion];
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }

  function permDetail(p) {
    const i = p.tool_input || {};
    const d = i.command || i.file_path || i.url || i.pattern || i.query || i.prompt || JSON.stringify(i);
    return clip(redact(String(d)), 400);
  }

  function ruleText(sug) {
    const r0 = sug.rules?.[0]; if (!r0) return null;
    const where = ['session', 'localSettings', 'projectSettings', 'userSettings'].includes(sug.destination) ? tr(`server.rule.${sug.destination}`) : '';
    return `${r0.toolName}${r0.ruleContent ? `(${clip(redact(r0.ruleContent), 60)})` : ''} ${where}`.trim();
  }

  function longHold(p, long) {
    const t = (!p?.agent || p.agent === 'claude') && tasks.of(p?.session_id), bg = t?.mode === 'bg' ? t : null;
    if (long) return bg ? { task: bg } : { skip: true };
    return bg?.hooked ? { skip: true } : {};
  }

  async function taskPermission(t, request) {
    const asking = request.kind === 'ask', qs = asking && Array.isArray(request.questions) ? request.questions.slice(0, 4) : [];
    if (asking && (!qs.length || qs.some((q) => typeof q.id !== 'string' || typeof q.question !== 'string'))) return {};
    const tool = asking ? { name: 'AskUserQuestion', input: { questions: qs } } : normalizeTool(t.agent, request.tool, request.input);
    const c = asking ? { type: 'ask', label: tr('server.tool.ask') } : await classifyVi(tool.name, tool.input);
    if (tool.name === 'Bash' && typeof tool.input.command !== 'string') return false;
    if (t.stopped || t.ended) return false;
    return new Promise((resolve) => {
      const id = crypto.randomUUID(), now = Date.now(), s = bySid(`${t.agent}:${t.sid}`);
      const entry = {
        id, agent: t.agent, task: t.id, sess: s?.id || null, name: t.from?.name || s?.name || t.agent,
        tool: tool.name, type: c.type, label: c.label, detail: permDetail({ tool_input: tool.input }), at: now, until: now + HOLD_MS,
        resolve: (body) => {
          try {
            const out = JSON.parse(body).hookSpecificOutput;
            resolve(asking ? Object.fromEntries(qs.filter((q) => out.updatedInput?.answers?.[q.question]).map((q) => [q.id, { answers: [out.updatedInput.answers[q.question]] }])) : out.decision?.behavior === 'allow');
          } catch { resolve(asking ? {} : false); }
        },
      };
      if (asking) {
        entry.kind = 'ask'; entry.input = tool.input;
        entry.questions = qs.map((q) => ({
          header: clip(redact(oneLine(q.header)), 30), question: clip(redact(oneLine(q.question)), 400), multi: false,
          options: (Array.isArray(q.options) ? q.options.slice(0, 6) : []).map((o) => ({ label: clip(redact(oneLine(o.label)), 80), description: clip(redact(oneLine(o.description)), 240) })),
        }));
        entry.detail = entry.questions.map((q) => q.question).join('\n');
      }
      entry.timer = setTimeout(() => giveBack(id, 'timeout'), HOLD_MS);
      pending.set(id, entry);
      if (s) { s.status = 'wait'; broadcast({ k: 'sess', s: pub(s) }); }
      broadcast({ k: 'perm', p: permPub(entry) });
      const card = cards.get(t.id);
      if (card) chat.setWork(card.id, { state: 'wait', ask: entry.detail, perm: id, risky: !!dangerKey(entry) });
      pushOut({ title: tr('server.push.permTitle', { name: entry.name }), body: clip(`${c.label}: ${entry.detail}`, 180), tag: `perm-${id}`, url: '/', urgent: true });
    });
  }

  async function onPermission(p, res, long = false, limit = HOLD_MS) {
    const lh = longHold(p, long); if (lh.skip) { res.writeHead(200).end(''); return; }
    const agent = p?.agent === 'codex' ? 'codex' : 'claude';
    const matchesRun = (t) => (t.from?.agent || 'claude') === agent && (t.sid === p.session_id || t.from?.sid === p.session_id);
    const ours = !!p?.session_id && push.count() > 0 && !!prefs.get('phoneApprove') && tasks.list().some(matchesRun);
    const plan = long ? { ms: 0, by: null } : await holdNow(limit), hold = plan.ms, forPhone = plan.by === 'phone';
    if (!p || !p.session_id || ASK_TOOLS.has(p.tool_name) || (!hold && !ours && !long)) { res.writeHead(200).end(''); return; }
    const sid = agent === 'codex' ? `codex:${p.session_id}` : p.session_id;
    let s = bySid(sid); if (!s) { await scanSessions(); s = bySid(sid); }
    const tool = normalizeTool(agent, p.tool_name, p.tool_input);
    const c = await classifyVi(tool.name, tool.input);
    const suggestion = agent === 'claude' && Array.isArray(p.permission_suggestions) ? p.permission_suggestions.find((x) => x && x.type === 'addRules' && x.behavior === 'allow') || null : null;
    const id = crypto.randomUUID(), now = Date.now();
    const entry = {
      id, res, agent, sess: s?.id || null, name: s?.name || base(p.cwd) || agent, tool: tool.name, type: c.type, label: c.label, detail: permDetail({ tool_input: tool.input }),
      remember: suggestion ? ruleText(suggestion) : null, suggestion, at: now, until: long ? 0 : now + (hold || HOLD_MS), long, phone: forPhone, task: lh.task?.id || null,
      limit: Math.min(PHONE_HOLD_MS, limit), pushText: `${c.label}: ${oneLine(permDetail(p))}`,
    };
    if (!long) entry.timer = setTimeout(() => keepForPhone(id, 'timeout'), hold || HOLD_MS);
    pending.set(id, entry);
    res.on('close', () => { if (pending.get(id) === entry) { noteBack(entry, 'hook'); pending.delete(id); clearTimeout(entry.timer); broadcast({ k: 'permDone', id }); } });
    if (s && s.status !== 'wait') { s.status = 'wait'; broadcast({ k: 'sess', s: pub(s) }); }
    broadcast({ k: 'perm', p: permPub(entry) });
    if (forPhone) { phonePush(entry, entry.pushText); watchBack(); }
    else if (ours || (long && prefs.get('phoneApprove'))) pushOut({ title: tr('server.push.permTitle', { name: entry.name }), body: clip(`${c.label}: ${oneLine(entry.detail)}`, 180), tag: `perm-${id}`, url: '/', urgent: true });
    const run = tasks.list().find(matchesRun), card = run && cards.get(run.id);
    if (card) {
      card.wait = clip(`${c.label}: ${oneLine(entry.detail)}`, 120);
      chat.setWork(card.id, { state: 'wait', ask: card.wait, perm: id, risky: !!dangerKey(entry), steps: card.steps, n: card.n });
      res.on('close', () => { if (cards.get(run.id) === card) { card.wait = null; chat.setWork(card.id, { state: 'work', ask: null, perm: null }); } });
    }
  }

  async function onDenied(p, res) {
    let s = p?.session_id ? bySid(p.session_id) : null; if (p?.session_id && !s) { await scanSessions(); s = bySid(p.session_id); }
    if (p?.session_id && undoTools.has(p.tool_name)) undo.reject(p.session_id, fileOf(p.tool_input, p.cwd || s?.cwd));
    const reason = clip(oneLine(String(p?.reason || '')), 300), canRetry = !NO_VERDICT.test(reason), hold = !!s && canRetry && officeFocused();
    const shell = p?.tool_name === 'Bash' || p?.tool_name === 'PowerShell';
    const cmd = clip(redact(String(shell ? p.tool_input?.command || '' : JSON.stringify(p?.tool_input || {}))), 2000);
    const m = s ? chat.denyCard(s.id, { sess: s.id, tool: p.tool_name || '', label: loopLabel(p.tool_name, p.tool_input), cmd, shell, reason, retry: canRetry, state: hold ? 'held' : 'kept', until: hold ? Date.now() + DENY_HOLD_MS : 0 }) : null;
    fsp.appendFile(actionLog, `${new Date().toISOString()} denied ${p?.session_id || '?'} ${clip(oneLine(cmd), 100)} ${reason}${hold ? ' (held)' : ''}\n`).catch(() => {});
    if (!hold || !m) { res.writeHead(200).end(''); return; }
    let timer = 0;
    const settle = (retry) => {
      if (deniedHeld.get(m.id) !== settle) return;
      deniedHeld.delete(m.id); clearTimeout(timer);
      chat.setDeny(m.id, { state: retry ? 'retry' : 'kept', until: 0 });
      try { res.writeHead(200, { 'Content-Type': 'application/json' }).end(retry ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } }) : ''); } catch { /* gone */ }
    };
    deniedHeld.set(m.id, settle);
    timer = setTimeout(() => settle(false), DENY_HOLD_MS);
    res.on('close', () => { if (deniedHeld.get(m.id) === settle) { deniedHeld.delete(m.id); clearTimeout(timer); chat.setDeny(m.id, { state: 'kept', until: 0 }); } });
  }

  async function onQuestion(p, res, long = false, limit = HOLD_MS) {
    const lh = longHold(p, long); if (lh.skip) { res.writeHead(200).end(''); return; }
    const plan = long ? { ms: 0, by: null } : await holdNow(limit), hold = plan.ms, forPhone = plan.by === 'phone';
    if (!p || !p.session_id || !ASK_TOOLS.has(p.tool_name) || (!hold && !long)) { res.writeHead(200).end(''); return; }
    let s = bySid(p.session_id); if (!s) { await scanSessions(); s = bySid(p.session_id); }
    const i = p.tool_input || {}, id = crypto.randomUUID(), now = Date.now(), txt = (v, n) => clip(redact(oneLine(v)), n);
    const entry = {
      id, res, sess: s?.id || null, name: s?.name || base(p.cwd) || 'claude', tool: p.tool_name, input: i, at: now, until: long ? 0 : now + hold, long, phone: forPhone, task: lh.task?.id || null,
      limit: Math.min(PHONE_HOLD_MS, limit),
    };
    if (p.tool_name === 'AskUserQuestion') {
      const qs = Array.isArray(i.questions) ? i.questions.slice(0, 4) : [];
      if (!qs.length) { res.writeHead(200).end(''); return; }
      Object.assign(entry, { kind: 'ask', type: 'ask', label: tr('server.tool.ask') });
      entry.questions = qs.map((q) => ({
        question: txt(q.question, 400), header: txt(q.header, 30), multi: !!q.multiSelect,
        options: (Array.isArray(q.options) ? q.options.slice(0, 6) : []).map((o) => ({ label: txt(o.label, 80), description: txt(o.description, 240) })),
      }));
      entry.detail = entry.questions.map((q) => q.question).join('\n');
    } else {
      Object.assign(entry, { kind: 'plan', type: 'plan', label: tr('server.tool.plan') });
      entry.plan = clip(redact(String(i.plan || '')), 20000); entry.detail = clip(oneLine(entry.plan), 200);
    }
    entry.pushText = entry.detail;
    if (!long) entry.timer = setTimeout(() => keepForPhone(id, 'timeout'), hold);
    pending.set(id, entry);
    res.on('close', () => { if (pending.get(id) === entry) { noteBack(entry, 'hook'); pending.delete(id); clearTimeout(entry.timer); broadcast({ k: 'permDone', id }); } });
    if (s && s.status !== 'wait') { s.status = 'wait'; broadcast({ k: 'sess', s: pub(s) }); }
    broadcast({ k: 'perm', p: permPub(entry) });
    if (forPhone) { phonePush(entry, entry.pushText); watchBack(); }
    const card = lh.task && cards.get(lh.task.id);
    if (card) {
      card.wait = clip(`${entry.label}: ${oneLine(entry.detail)}`, 120);
      chat.setWork(card.id, { state: 'wait', ask: card.wait, perm: null, steps: card.steps, n: card.n });
      res.on('close', () => { if (cards.get(lh.task.id) === card) { card.wait = null; chat.setWork(card.id, { state: 'work', ask: null, perm: null }); } });
      if (prefs.get('phoneApprove')) pushOut({ title: tr('server.push.permTitle', { name: entry.name }), body: clip(oneLine(entry.detail), 180), tag: `perm-${id}`, url: '/', urgent: true });
    }
  }

  function askDecision(p, b) {
    const qs = Array.isArray(p.input.questions) ? p.input.questions : [], answers = {};
    for (const a of Array.isArray(b.answers) ? b.answers : []) {
      const q = qs[a?.q]; if (!q || typeof q.question !== 'string') continue;
      const labels = (Array.isArray(a.pick) ? a.pick : []).map((k) => q.options?.[k]?.label).filter((x) => typeof x === 'string');
      const other = oneLine(a.other).slice(0, 500);
      const val = [...(q.multiSelect ? labels : labels.slice(0, 1)), ...(other ? [other] : [])].join(', ');
      if (val) answers[q.question] = val;
    }
    if (Object.keys(answers).length < qs.length) return null;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...p.input, answers } } };
  }

  function planDecision(p, choice, note) {
    if (choice === 'approve') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: p.input } };
    const why = oneLine(note).slice(0, 1000);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why ? tr('server.perm.planReviseWhy', { why }) : tr('server.perm.planRevise') } };
  }

  return {
    presence, barWatch, pending, released, deniedHeld,
    officeFocused, macApprove, barHolds, hookLimit, pushOut,
    permPub, permDecision, askDecision, planDecision,
    settlePerm, giveBack, keepForPhone,
    taskPermission, onPermission, onDenied, onQuestion,
  };
}
