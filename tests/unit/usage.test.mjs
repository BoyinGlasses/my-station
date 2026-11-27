import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blankUsage, ctxMax, scanUsage } from '../../server/usage.mjs';

test('scanUsage reads incrementally, dedupes streamed message ids, prices cache/fast/web, and tracks interrupts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, 'session.jsonl');
  const subDir = path.join(dir, 'subagents');
  fs.mkdirSync(subDir);

  const rec = (o) => `${JSON.stringify(o)}\n`;
  // First write: partial streamed message + a half-written trailing line
  fs.writeFileSync(main,
    rec({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 100 }, server_tool_use: { web_search_requests: 1 } } } })
    + '{"type":"assistant","partial":true');

  const u = blankUsage();
  assert.equal(await scanUsage(u, main, subDir), true);
  assert.equal(u.model, 'claude-sonnet-4-6');
  assert.equal(u.in, 6500);
  assert.equal(u.out, 200);
  assert.equal(u.ctx, 6700);
  assert.equal(ctxMax(u), 200_000);
  const firstCost = u.cost;
  assert.ok(firstCost > 0.01);

  // Re-reading with no new bytes returns false
  assert.equal(await scanUsage(u, main, subDir), false);

  // Append rest of incomplete line (invalid/ignored) + updated streamed copy of m1 + subagent + synthetic
  fs.appendFileSync(main, '}\n'
    + rec({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500 } } })
    + rec({ type: 'assistant', message: { id: 'm-syn', model: '<synthetic>', usage: { input_tokens: 9999, output_tokens: 9999 } } }));
  fs.writeFileSync(path.join(subDir, 'sub1.jsonl'),
    rec({ type: 'assistant', message: { id: 's1', model: 'claude-haiku-4-5', usage: { input_tokens: 1000, output_tokens: 100, speed: 'fast' } } }));

  assert.equal(await scanUsage(u, main, subDir), true);
  // m1 input not double-counted; only +300 output delta added + subagent 1000 in / 100 out
  assert.equal(u.in, 7500);
  assert.equal(u.out, 600);
  assert.equal(u.ctx, 7000);   // subagent does not alter main ctx

  // Old user interrupt (> 2m ago) ignored; recent interrupt detected
  const oldTs = new Date(Date.now() - 300_000).toISOString();
  const nowTs = new Date().toISOString();
  fs.appendFileSync(main,
    rec({ type: 'user', timestamp: oldTs, message: { content: '[Request interrupted by user]' } })
    + rec({ type: 'user', timestamp: nowTs, message: { content: '[Request interrupted by user]' } }));
  assert.equal(await scanUsage(u, main, subDir), true);
  assert.equal(u.interrupted, Date.parse(nowTs));

  assert.equal(ctxMax({ model: 'claude-opus-4-6[1m]', ctx: 1000 }), 1_000_000);
  assert.equal(ctxMax({ model: 'claude-sonnet-4-6', ctx: 250_000 }), 1_000_000);
});
