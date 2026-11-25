import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTasks } from '../../server/tasks.mjs';

test('Codex work forks the source session, preserves provider environment and returns its streamed result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-task-'));
  const script = path.join(dir, 'fake.mjs'), capture = path.join(dir, 'capture.json');
  fs.writeFileSync(script, `import fs from 'node:fs'; let input=''; for await (const c of process.stdin) input+=c; fs.writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({args:process.argv.slice(2), input, provider:process.env.TEST_PROVIDER})); console.error('non-fatal warning'); console.log(JSON.stringify({type:'thread.started',thread_id:'forked-id'})); process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'completed'}}));`);
  try {
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, codex: () => ({ file: process.execPath, args: [script] }), env: () => ({ ...process.env, TEST_CAPTURE: capture, TEST_PROVIDER: 'external-provider' }), onDone: finish });
    const result = tasks.start({ dir, text: 'Please fix it token=example-secret-value', from: { sid: 'source-id', agent: 'codex', fork: true } });
    assert.equal(result.ok, true);
    const task = await done;
    assert.doesNotMatch(result.task.text, /example-secret-value/);
    const call = JSON.parse(fs.readFileSync(capture));
    assert.deepEqual(call.args, ['exec', 'fork', '--json', 'source-id', '-']);
    assert.equal(call.input, 'Please fix it token=example-secret-value');
    assert.equal(call.provider, 'external-provider');
    assert.equal(task.sid, 'forked-id');
    assert.equal(task.result, 'completed');
    assert.equal(task.error, '');
    assert.deepEqual(tasks.list(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('non-Claude work keeps its own runner and session namespace with background work enabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-bg-'));
  const script = path.join(dir, 'fake.mjs');
  fs.writeFileSync(script, `for await (const c of process.stdin) {} console.log(JSON.stringify({type:'thread.started',thread_id:'same'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));`);
  const done = [];
  const tasks = createTasks({ dataDir: dir, claude: () => null, codex: () => ({ file: process.execPath, args: [script] }), env: () => process.env,
    bg: { want: () => true, probe: () => assert.fail('only Claude probes background support') },
    printSettings: () => assert.fail('only Claude receives hook settings'), onDone: (t) => done.push(t) });
  try {
    const r = tasks.start({ dir, text: 'work', from: { agent: 'codex', sid: 'same', fork: false } });
    assert.equal(r.task.mode, 'print');
    assert.equal(tasks.of('same'), null);
    assert.equal(tasks.of('codex:same')?.id, r.task.id);
    assert.equal(tasks.of('opencode:same'), null);
    while (!done.length) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(done[0].result, 'done');
    assert.equal(done[0].error, '');
  } finally { for (const t of tasks.list()) tasks.stop(t.id); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a CLI that cannot start clears its running slot and reports the failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-missing-task-'));
  try {
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, codex: () => ({ file: path.join(dir, 'missing-executable') }), env: () => process.env, onDone: finish });
    assert.equal(tasks.start({ dir, text: 'work', from: { agent: 'codex', sid: 'source', fork: true } }).ok, true);
    const task = await done;
    assert.ok(task.error);
    assert.deepEqual(tasks.list(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
