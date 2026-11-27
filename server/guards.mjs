// Runtime guards & conversation aids: pinned reminders across compactions, last-turn undo,
// stuck-loop guard, and concurrent file-edit / port-clash warnings.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createOverlap, EDIT_TOOLS, fileOf, portInUse } from './overlap.mjs';
import { createLoopGuard, LOOP_DEFAULTS, LOOP_MIN, LOOP_N } from './loops.mjs';
import { createUndo, EDIT_TOOLS as UNDO_TOOLS } from './undo.mjs';
import { redact } from './redact.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const base = (p) => (p ? path.basename(String(p)) : '');
const host = (u) => { try { return new URL(u).hostname; } catch { return 'web'; } };

export { EDIT_TOOLS, UNDO_TOOLS, fileOf, portInUse, LOOP_N, LOOP_MIN };

export function createGuards({
  dataDir, prefs, tr, sessions, bySid, chat, tasks, runOf, giveWork, steerTo,
  pub, broadcast, pushOut, sysSnapshot, sysDur, tilde, actionLog,
}) {
  const PINS_FILE = path.join(dataDir, 'pins.json'), PIN_MAX = 12, PIN_LEN = 500;
  let pins = {};
  try { pins = JSON.parse(fs.readFileSync(PINS_FILE, 'utf8')) || {}; } catch { /* none yet */ }

  const undo = createUndo({ dir: path.join(dataDir, 'undo') });

  /* ---------- "Ghi nhớ cho Claude": pinned reminders re-injected after compaction ---------- */
  const savePins = () => fsp.writeFile(PINS_FILE, JSON.stringify(pins)).catch(() => {});
  const pinsOf = (sid) => (sid && pins[sid]?.list) || [];
  function pinsOut(s) {
    const p = (s?.sid && pins[s.sid]) || {};
    return { ok: true, list: p.list || [], said: p.said || 0 };
  }
  function pinOp(b, s) {
    if (!s?.sid) return { ok: false, message: tr('server.pins.noSid') };
    const p = (pins[s.sid] ||= { list: [], at: 0 });
    if (b.op === 'add') {
      const text = String(b.text || '').trim().slice(0, PIN_LEN); if (!text) return { ok: false };
      if (p.list.length >= PIN_MAX) return { ok: false, message: tr('server.pins.full', { n: PIN_MAX }) };
      p.list.push({ id: crypto.randomUUID().slice(0, 8), text, at: Date.now() });
    } else if (b.op === 'del') p.list = p.list.filter((x) => x.id !== String(b.pin || ''));
    else return { ok: false };
    p.at = Date.now();
    if (!p.list.length) delete pins[s.sid];
    const keys = Object.keys(pins);
    if (keys.length > 300) for (const k of keys.sort((a, c) => (pins[a].at || 0) - (pins[c].at || 0)).slice(0, keys.length - 300)) delete pins[k];
    savePins(); broadcast({ k: 'sess', s: pub(s) });
    return pinsOut(s);
  }
  async function onStart(p) {
    if (p?.source !== 'compact') return null;
    const list = pinsOf(p.session_id); if (!list.length) return null;
    pins[p.session_id].said = Date.now(); savePins();
    const s = bySid(p.session_id); if (s) chat.system(tr('chat.pins.said', { name: s.title || s.name, n: list.length }));
    fsp.appendFile(actionLog, `${new Date().toISOString()} pins said again ${p.session_id} (${list.length})\n`).catch(() => {});
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${tr('server.pins.context')}\n${list.map((x) => `- ${x.text}`).join('\n')}` } };
  }

  /* ---------- "Hoàn tác lượt cuối" (server/undo.mjs) ---------- */
  const sessionById = (id) => [...sessions.values()].find((x) => x.id === String(id || '')) || null;
  async function undoOut(s) {
    const p = s?.sid ? await undo.plan(s.sid) : null;
    return p ? { ok: true, ...p, files: p.files.map((x) => ({ ...x, file: tilde(x.file) })) } : { ok: false };
  }
  async function undoAct(b, who) {
    const s = sessionById(b?.id); if (!s?.sid) return [404, { ok: false, message: tr('server.loop.gone') }];
    if (b.op === 'tell') {
      const files = String(b.files || '').slice(0, 2000);
      return s.pid && (s.status !== 'rest' || s.busy) ? steerTo({ sid: s.sid, text: tr('server.undo.tell', { files }) }, who) : giveWork({ sid: s.sid, text: tr('server.undo.tell', { files }) }, who);
    }
    if (s.status !== 'rest' || s.busy) return [409, { ok: false, message: tr('server.undo.busy', { name: s.title || s.name }) }];
    const r = await undo.apply(s.sid);
    if (!r.done.length) return [409, { ok: false, message: tr('server.undo.nothing') }];
    chat.system(tr('chat.undo.done', { name: s.title || s.name, n: r.done.length }));
    broadcast({ k: 'sess', s: pub(s) });
    fsp.appendFile(actionLog, `${new Date().toISOString()} undo ${s.sid} from ${who}: ${r.done.map((x) => `${x.action} ${x.file}`).join(', ')}\n`).catch(() => {});
    return [200, { ok: true, done: r.done.map((x) => ({ ...x, file: tilde(x.file) })), after: tilde(r.after || '') }];
  }

  /* ---------- "Ngắt vòng lặp kẹt" (server/loops.mjs) ---------- */
  const loopConfig = () => ({ ...LOOP_DEFAULTS, ...(prefs.get('loopGuard') || {}) });
  const loopLabel = (name, i = {}) => clip(redact(oneLine(name === 'Bash' || name === 'PowerShell' ? i.command
    : `${name}${i.file_path || i.notebook_path ? ` ${base(i.file_path || i.notebook_path)}` : i.url ? ` ${host(i.url)}` : i.pattern || i.query ? ` ${i.pattern || i.query}` : ''}`)), 60);
  const loops = createLoopGuard({ config: loopConfig, labelOf: loopLabel });
  let loopHookAt = 0;
  const loopCards = new Map();
  const loopRun = (s) => (s.viaOffice && tasks.list().find((t) => t.id === s.viaOffice)) || (s.sid && runOf(s.sid, s.cwd)) || null;
  function loopLine(st, name) {
    const usd = st.usd != null ? `$${st.usd.toFixed(2)}` : '';
    return tr(`chat.loop.${st.kind}`, { name, label: `\`${st.label || ''}\``, n: st.n, next: (st.n || 0) + (st.blocked || 0), blocked: st.blocked || 0, mins: st.mins, usd });
  }
  function onLoop(s, sig) {
    if (!s || !sig) return;
    const card = loopCards.get(s.id), name = s.title || s.name;
    const setCard = (loop) => { if (card) chat.setLoop(card.id, loop); };
    if (sig.type === 'fire') {
      const st = sig.stuck, run = loopRun(s);
      if (card && ['on', 'stopping'].includes(chat.byId(card.id)?.loop?.state)) setCard({ state: 'over', why: 'again' });
      s.stuck = { kind: st.kind, label: st.label || '', n: st.n || 0, blocked: st.blocked || 0, usd: st.usd ?? null, mins: st.mins || 0, at: st.at };
      broadcast({ k: 'sess', s: pub(s) });
      const m = chat.loopCard(s.id, { ...s.stuck, state: 'on', hint: sig.hint ? 'got' : null, sess: s.id, task: run?.id || null });
      if (m) { loopCards.delete(s.id); loopCards.set(s.id, { id: m.id }); if (loopCards.size > 16) loopCards.delete(loopCards.keys().next().value); }
      pushOut({ title: tr('server.loop.pushTitle', { name }), body: clip(loopLine(s.stuck, name), 180), tag: `loop-${s.id}`, url: '/?chat' });
      fsp.appendFile(actionLog, `${new Date().toISOString()} stuck ${st.kind} ${s.sid} ${clip(oneLine(st.label || ''), 80)}${st.blocked ? ' (denied)' : ''}\n`).catch(() => {});
    } else if (sig.type === 'blocked') {
      if (s.stuck) { s.stuck.blocked = sig.stuck.blocked; broadcast({ k: 'sess', s: pub(s) }); }
      setCard({ blocked: sig.stuck.blocked, ...(sig.hint && { hint: 'got' }) });
    } else if (sig.type === 'clear') {
      s.stuck = null; broadcast({ k: 'sess', s: pub(s) });
      if (card && chat.byId(card.id)?.loop?.state !== 'stopped') setCard({ state: 'over', why: sig.why, ...(sig.hintLost && { hint: 'lost' }) });
    } else if (sig.type === 'hint') setCard({ hint: 'got' });
    else if (sig.type === 'hintLost') setCard({ hint: 'lost' });
    else if (sig.type === 'stopped') setCard({ state: 'stopped' });
  }
  function loopReply(p) {
    const r = loops.check(p), hint = r.hint ? tr('server.loop.hintFor', { hint: r.hint }) : '';
    const out = r.stop ? { continue: false, stopReason: tr('server.loop.stopReason') }
      : r.deny ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${tr('server.loop.deny', { n: r.deny.n })}${hint ? `\n\n${hint}` : ''}` } }
        : hint ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: hint } } : null;
    return { out, sig: r.sig };
  }

  /* ---------- "Chặn ghi đè và giành cổng" (server/overlap.mjs) ---------- */
  const overlap = createOverlap();
  const nameOfSid = (sid) => { const x = bySid(sid); return x ? x.title || x.name : String(sid || '').slice(0, 8); };
  function overlapNote(p) {
    if (p.hook_event_name && p.hook_event_name !== 'PreToolUse') return null;
    const sid = p.session_id; let text = overlap.take(sid), line = null;
    if (EDIT_TOOLS.has(p.tool_name)) {
      const file = fileOf(p.tool_input, p.cwd || bySid(sid)?.cwd), hit = overlap.before(sid, file);
      if (hit) {
        const other = nameOfSid(hit.other), time = new Date(hit.at).toTimeString().slice(0, 5);
        text = [tr('server.overlap.file', { name: other, time }), text].filter(Boolean).join('\n\n');
        line = tr('chat.overlap.file', { a: nameOfSid(sid), b: other, file: base(file) });
      }
    }
    return text || line ? { text, line } : null;
  }
  function withContext(out, text) {
    if (out?.continue === false) return out;
    const h = out?.hookSpecificOutput;
    if (h?.permissionDecision === 'deny') return { ...out, hookSpecificOutput: { ...h, permissionDecisionReason: `${h.permissionDecisionReason || ''}\n\n${text}`.trim() } };
    return { ...out, hookSpecificOutput: { ...h, hookEventName: 'PreToolUse', additionalContext: [h?.additionalContext, text].filter(Boolean).join('\n\n') } };
  }
  async function portClash(s, sid, port) {
    if (!port || !overlap.portOnce(sid, port)) return;
    const d = (await sysSnapshot().catch(() => null))?.devServers?.find((x) => x.ports.includes(port));
    const holder = !d ? tr('server.overlap.someone') : d.owner?.name ? tr('server.overlap.holderOf', { label: d.label, owner: d.owner.name, up: sysDur(d.up) }) : tr('server.overlap.holder', { label: d.label, up: sysDur(d.up) });
    chat.system(tr('chat.overlap.port', { name: s.title || s.name, port, holder }));
    overlap.note(sid, tr('server.overlap.port', { port, holder }));
    fsp.appendFile(actionLog, `${new Date().toISOString()} port ${port} clash ${sid}${d ? ` held by pid ${d.pid}` : ''}\n`).catch(() => {});
  }

  function loopAct(b, mac) {
    if (!mac && !prefs.get('phoneTasks')) return { ok: false, code: 'notAllowed', message: tr('chat.task.notAllowed') };
    const id = String(b?.id || ''), s = [...sessions.values()].find((x) => x.id === id); if (!s?.sid) return { ok: false, message: tr('server.loop.gone') };
    const card = loopCards.get(s.id);
    if (b.op === 'stop') {
      const run = loopRun(s);
      if (run) { const ok = tasks.stop(run.id); if (ok && card) chat.setLoop(card.id, { state: 'stopped' }); return { ok, how: 'task' }; }
      if (s.status === 'rest') return { ok: false, code: 'resting', message: tr('server.loop.resting', { name: s.title || s.name }) };
      loops.stop(s.sid); if (card) chat.setLoop(card.id, { state: 'stopping' });
      fsp.appendFile(actionLog, `${new Date().toISOString()} stuck stop ${s.sid} from ${mac ? 'mac' : 'phone'}\n`).catch(() => {});
      return { ok: true, how: 'next' };
    }
    if (b.op === 'hint') {
      if (s.status === 'rest') return { ok: false, code: 'resting', sid: s.sid };
      if (!loops.hint(s.sid, oneLine(b.text))) return { ok: false, code: 'empty' };
      if (card) chat.setLoop(card.id, { hint: 'sent' });
      fsp.appendFile(actionLog, `${new Date().toISOString()} stuck hint ${s.sid} from ${mac ? 'mac' : 'phone'}\n`).catch(() => {});
      return { ok: true };
    }
    return { ok: false };
  }
  const loopOut = () => ({ ok: true, ...loopConfig(), choices: { n: LOOP_N, min: LOOP_MIN }, hookAt: loopHookAt });

  return {
    undo, loops, overlap, sessionById,
    pinsOf, pinsOut, pinOp, onStart,
    undoOut, undoAct,
    loopConfig, loopLabel, onLoop, loopReply, loopAct, loopOut,
    touchLoopHook: () => { loopHookAt = Date.now(); },
    overlapNote, withContext, portClash,
  };
}
