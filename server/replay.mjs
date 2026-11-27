// Replay recorder & range reader: appends redacted office events to data/replay/YYYY-MM-DD.jsonl
// with periodic full snapshots so any minute of the last 7 days can be replayed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const KEEP_DAYS = 7;
const RECORDED = new Set(['ev', 'sess', 'gone', 'stats']);

export function createReplay({ dataDir, today, snapshot }) {
  const dir = path.join(dataDir, 'replay');
  fs.mkdirSync(dir, { recursive: true });
  let rec = { day: '', out: null, snapAt: 0 };

  function prune() {
    const cut = new Date(Date.now() - KEEP_DAYS * 86400e3).toLocaleDateString('sv-SE');
    fsp.readdir(dir).then((names) => {
      for (const n of names) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) < cut) fsp.rm(path.join(dir, n)).catch(() => {});
    }).catch(() => {});
  }

  function record(m) {
    if (!RECORDED.has(m.k)) return;
    const t = Date.now(), day = today();
    if (day !== rec.day) {
      rec.out?.end();
      rec = { day, out: fs.createWriteStream(path.join(dir, `${day}.jsonl`), { flags: 'a' }), snapAt: 0 };
      rec.out.on('error', (err) => console.error('replay log', err.message));
      prune();
    }
    rec.out.write(JSON.stringify({ t, m }) + '\n');
    if (t - rec.snapAt > 600_000) { rec.snapAt = t; rec.out.write(JSON.stringify({ t, m: snapshot() }) + '\n'); }
  }

  async function days() {
    const out = [];
    for (const n of (await fsp.readdir(dir).catch(() => [])).sort().reverse()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)) continue;
      const st = await fsp.stat(path.join(dir, n)).catch(() => null);
      if (st && st.size) out.push({ day: n.slice(0, 10), bytes: st.size });
    }
    return out;
  }

  async function range(day, from, to, max = 80_000) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { items: [], truncated: false };
    const file = path.join(dir, `${day}.jsonl`);
    let items = [], truncated = false;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line) continue;
        let x; try { x = JSON.parse(line); } catch { continue; }
        if (x.t > to) break;
        if (x.t <= from && x.m.k === 'snap') items = [];
        items.push(x);
        if (items.length >= max) { truncated = true; break; }
      }
    } catch { /* no file for that day */ }
    finally { rl.close(); }
    return { items, truncated };
  }

  return { dir, record, days, range };
}
