// Tool classification, touched-image registry, subagent/background/todo trackers,
// and JSONL transcript readers (titles, last replies, origins, conversation history).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { redact } from './redact.mjs';
import { readCodexHistory } from './codex-history.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unwrapPaste = (s) => String(s ?? '').replace(/<\/?pasted_content\b[^>]*>/g, ' ');
const base = (p) => (p ? path.basename(String(p)) : '');
const host = (u) => { try { return new URL(u).hostname; } catch { return 'web'; } };

export const IMG_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
export const STRIP_TAGS = /<(system-reminder|ide_selection|ide_opened_file|command-message|command-name|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|user-prompt-submit-hook|agent-message)[^>]*>[\s\S]*?<\/\1>/g;

const CMD_LABELS = [
  [/^(npm|pnpm|yarn|bun)( run)? test\b|\bvitest\b|\bjest\b/, 'test'],
  [/^(npm|pnpm|yarn|bun)( run)? build\b|\bnext build\b/, 'build'],
  [/^(npm|pnpm|yarn|bun)( run)? dev\b|\bnext dev\b/, 'dev'],
  [/^(npm|pnpm|yarn|bun)( run)? lint\b|\beslint\b/, 'lint'],
  [/^(npm|pnpm|yarn|bun) (i|install|add|ci)\b/, 'install'],
  [/\btsc\b/, 'tsc'],
  [/^git (status|diff|log|show|blame)\b/, 'gitLog'],
  [/^git (add|commit)\b/, 'commit'],
  [/^git push\b/, 'push'],
  [/^git (pull|fetch|checkout|switch)\b/, 'sync'],
  [/^(curl|wget|http)\b/, 'api'],
  [/^(ssh|scp|rsync)\b/, 'remote'],
  [/^(psql|mysql|sqlite3|supabase)\b/, 'db'],
  [/^(docker|docker-compose)\b/, 'docker'],
  [/playwright/, 'ui'],
  [/^(python3?|node|tsx|ts-node|deno)\b/, 'script'],
  [/^(ls|cat|head|tail|find|grep|rg|wc|sed|awk|du|tree)\b/, 'files'],
  [/^(rm|mv|cp|mkdir|touch|chmod|ln)\b/, 'tidy'],
  [/^(kill|pkill|lsof|ps)\b/, 'procs'],
  [/^open\b/, 'open'],
];

const TODO_STATUS = { completed: 'done', in_progress: 'doing', pending: 'todo' };
const lastField = (text, field) => {
  let m, out = null;
  const re = new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  while ((m = re.exec(text))) out = m[1];
  if (out == null) return null;
  try { return JSON.parse(`"${out}"`); } catch { return null; }
};

