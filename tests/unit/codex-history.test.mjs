import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory } from '../../server/codex-history.mjs';

test('Codex history reads the matching session, redacts secrets and excludes private reasoning', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'office-history-'));
  const root = path.join(dir, 'sessions'); await fs.mkdir(root);
  const file = path.join(root, 'rollout.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'thread-1' } },
    { timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the test' }] } },
    { timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test token=some-secret-value' }) } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'analysis', content: [{ type: 'output_text', text: 'private reasoning' }] } },
    { timestamp: '2026-01-01T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done token=some-secret-value' }] } },
  ];
  try {
    await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
    const items = await readCodexHistory({ root, file, sid: 'thread-1' });
    assert.deepEqual(items.map((x) => x.role), ['user', 'tool', 'claude']);
    assert.equal(items[0].text, 'Fix the test');
    assert.equal(items[1].type, 'bash');
    assert.doesNotMatch(items[1].label, /some-secret-value/);
    assert.doesNotMatch(items[2].text, /some-secret-value/);
    assert.deepEqual(await readCodexHistory({ root, file, sid: 'other' }), []);
    assert.deepEqual(await readCodexHistory({ root: path.join(dir, 'elsewhere'), file, sid: 'thread-1' }), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
