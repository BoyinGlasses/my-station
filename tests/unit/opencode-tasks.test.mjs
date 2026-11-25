import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTasks } from '../../server/tasks.mjs';

test('OpenCode work forks the selected session without auto-approving permissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-opencode-task-'));
  const script = path.join(dir, 'fake.mjs'), capture = path.join(dir, 'capture.json');
  fs.writeFileSync(script, `import fs from 'node:fs';let input='';for await(const c of process.stdin)input+=c;fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),input,provider:process.env.TEST_PROVIDER,pwd:process.env.PWD}));console.log(JSON.stringify({type:'step_start',sessionID:'oc-fork'}));console.log(JSON.stringify({type:'text',sessionID:'oc-fork',part:{text:'OpenCode completed'}}));`);
  try {
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, opencode: () => ({ file: process.execPath, args: [script] }), env: () => ({ ...process.env, PWD: '/other-project', TEST_CAPTURE: capture, TEST_PROVIDER: 'external-provider' }), onDone: finish });
    const started = tasks.start({ dir, text: 'Review this', model: 'custom/my-model', from: { sid: 'source', agent: 'opencode', fork: true } });
    assert.equal(started.ok, true);
    const task = await done, call = JSON.parse(fs.readFileSync(capture));
    assert.deepEqual(call.args, ['run', '--format', 'json', '--model', 'custom/my-model', '--session', 'source', '--fork']);
    assert.equal(call.input, 'Review this');
    assert.equal(call.provider, 'external-provider');
    assert.equal(call.pwd, dir);
    assert.equal(task.sid, 'oc-fork');
    assert.equal(task.result, 'OpenCode completed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
