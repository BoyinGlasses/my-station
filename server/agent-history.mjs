// Persist only the redacted user-facing history; never an agent's reasoning or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from './redact.mjs';

export function createAgentHistory(dataDir) {
  const dir = path.join(dataDir, 'agent-history');
  const file = (sid) => path.join(dir, createHash('sha256').update(sid).digest('hex') + '.json');
  const clean = (items) => items.filter((x) => x && ['user', 'claude', 'tool', 'note'].includes(x.role)).slice(-120).map((x) => ({ role: x.role,
    ...Object.fromEntries(['text', 'type', 'label', 'desc'].filter((k) => typeof x[k] === 'string').map((k) => [k, redact(x[k]).slice(0, k === 'text' ? 12000 : 400)])),
    ...(Number.isFinite(x.ts) ? { ts: x.ts } : {}) }));
  let seq = 0;
  return {
    read(sid) {
      try {
        const p = file(sid); if (fs.statSync(p).size > 2_000_000) return [];
        const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
        return saved.sid === sid && Array.isArray(saved.items) ? clean(saved.items) : [];
      } catch { return []; }
    },
    save(sid, items) {
      const p = file(sid), tmp = `${p}.${process.pid}.${++seq}.tmp`;
      fs.mkdirSync(dir, { recursive: true });
      const safe = clean(items);
      try {
        fs.writeFileSync(tmp, JSON.stringify({ sid, items: safe }), { mode: 0o600 });
        fs.renameSync(tmp, p);
      } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        throw err;
      }
    },
  };
}
