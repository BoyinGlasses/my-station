import fs from 'node:fs/promises';
import path from 'node:path';
import { redact } from './redact.mjs';

// The hook's path is untrusted: only read a transcript inside Codex's sessions directory whose metadata matches.
export async function readCodexHistory({ root, file, sid, n = 120 }) {
  if (typeof file !== 'string' || typeof sid !== 'string' || !sid) return [];
  let handle;
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    const rel = path.relative(realRoot, realFile);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return [];
    handle = await fs.open(realFile, 'r');
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, 1_000_000));
    await handle.read(head, 0, head.length, 0);
    const newline = head.indexOf(10);
    if (newline < 0) return [];
    const meta = JSON.parse(head.subarray(0, newline).toString('utf8'));
    if (meta.type !== 'session_meta' || meta.payload?.id !== sid) return [];
    const len = Math.min(size, 4_000_000), tail = Buffer.alloc(len);
    await handle.read(tail, 0, len, size - len);
    const lines = tail.toString('utf8').split('\n');
    if (size > len) lines.shift();
    const items = [];
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const p = row.payload;
      if (row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p?.type) && typeof p.name === 'string') {
        let input = p.arguments || p.input;
        if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
        const name = p.name, bash = ['exec_command', 'shell_command', 'shell'].includes(name), edit = name === 'apply_patch';
        const label = bash && typeof (input?.cmd || input?.command) === 'string' ? (input.cmd || input.command).split('\n')[0] : name;
        items.push({ role: 'tool', type: bash ? 'bash' : edit ? 'edit' : 'other', label: redact(label).slice(0, 80), ts: Date.parse(row.timestamp) || 0 });
        continue;
      }
      if (row.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role) || p.phase === 'analysis') continue;
      const text = (Array.isArray(p.content) ? p.content : []).filter((c) => ['input_text', 'output_text'].includes(c.type) && typeof c.text === 'string').map((c) => c.text).join('\n').trim();
      if (text) items.push({ role: p.role === 'user' ? 'user' : 'claude', text: redact(text).slice(0, p.role === 'user' ? 8000 : 12000), ts: Date.parse(row.timestamp) || 0 });
    }
    return items.slice(-n);
  } catch { return []; }
  finally { await handle?.close(); }
}
