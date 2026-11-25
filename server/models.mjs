import { execFile } from 'node:child_process';
import { createAgentRpc } from './agent-rpc.mjs';

const valid = (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/#-]{0,199}$/.test(id);
const clean = (items) => {
  const seen = new Set();
  return items.filter((m) => valid(m.id) && !seen.has(m.id) && seen.add(m.id)).slice(0, 1000)
    .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id }));
};

export async function listModels(agent, bin, cwd) {
  if (!bin || !['claude', 'opencode', 'antigravity', 'codex'].includes(agent)) return [];
  if (agent === 'claude') return ['opus', 'sonnet', 'haiku'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
  const options = { cwd, env: { ...process.env, ...bin.env }, windowsHide: true };
  if (agent === 'opencode') options.env.PWD = cwd;
  if (agent !== 'codex') return new Promise((resolve, reject) => {
    execFile(bin.file, [...(bin.args || []), 'models'], { ...options, timeout: 15000, maxBuffer: 1_000_000 }, (err, out) => {
      if (err) return reject(err);
      resolve(clean(out.split(/\r?\n/).map((line) => {
        const [id, name] = line.trim().split('\t');
        return { id: agent === 'opencode' && !id.includes('/') ? '' : id, name: name || id };
      })));
    });
  });
  const rpc = createAgentRpc(bin, ['app-server'], options), items = [], cursors = new Set();
  try {
    await rpc.request('initialize', { clientInfo: { name: 'my_office', version: '0.6.0' } }, 15000);
    rpc.notify('initialized');
    let cursor;
    do {
      const result = await rpc.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }, 15000);
      if (!Array.isArray(result.data)) throw new Error('Invalid model list');
      items.push(...result.data.map((m) => ({ id: m?.model, name: m?.displayName || m?.model })));
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Model pagination repeated a cursor');
      cursors.add(cursor);
    } while (cursor && items.length < 1000);
    return clean(items);
  } finally { await rpc.close(); }
}

// "Model: người điều phối và subagent" (Settings → More): the model a session runs on (the coordinator: "model" in
// ~/.claude/settings.json) and the one its subagents run on (env CLAUDE_CODE_SUBAGENT_MODEL: the ones Claude doesn't
// pick a model for; with CLAUDE_CODE_SUBAGENT_MODEL_FORCE, every one), and a short note in ~/.claude/CLAUDE.md that asks
// Claude to hand the independent parts of a big task to subagents. Claude Code reads all of it as a session starts: the
// sessions open now keep what they started with. The other accounts share both files by a link.

export const MAIN = ['opus', 'sonnet', ''];          // ('' = Claude Code's own default)
export const SUB = ['', 'sonnet', 'haiku', 'opus'];  // ('' = the same as the main session)
const SUB_KEY = 'CLAUDE_CODE_SUBAGENT_MODEL', FORCE_KEY = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE';

/** What settings.json says now: { main, sub, force } (a model the office doesn't offer is shown as it is). */
export function modelsOf(settings) {
  const env = settings?.env || {}, sub = String(env[SUB_KEY] || '');
  return { main: String(settings?.model || ''), sub: sub === 'inherit' ? '' : sub, force: !!sub && sub !== 'inherit' && /^(1|true)$/i.test(String(env[FORCE_KEY] || '')) };
}
/** settings.json with these set (what isn't given stays); the rest of the file as it was. */
export function withModels(settings, { main, sub, force } = {}) {
  const out = { ...(settings || {}) }, env = { ...(out.env || {}) };
  if (main !== undefined) { if (main) out.model = main; else delete out.model; }
  if (sub !== undefined) { if (sub) env[SUB_KEY] = sub; else delete env[SUB_KEY]; }
  if (force !== undefined || sub !== undefined) { if ((force ?? modelsOf(settings).force) && env[SUB_KEY]) env[FORCE_KEY] = '1'; else delete env[FORCE_KEY]; }
  if (Object.keys(env).length) out.env = env; else delete out.env;
  return out;
}

// the note, between two markers of the office's own: taken out again exactly as it went in
const OPEN = '<!-- my-office:subagents -->', CLOSE = '<!-- /my-office:subagents -->';
const BLOCK = new RegExp(`\\n*${OPEN}[\\s\\S]*?${CLOSE}\\n?`);
export const hasSplit = (md) => String(md || '').includes(OPEN);
/** CLAUDE.md with the note (on) or without it (off); what else is in it stays as it was. */
export function withSplit(md, on, note) {
  const rest = String(md || '').replace(BLOCK, '\n').replace(/\n{3,}$/, '\n\n').replace(/^\n+$/, '');
  if (!on) return rest.trim() ? `${rest.replace(/\n+$/, '')}\n` : '';
  return `${rest.trim() ? `${rest.replace(/\n+$/, '')}\n\n` : ''}${OPEN}\n${String(note).trim()}\n${CLOSE}\n`;
}
