import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTasks } from '../../server/tasks.mjs';
const fixture = new URL('../fixtures/agent-rpc.mjs', import.meta.url).href;

for (const agent of ['codex', 'opencode', 'antigravity']) {
  test(`${agent}: model, resume, image, live result and one-time approvals use the native protocol`, { timeout: 15000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rpc-')), capture = path.join(dir, 'calls'), script = path.join(dir, 'cli.mjs');
    fs.writeFileSync(script, `import {serveFakeAgent} from ${JSON.stringify(fixture)};await serveFakeAgent({agent:${JSON.stringify(agent)},sid:'owned',capture:${JSON.stringify(capture)},permission:true});`);
    const events = [], permissions = []; let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const bin = () => ({ file: process.execPath, args: [script], protocol: agent === 'codex' ? 'codex' : 'acp' });
    const tasks = createTasks({ dataDir: dir, claude: () => null, [agent]: bin, env: () => process.env, onDone: finish, onEvent: (_t, e) => events.push(e),
      onPermission: async (_t, p) => { permissions.push(p); return true; } });
    try {
      assert.equal(tasks.start({ dir, text: 'work', model: 'custom/model', images: ['data:image/png;base64,YQ=='], from: { agent, sid: 'original', fork: false } }).ok, true);
      const t = await done, call = JSON.parse(fs.readFileSync(capture, 'utf8').trim()), approval = JSON.parse(fs.readFileSync(capture + '.approvals', 'utf8'));
      assert.equal(t.error, ''); assert.equal(t.result, 'done');
      assert.equal(call.start.method, agent === 'codex' ? 'thread/resume' : 'session/load');
      assert.equal(call.model, 'custom/model');
      if (agent !== 'codex') assert.ok(call.requests.some((q) => q.method === 'session/set_config_option' && q.params.configId === 'model' && q.params.value === 'custom/model'));
      assert.equal((call.prompt.input || call.prompt.prompt)[1].type, agent === 'codex' ? 'localImage' : 'image');
      assert.equal(permissions[0].tool, 'Bash');
      assert.equal(agent === 'codex' ? approval.result.decision : approval.result.outcome.optionId, agent === 'codex' ? 'accept' : 'once');
      assert.deepEqual(events.map((e) => e.hook_event_name), ['SessionStart', 'UserPromptSubmit', 'Stop']);
      assert.deepEqual(tasks.list(), []);
    } finally { for (const t of tasks.list()) tasks.stop(t.id); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test(`${agent}: stop cancels the native turn and clears its running slot`, { timeout: 15000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rpc-stop-')), script = path.join(dir, 'cli.mjs');
    fs.writeFileSync(script, `import {serveFakeAgent} from ${JSON.stringify(fixture)};await serveFakeAgent({agent:${JSON.stringify(agent)}});`);
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, [agent]: () => ({ file: process.execPath, args: [script], protocol: agent === 'codex' ? 'codex' : 'acp' }), env: () => process.env, onDone: finish });
    try {
      const r = tasks.start({ dir, text: 'hang', from: { agent } });
      while (!tasks.get(r.task.id)?.sid) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(tasks.stop(r.task.id), true);
      const t = await done; assert.equal(t.stopped, true); assert.equal(t.error, ''); assert.deepEqual(tasks.list(), []);
    } finally { for (const t of tasks.list()) tasks.stop(t.id); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('non-Claude work keeps its own runner, namespace, and secret redaction with background work enabled', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-bg-')), script = path.join(dir, 'cli.mjs');
  fs.writeFileSync(script, `import {serveFakeAgent} from ${JSON.stringify(fixture)};await serveFakeAgent({agent:'codex',sid:'same'});`);
  let finish; const done = new Promise((resolve) => { finish = resolve; });
  const tasks = createTasks({ dataDir: dir, claude: () => null, codex: () => ({ file: process.execPath, args: [script], protocol: 'codex' }), env: () => process.env,
    bg: { want: () => true, probe: () => assert.fail('only Claude probes background support') },
    printSettings: () => assert.fail('only Claude receives hook settings'), onDone: finish });
  try {
    const r = tasks.start({ dir, text: 'work token=example-secret-value', from: { agent: 'codex', sid: 'same', fork: false } });
    assert.equal(r.ok, true);
    assert.equal(r.task.mode, 'print');
    assert.doesNotMatch(r.task.text, /example-secret-value/);
    assert.equal(tasks.of('same'), null);
    assert.equal(tasks.of('codex:same')?.id, r.task.id);
    assert.equal(tasks.of('opencode:same'), null);
    const t = await done;
    assert.equal(t.result, 'done'); assert.equal(t.error, '');
  } finally { for (const t of tasks.list()) tasks.stop(t.id); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a protocol CLI that cannot start clears its running slot and reports the failure', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-missing-task-'));
  try {
    let finish; const done = new Promise((resolve) => { finish = resolve; });
    const tasks = createTasks({ dataDir: dir, claude: () => null, codex: () => ({ file: path.join(dir, 'missing-executable'), protocol: 'codex' }), env: () => process.env, onDone: finish });
    assert.equal(tasks.start({ dir, text: 'work', from: { agent: 'codex', sid: 'source', fork: true } }).ok, true);
    const task = await done;
    assert.ok(task.error);
    assert.deepEqual(tasks.list(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
