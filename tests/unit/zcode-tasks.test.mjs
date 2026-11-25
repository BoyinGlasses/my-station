import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTasks } from '../../server/tasks.mjs';

test('ZCode work uses the confirmation-gated mode and captures its result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-zcode-task-'));
  const script = path.join(dir, 'fake.mjs'), capture = path.join(dir, 'capture.json');
  fs.writeFileSync(script, `import fs from 'node:fs';fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),provider:process.env.TEST_PROVIDER}));console.log(JSON.stringify({type:'result',sessionId:'sess_owned',response:'ZCode completed'}));`);
  try {
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, zcode: () => ({ file: process.execPath, args: [script] }), env: () => ({ ...process.env, TEST_CAPTURE: capture, TEST_PROVIDER: 'external-provider' }), onDone: finish });
    const started = tasks.start({ dir, text: 'Review this', from: { agent: 'zcode', sid: null, fork: false } });
    assert.equal(started.ok, true);
    const task = await done, call = JSON.parse(fs.readFileSync(capture));
    assert.deepEqual(call.args, ['--output-format', 'stream-json', '--mode', 'build', '--disallowed-tools', 'CreateWorkflow,AmendWorkflow', '-p', 'Review this']);
    assert.equal(call.provider, 'external-provider');
    assert.equal(task.sid, 'sess_owned');
    assert.equal(task.result, 'ZCode completed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