export function createTranscripts({
  dataDir, claudeDir, home, tr, toVi, viCached, pub, broadcast, bySid, getThreads, getAgentHistory,
}) {
  function bashLabel(i) {
    if (i.description) return clip(redact(oneLine(i.description)), 60);
    let c = String(i.command || '').split('\n')[0].trim().replace(/^cd\s+\S+\s*&&\s*/, '');
    c = redact(c);
    const short = c.split(/\s+/).slice(0, 3).join(' ');
    const hit = CMD_LABELS.find(([re]) => re.test(c));
    return clip(hit ? `${tr(`server.cmd.${hit[1]}`)} · ${short}` : short, 48);
  }

  const IMG_FILE = path.join(dataDir, 'images.json');
  const images = (() => { try { return new Map(Object.entries(JSON.parse(fs.readFileSync(IMG_FILE, 'utf8')))); } catch { return new Map(); } })();
  let imgSave = null;
  function imageId(file) {
    if (!file || typeof file !== 'string' || !IMG_EXT[path.extname(file).slice(1).toLowerCase()]) return null;
    const abs = path.resolve(file), id = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 16);
    if (images.get(id) === abs) return id;
    images.set(id, abs);
    while (images.size > 400) images.delete(images.keys().next().value);
    clearTimeout(imgSave);
    imgSave = setTimeout(() => fsp.mkdir(dataDir, { recursive: true }).then(() => fsp.writeFile(IMG_FILE, JSON.stringify(Object.fromEntries(images)))).catch(() => {}), 2000);
    return id;
  }

  function classify(name = '', input = {}) {
    const i = input || {};
    switch (name) {
      case 'Read': return { type: 'read', label: base(i.file_path), file: i.file_path };
      case 'NotebookRead': return { type: 'read', label: base(i.notebook_path) };
      case 'Grep': return { type: 'grep', label: clip(redact(oneLine(i.pattern)), 40) };
      case 'Glob': return { type: 'glob', label: clip(oneLine(i.pattern), 40) };
      case 'Edit': case 'MultiEdit': return { type: 'edit', label: base(i.file_path), file: i.file_path };
      case 'NotebookEdit': return { type: 'edit', label: base(i.notebook_path) };
      case 'Write': return { type: 'write', label: base(i.file_path), file: i.file_path };
      case 'Bash': return { type: 'bash', label: bashLabel(i), tr: !!i.description };
      case 'WebSearch': return { type: 'web', label: clip(redact(oneLine(i.query)), 48) };
      case 'WebFetch': return { type: 'fetch', label: host(i.url) };
      case 'Agent': case 'Task': return { type: 'agent', label: i.subagent_type || 'agent', desc: clip(redact(oneLine(i.description)), 50) };
      case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': return { type: 'plan', label: tr('server.tool.todos') };
      case 'EnterPlanMode': case 'ExitPlanMode': return { type: 'plan', label: tr('server.tool.plan') };
      case 'AskUserQuestion': return { type: 'ask', label: tr('server.tool.ask') };
      case 'Skill': return { type: 'skill', label: clip(oneLine(i.skill || i.name || 'skill'), 32) };
      case 'ToolSearch': return { type: 'skill', label: tr('server.tool.search') };
      default:
        if (name.startsWith('mcp__')) { const p = name.split('__'); return { type: 'mcp', label: clip(`${p[1]} · ${p.slice(2).join('__')}`, 40) }; }
        return { type: 'other', label: name || tr('server.tool.other') };
    }
  }

  async function classifyVi(name, input) {
    const c = classify(name, input);
    if (c.tr) c.label = await toVi(c.label);
    if (c.desc) c.desc = await toVi(c.desc);
    return c;
  }

  const transcriptOf = (s) => (s.agent && s.agent !== 'claude' ? null : s.transcript || (s.sid && s.cwd ? path.join(claudeDir, 'projects', s.cwd.replace(/[^A-Za-z0-9-]/g, '-'), `${s.sid}.jsonl`) : null));

  function subDir(s) {
    if (s.agent && s.agent !== 'claude') return null;
    const t = transcriptOf(s);
    return t && s.sid ? path.join(path.dirname(t), s.sid, 'subagents') : null;
  }
  async function subMeta(s, agentId) {
    const dir = subDir(s);
    if (!dir || !/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
    try { return JSON.parse(await fsp.readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8')); } catch { return null; }
  }
  async function subModel(s, agentId) {
    const dir = subDir(s);
    if (!dir || !/^[A-Za-z0-9_-]+$/.test(agentId)) return '';
    let fh;
    try {
      fh = await fsp.open(path.join(dir, `agent-${agentId}.jsonl`), 'r');
      const { size } = await fh.stat(), n = Math.min(size, 65536), buf = Buffer.alloc(n);
      await fh.read(buf, 0, n, size - n);
      return [...buf.toString('utf8').matchAll(/"model":"(claude-[A-Za-z0-9.[\]-]{1,60})"/g)].at(-1)?.[1] || '';
    } catch { return ''; } finally { await fh?.close(); }
  }
  function lookModel(s, x, now = Date.now()) {
    if (x.model || now - (x.modelAt || 0) < 8000) return;
    x.modelAt = now;
    subModel(s, x.id).then((m) => { if (m && m !== x.model) { x.model = m; broadcast({ k: 'sess', s: pub(s) }); } });
  }
  function ensureSub(s, agentId, type, now) {
    let x = s.subs[agentId];
    if (!x) {
      x = s.subs[agentId] = { id: agentId, type: type || 'agent', desc: '', startedAt: now, seenAt: now, steps: 0, last: null };
      lookModel(s, x, now);
      subMeta(s, agentId).then(async (m) => {
        if (!m) return;
        x.desc = clip(redact(oneLine(await toVi(redact(oneLine(m.description || ''))))), 70);
        if (m.agentType) x.type = m.agentType;
        broadcast({ k: 'sess', s: pub(s) });
      });
    }
    if (type && x.type === 'agent') x.type = type;
    return x;
  }
  function finishSub(s, agentId, now) {
    const x = s.subs[agentId];
    if (!x) return null;
    delete s.subs[agentId];
    x.endedAt = now;
    if (!x.model) { x.modelAt = 0; lookModel(s, x, now); }
    s.doneSubs = [x, ...(s.doneSubs || [])].slice(0, 8);
    return x;
  }

  function trackBackground(s, p) {
    const resp = p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : null;
    s.bg ||= new Map();
    if (p.hook_event_name === 'PostToolUse' && resp?.backgroundTaskId) {
      const i = p.tool_input || {};
      s.bg.set(String(resp.backgroundTaskId).slice(0, 60), { id: String(resp.backgroundTaskId).slice(0, 60), desc: clip(redact(oneLine(i.description || i.command || tr('server.tool.background'))), 70), at: Date.now() });
    }
    if (p.hook_event_name === 'PostToolUse' && /^(KillShell|KillBash|TaskStop)$/.test(p.tool_name || '')) {
      const id = String((p.tool_input || {}).shell_id || (p.tool_input || {}).task_id || ''); if (id) s.bg.delete(id);
    }
    if (Array.isArray(p.background_tasks)) {
      const running = p.background_tasks.filter((t) => t && t.id && t.type !== 'subagent' && (!t.status || t.status === 'running'));
      const keep = new Set(running.map((t) => String(t.id).slice(0, 60)));
      for (const id of [...s.bg.keys()]) if (!keep.has(id)) s.bg.delete(id);
      for (const t of running) { const id = String(t.id).slice(0, 60); if (!s.bg.has(id)) s.bg.set(id, { id, desc: clip(redact(oneLine(t.description || t.command || t.type || tr('server.tool.background'))), 70), at: Date.now() }); }
    }
  }

  function trackTodos(s, p) {
    const i = p.tool_input || {}, txt = (v) => clip(redact(oneLine(v)), 80);
    if (p.tool_name === 'TodoWrite' && Array.isArray(i.todos)) {
      s.todos = i.todos.slice(0, 20).map((t) => ({ text: txt(t.content || t.activeForm), status: TODO_STATUS[t.status] || 'todo' })).filter((t) => t.text);
    } else if (p.tool_name === 'TaskCreate' && i.subject) {
      s.tasks ||= [];
      const m = /#(\d+)/.exec(JSON.stringify(p.tool_response ?? ''));
      s.tasks.push({ id: m ? m[1] : String(s.tasks.length + 1), text: txt(i.subject), status: 'todo' });
      s.todos = s.tasks.slice(-20).map(({ text, status }) => ({ text, status }));
    } else if (p.tool_name === 'TaskUpdate' && s.tasks && i.taskId != null) {
      const t = s.tasks.find((x) => x.id === String(i.taskId));
      if (t) {
        if (i.status === 'deleted') s.tasks = s.tasks.filter((x) => x !== t);
        else { if (i.status) t.status = TODO_STATUS[i.status] || t.status; if (i.subject) t.text = txt(i.subject); }
      }
      s.todos = s.tasks.slice(-20).map(({ text, status }) => ({ text, status }));
    }
  }

  async function lastReplyOf(s) {
    const file = transcriptOf(s); if (!file) return '';
    let fh;
    try {
      fh = await fsp.open(file, 'r');
      const { size } = await fh.stat(), len = Math.min(size, 400_000), buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"assistant"')) continue;
        let j; try { j = JSON.parse(lines[i]); } catch { continue; }
        const c = j.type === 'assistant' && j.message?.content;
        const text = Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ').trim() : '';
        if (text) return text;
      }
    } catch { /* no transcript */ } finally { await fh?.close(); }
    return '';
  }

  const ORIGINS = { 'claude-vscode': 'IDE', cli: 'Terminal', 'claude-desktop': () => tr('server.originApp'), remote: 'Cloud', 'sdk-cli': 'Agent SDK', 'sdk-ts': 'Agent SDK', 'sdk-py': 'Agent SDK' };
  const originName = (e) => { const o = Object.hasOwn(ORIGINS, e) ? ORIGINS[e] : null; return typeof o === 'function' ? o() : o || e; };
  async function originOf(s) {
    const file = transcriptOf(s); if (!file) return '';
    let fh;
    try { fh = await fsp.open(file, 'r'); const buf = Buffer.alloc(65536); const { bytesRead } = await fh.read(buf, 0, buf.length, 0); const m = /"entrypoint":"([^"]+)"/.exec(buf.toString('utf8', 0, bytesRead)); return m ? originName(m[1]) : ''; }
    catch { return ''; } finally { await fh?.close(); }
  }

  async function refreshTitle(s, first = false) {
    const file = transcriptOf(s); if (!file) return;
    s.titleAt = Date.now();
    let fh;
    try {
      fh = await fsp.open(file, 'r');
      const { size } = await fh.stat();
      if (size === s.titleSize) return;
      s.titleSize = size;
      const len = Math.min(size, 600_000), buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const tail = buf.toString('utf8');
      let custom = lastField(tail, 'customTitle');
      const ai = lastField(tail, 'aiTitle');
      if (custom == null && first && size > len) {
        const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) if (line.includes('"custom-title"')) custom = lastField(line, 'customTitle') ?? custom;
      }
      if (custom != null) s.customTitle = custom;
      const title = clip(redact(oneLine(s.customTitle || ai || s.aiTitle || '')), 80);
      if (ai) s.aiTitle = ai;
      if (title && title !== s.title) { s.title = title; broadcast({ k: 'sess', s: pub(s) }); }
    } catch { /* no transcript yet */ }
    finally { await fh?.close(); }
  }

  async function readLog(s, n = 120, agentId = null) {
    if (s.agent && s.agent !== 'claude') {
      if (agentId) return [];
      const agentHistory = getAgentHistory();
      const branch = getThreads().get(s.sid), branchSid = branch?.sid && `${s.agent}:${branch.sid}`;
      if (branchSid && branchSid !== s.sid) {
        const items = bySid(branchSid)?.history || agentHistory.read(branchSid);
        if (items.length) return [...(s.history || []), ...items].slice(-n);
      }
      if (s.agent === 'codex' && s.codexTranscript) {
        const items = await readCodexHistory({ root: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions'), file: s.codexTranscript, sid: s.sid.slice('codex:'.length), n });
        if (items.length) return items;
      }
      return (s.history || []).slice(-n);
    }
    let file = transcriptOf(s);
    if (agentId) {
      const dir = subDir(s);
      file = dir && /^[A-Za-z0-9_-]+$/.test(agentId) ? path.join(dir, `agent-${agentId}.jsonl`) : null;
    }
    if (!file) return [];
    let fh;
    try { fh = await fsp.open(file, 'r'); } catch { return []; }
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 4_000_000);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      if (size > len) lines.shift();
      const items = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if ((j.isSidechain && !agentId) || j.isMeta) continue;
        const ts = j.timestamp ? Date.parse(j.timestamp) : 0;
        const c = j.message?.content;
        if (j.type === 'user') {
          const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text) : [];
          const imgs = Array.isArray(c) ? c.filter((b) => b.type === 'image').length : 0;
          const raw = texts.join('\n'), t = unwrapPaste(raw.replace(STRIP_TAGS, '')).trim();
          if (!t && !imgs) { if (/<agent-message/.test(raw)) items.push({ role: 'note', text: tr('server.note.subReport'), ts }); continue; }
          if (j.isCompactSummary || /^This session is being continued from a previous conversation/.test(t)) { items.push({ role: 'summary', text: clip(redact(t), 12000), ts }); continue; }
          if (/^\[Request interrupted by user/.test(t)) { items.push({ role: 'note', text: tr('server.note.interrupted'), ts }); continue; }
          items.push({ role: 'user', text: clip(redact(t), 8000), imgs, ts });
        } else if (j.type === 'assistant' && Array.isArray(c)) {
          for (const b of c) {
            if (b.type === 'text' && b.text?.trim()) items.push({ role: 'claude', text: clip(redact(b.text.trim()), 12000), ts });
            else if (b.type === 'tool_use') {
              const k = classify(b.name, b.input);
              items.push({ role: 'tool', type: k.type, label: (k.tr && viCached(k.label)) || k.label, desc: k.desc ? viCached(k.desc) || k.desc : '', ts });
            }
          }
        }
      }
      return items.slice(-n);
    } finally { await fh.close(); }
  }

  async function recallTask(s) {
    const items = await readLog(s, 300).catch(() => []);
    const u = items.findLast((x) => x.role === 'user');
    if (!u || s.lastPrompt) return;
    s.lastPrompt = clip(oneLine(unwrapPaste(u.text)), 90);
    if (!s.taskStart) s.taskStart = u.ts || 0;
    if (s.status === 'rest') s.doneAt = items.at(-1)?.ts || 0;
    broadcast({ k: 'sess', s: pub(s) });
  }

  return {
    images, imageId, bashLabel, classify, classifyVi,
    subDir, lookModel, ensureSub, finishSub,
    trackBackground, trackTodos,
    transcriptOf, lastReplyOf, originOf, refreshTitle, recallTask, readLog,
  };
}
