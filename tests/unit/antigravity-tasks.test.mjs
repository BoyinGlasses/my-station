import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTasks } from '../../server/tasks.mjs';

test('Antigravity starts an office-owned conversation and keeps the configured provider', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agy-task-'));
  const script = path.join(dir, 'fake.mjs'), capture = path.join(dir, 'capture.json');
  fs.writeFileSync(script, `import fs from 'node:fs';let input='';for await(const c of process.stdin)input+=c;fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),input,provider:process.env.TEST_PROVIDER}));console.log(JSON.stringify({event:'result',result:{conversation_id:'ag-conversation',status:'SUCCESS',response:'Antigravity completed'}}));`);
  try {
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, antigravity: () => ({ file: process.execPath, args: [script] }), env: () => ({ ...process.env, TEST_CAPTURE: capture, TEST_PROVIDER: 'external-provider' }), onDone: finish });
    const started = tasks.start({ dir, text: 'Review this', from: { agent: 'antigravity', sid: null, fork: false } });
    assert.equal(started.ok, true);
    const task = await done, call = JSON.parse(fs.readFileSync(capture));
    assert.deepEqual(call.args, ['--input-format', 'stream-json', '--output-format', 'stream-json']);
    assert.deepEqual(JSON.parse(call.input), { event: 'user', message: { role: 'user', content: 'Review this' } });
    assert.equal(call.provider, 'external-provider');
    assert.equal(task.sid, 'ag-conversation');
    assert.equal(task.result, 'Antigravity completed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
