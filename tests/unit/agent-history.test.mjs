import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentHistory } from '../../server/agent-history.mjs';

test('agent history survives a restart, stays scoped to the session and stores only redacted public messages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-history-'));
  try {
    const h = createAgentHistory(dir);
    h.save('opencode:../same', [{ role: 'user', text: 'token=example-secret-value', hidden: 'private' }, { role: 'reasoning', text: 'private reasoning' }, { role: 'claude', text: 'done' }]);
    const restored = createAgentHistory(dir).read('opencode:../same');
    assert.deepEqual(restored.map((x) => x.role), ['user', 'claude']);
    assert.doesNotMatch(JSON.stringify(restored), /example-secret-value|private/);
    assert.deepEqual(h.read('antigravity:../same'), []);
    const names = fs.readdirSync(path.join(dir, 'agent-history'));
    assert.equal(names.length, 1); assert.match(names[0], /^[a-f0-9]{64}\.json$/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'agent-history', names[0]), 'utf8'), /example-secret-value|private/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
