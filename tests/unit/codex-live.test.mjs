import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { stopProcess } from '../../server/agent-rpc.mjs';

test('agent sessions stay isolated and Codex and OpenCode tasks fork then resume their own branches', async () => {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-live-'));
  const conversations = path.join(dir, 'conversations');
  fs.mkdirSync(conversations);
  const fake = path.join(dir, 'codex.mjs');
  const rpcFixture = new URL('../fixtures/agent-rpc.mjs', import.meta.url).href;
  fs.writeFileSync(fake, `import {serveFakeAgent} from ${JSON.stringify(rpcFixture)};await serveFakeAgent({agent:'codex',sid:'forked',answer:'task completed token=example-secret-value',capture:process.env.OFFICE_DATA_DIR+'/codex-call.jsonl'});`);
  const fakeOpenCode = path.join(dir, 'opencode.mjs');
  fs.writeFileSync(fakeOpenCode, `import {serveFakeAgent} from ${JSON.stringify(rpcFixture)};await serveFakeAgent({agent:'opencode',sid:'oc-fork',answer:'OpenCode finished',capture:process.env.OFFICE_DATA_DIR+'/opencode-call.jsonl'});`);
  const fakeAgy = path.join(dir, 'agy.mjs');
  fs.writeFileSync(fakeOpenCode, `if(process.argv[2]==='models'){console.log('custom/model');process.exit(0)}\n` + fs.readFileSync(fakeOpenCode, 'utf8'));
  fs.writeFileSync(fakeAgy, `import {serveFakeAgent} from ${JSON.stringify(rpcFixture)};await serveFakeAgent({agent:'antigravity',sid:'agy-owned',answer:'Antigravity finished',capture:process.env.OFFICE_DATA_DIR+'/agy-call.jsonl'});`);
  const fakeZcode = path.join(dir, 'zcode.mjs');
  fs.writeFileSync(fakeZcode, `import fs from 'node:fs';fs.appendFileSync(process.env.OFFICE_DATA_DIR+'/zcode-call.jsonl',JSON.stringify({args:process.argv.slice(2)})+'\\n');console.log(JSON.stringify({type:'result',sessionId:'sess_owned',response:'ZCode finished'}));`);
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, HOME: dir, USERPROFILE: dir, OFFICE_NO_NEXT: '1', OFFICE_AG_DIRS: conversations, OFFICE_PORT: String(port), OFFICE_DATA_DIR: dir, OFFICE_HOST: '127.0.0.1', OFFICE_TRANSLATE: '0', OFFICE_CLAUDE_BIN: fake, OFFICE_CODEX_BIN: fake, OFFICE_OPENCODE_BIN: fakeOpenCode, OFFICE_ANTIGRAVITY_BIN: fakeAgy, OFFICE_ZCODE_BIN: fakeZcode, CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), CODEX_HOME: path.join(dir, 'codex') }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const send = (event) => fetch(`${base}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const snapshot = async () => (await (await fetch(`${base}/api/live`)).json()).msgs[0];
  try {
    let up = false;
    for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(`${base}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(up, 'office started');
    await send({ session_id: 'same', hook_event_name: 'SessionStart', cwd: dir });
    await send({ agent: 'codex', session_id: 'same', hook_event_name: 'UserPromptSubmit', cwd: dir, prompt: 'work on Codex' });
    let snap;
    for (let i = 0; i < 50; i++) {
      snap = await snapshot();
      if (snap.sessions.length >= 2 && snap.sessions.some((s) => s.agent === 'codex' && s.lastPrompt === 'work on Codex')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const codex = snap.sessions.find((s) => s.agent === 'codex');
    assert.ok(codex);
    assert.equal(codex.status, 'work');
    assert.equal(codex.acct, null);
    assert.equal(codex.cache, null);
    assert.equal(snap.sessions.length, 2);
    const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = { agent: 'codex', session_id: 'same', cwd: dir, tool_name: 'shell_command', tool_input: { command: 'npm test' }, permission_suggestions: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'shell_command' }] }] };
    assert.equal(await (await post('/hook/permission', payload)).text(), '');
    await post('/api/presence', { page: 'test', focused: true });
    const held = post('/hook/permission', payload);
    let request;
    for (let i = 0; i < 50; i++) { request = (await snapshot()).perms[0]; if (request) break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(request.sess, codex.id);
    assert.equal(request.remember, null);
    assert.notEqual((await post('/api/perm', { id: request.id, choice: 'always' })).status, 200);
    assert.equal((await post('/api/perm', { id: request.id, choice: 'allow' })).status, 200);
    assert.deepEqual(await (await held).json(), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    const heldDeny = post('/hook/permission', payload);
    request = null;
    for (let i = 0; i < 50; i++) { request = (await snapshot()).perms[0]; if (request) break; await new Promise((r) => setTimeout(r, 100)); }
    await post('/api/perm', { id: request.id, choice: 'deny' });
    assert.equal((await (await heldDeny).json()).hookSpecificOutput.decision.behavior, 'deny');
    await post('/api/presence', { page: 'test', focused: false });
    await send({ agent: 'zcode', session_id: 'same', hook_event_name: 'UserPromptSubmit', cwd: dir, prompt: 'work on ZCode' });
    await send({ agent: 'opencode', session_id: 'same', hook_event_name: 'UserPromptSubmit', cwd: dir, prompt: 'work on OpenCode' });
    await send({ agent: 'antigravity', conversationId: 'same', hook_event_name: 'PreInvocation', workspacePaths: [dir], lastUserInput: 'work on Antigravity' });
    for (let i = 0; i < 50; i++) {
      snap = await snapshot();
      if (snap.sessions.length === 5 && ['zcode', 'opencode', 'antigravity'].every((agent) => snap.sessions.some((s) => s.agent === agent))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const agent of ['zcode', 'opencode', 'antigravity']) {
      const session = snap.sessions.find((s) => s.agent === agent);
      assert.equal(session?.status, 'work');
      assert.equal(session.acct, null);
      assert.equal(session.cache, null);
    }
    assert.equal(snap.sessions.length, 5);
    // Upstream's conversation-file watcher and the fork's native hooks share one identity.
    fs.writeFileSync(path.join(conversations, 'same.db'), 'active');
    await new Promise((resolve) => setTimeout(resolve, 3200));
    snap = await snapshot();
    assert.equal(snap.sessions.length, 5);
    assert.equal(snap.sessions.filter((s) => s.sid === 'antigravity:same').length, 1);
    const settings = await (await fetch(`${base}/api/models`)).json();
    assert.equal(settings.ok, true);
    assert.ok(Object.hasOwn(settings, 'main'), 'upstream model settings coexist with discovery');
    const listed = await (await fetch(`${base}/api/models?${new URLSearchParams({ agent: 'opencode', dir })}`)).json();
    assert.deepEqual(listed.models, [{ id: 'custom/model', name: 'custom/model' }]);
    assert.equal((await fetch(`${base}/api/models?agent=opencode&dir=unknown`)).status, 400);
    await send({ agent: 'codex', session_id: 'same', hook_event_name: 'PreToolUse', cwd: dir, tool_name: 'shell_command', tool_input: { command: 'npm test' } });
    await send({ agent: 'codex', session_id: 'same', hook_event_name: 'Stop', cwd: dir, last_assistant_message: 'Done. token=example-secret-value' });
    let history;
    for (let i = 0; i < 50; i++) {
      history = (await (await fetch(`${base}/api/log?id=${codex.id}`)).json()).items;
      if (history.some((x) => x.role === 'claude')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(history.map((x) => x.role), ['user', 'tool', 'claude']);
    assert.equal(history[0].text, 'work on Codex');
    assert.equal(history[1].type, 'test');
    assert.doesNotMatch(history[2].text, /example-secret-value/);
    const transcriptDir = path.join(dir, 'codex', 'sessions'); fs.mkdirSync(transcriptDir, { recursive: true });
    const transcript = path.join(transcriptDir, 'rollout.jsonl');
    fs.writeFileSync(transcript, [
      { type: 'session_meta', payload: { id: 'same' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'earlier conversation' }] } },
    ].map(JSON.stringify).join('\n') + '\n');
    await send({ agent: 'codex', session_id: 'same', hook_event_name: 'SessionStart', cwd: dir, transcript_path: transcript });
    for (let i = 0; i < 50; i++) {
      history = (await (await fetch(`${base}/api/log?id=${codex.id}`)).json()).items;
      if (history.some((x) => x.text === 'earlier conversation')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(history.some((x) => x.text === 'earlier conversation'));
    await send({ agent: 'opencode', session_id: 'late-directory', hook_event_name: 'SessionStart' });
    await new Promise((r) => setTimeout(r, 100));
    await send({ agent: 'opencode', session_id: 'late-directory', hook_event_name: 'UserPromptSubmit', cwd: dir, prompt: 'resumed project' });
    for (let i = 0; i < 50; i++) {
      snap = await snapshot();
      if (snap.sessions.some((s) => s.agent === 'opencode' && s.lastPrompt === 'resumed project')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(snap.sessions.find((s) => s.agent === 'opencode' && s.lastPrompt === 'resumed project').dir);
    const tasks = await (await fetch(`${base}/api/tasks`)).json();
    assert.ok(tasks.sessions.some((s) => s.id === codex.id));
    const invalid = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: 'codex:same', text: 'hello', model: '--unsafe' }) });
    assert.equal(invalid.status, 400);
    const started = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: 'codex:same', text: 'hello token=example-secret-value', model: 'custom-model' }) });
    assert.equal(started.status, 200);
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'codex-call.jsonl')); i++) await new Promise((r) => setTimeout(r, 100));
    const call = JSON.parse(fs.readFileSync(path.join(dir, 'codex-call.jsonl'), 'utf8').split('\n')[0]);
    assert.equal(call.start.method, 'thread/fork'); assert.equal(call.start.params.threadId, 'same');
    assert.equal(call.model, 'custom-model'); assert.equal(call.text, 'hello token=example-secret-value');
    for (let i = 0; i < 50; i++) {
      if ((await (await fetch(`${base}/api/tasks`)).json()).running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const next = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: 'codex:same', text: 'continue' }) });
    assert.equal(next.status, 200);
    let calls = [];
    for (let i = 0; i < 50; i++) {
      calls = fs.readFileSync(path.join(dir, 'codex-call.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (calls.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(calls[1].start.method, 'thread/resume'); assert.equal(calls[1].start.params.threadId, 'forked');
    assert.equal(calls[1].text, 'continue');
    let chat = [];
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'codex' && m.text.startsWith('task completed'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const reply = chat.find((m) => m.tag === 'codex' && m.text.startsWith('task completed'));
    assert.ok(reply);
    assert.doesNotMatch(reply.text, /example-secret-value/);
    assert.ok(chat.some((m) => m.from === 'me' && m.text.includes('hello')));
    assert.doesNotMatch(JSON.stringify(chat), /example-secret-value/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'actions.log'), 'utf8'), /example-secret-value/);
    await send({ agent: 'opencode', session_id: 'same', hook_event_name: 'Stop', cwd: dir });
    for (let i = 0; i < 50; i++) {
      snap = await snapshot();
      if (snap.sessions.some((s) => s.agent === 'opencode' && s.name.endsWith('-sa') && s.status === 'rest')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ocStart = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: 'opencode:same', text: 'review this' }) });
    assert.equal(ocStart.status, 200);
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'opencode-call.jsonl')); i++) await new Promise((r) => setTimeout(r, 100));
    const ocCall = JSON.parse(fs.readFileSync(path.join(dir, 'opencode-call.jsonl'), 'utf8').split('\n')[0]);
    assert.equal(ocCall.start.method, 'session/fork'); assert.equal(ocCall.start.params.sessionId, 'same');
    assert.equal(ocCall.text, 'review this');
    for (let i = 0; i < 50; i++) {
      if ((await (await fetch(`${base}/api/tasks`)).json()).running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ocNext = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: 'opencode:same', text: 'continue review' }) });
    assert.equal(ocNext.status, 200);
    let ocCalls = [];
    for (let i = 0; i < 50; i++) {
      ocCalls = fs.readFileSync(path.join(dir, 'opencode-call.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (ocCalls.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ocCalls[1].start.method, 'session/load'); assert.equal(ocCalls[1].start.params.sessionId, 'oc-fork');
    assert.equal(ocCalls[1].text, 'continue review');
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'opencode' && m.text === 'OpenCode finished')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(chat.some((m) => m.tag === 'opencode' && m.text === 'OpenCode finished'));
    const projectRun = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'codex', text: 'new project task', fresh: true }) });
    assert.equal(projectRun.status, 200);
    for (let i = 0; i < 50; i++) {
      calls = fs.readFileSync(path.join(dir, 'codex-call.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (calls.length === 3) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(calls[2].start.method, 'thread/start');
    assert.equal(calls[2].text, 'new project task');
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'codex' && m.name === 'Codex' && m.text.startsWith('task completed'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(chat.some((m) => m.tag === 'codex' && m.name === 'Codex' && m.text.startsWith('task completed')));
    const agyRun = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'antigravity', text: 'new agy task', fresh: true }) });
    assert.equal(agyRun.status, 200);
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'agy-call.jsonl')); i++) await new Promise((r) => setTimeout(r, 100));
    const agyCall = JSON.parse(fs.readFileSync(path.join(dir, 'agy-call.jsonl'), 'utf8').split('\n')[0]);
    assert.equal(agyCall.start.method, 'session/new');
    assert.equal(agyCall.text, 'new agy task');
    for (let i = 0; i < 50; i++) {
      if ((await (await fetch(`${base}/api/tasks`)).json()).running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const agyNext = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'antigravity', text: 'continue agy', fresh: false }) });
    assert.equal(agyNext.status, 200);
    let agyCalls = [];
    for (let i = 0; i < 50; i++) {
      agyCalls = fs.readFileSync(path.join(dir, 'agy-call.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (agyCalls.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(agyCalls[1].start.method, 'session/load'); assert.equal(agyCalls[1].start.params.sessionId, 'agy-owned');
    assert.equal(agyCalls[1].text, 'continue agy');
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'antigravity' && m.name === 'Antigravity' && m.text === 'Antigravity finished')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(chat.some((m) => m.tag === 'antigravity' && m.name === 'Antigravity' && m.text === 'Antigravity finished'));
    const zRun = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'zcode', text: 'new zcode task', fresh: true }) });
    assert.equal(zRun.status, 200);
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'zcode-call.jsonl')); i++) await new Promise((r) => setTimeout(r, 100));
    const zCall = JSON.parse(fs.readFileSync(path.join(dir, 'zcode-call.jsonl'), 'utf8').split('\n')[0]);
    assert.deepEqual(zCall.args, ['--output-format', 'stream-json', '--mode', 'build', '--disallowed-tools', 'CreateWorkflow,AmendWorkflow', '-p', 'new zcode task']);
    for (let i = 0; i < 50; i++) {
      if ((await (await fetch(`${base}/api/tasks`)).json()).running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const zNext = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'zcode', text: 'continue zcode', fresh: false }) });
    assert.equal(zNext.status, 200);
    let zCalls = [];
    for (let i = 0; i < 50; i++) {
      zCalls = fs.readFileSync(path.join(dir, 'zcode-call.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (zCalls.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(zCalls[1].args, ['--output-format', 'stream-json', '--mode', 'build', '--disallowed-tools', 'CreateWorkflow,AmendWorkflow', '--resume', 'sess_owned', '-p', 'continue zcode']);
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'zcode' && m.name === 'ZCode' && m.text === 'ZCode finished')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(chat.some((m) => m.tag === 'zcode' && m.name === 'ZCode' && m.text === 'ZCode finished'));
    for (let i = 0; i < 50; i++) {
      if ((await (await fetch(`${base}/api/tasks`)).json()).running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const failure = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, agent: 'codex', text: 'simulate failure', fresh: true }) });
    assert.equal(failure.status, 200);
    for (let i = 0; i < 50; i++) {
      chat = (await (await fetch(`${base}/api/chat`)).json()).msgs;
      if (chat.some((m) => m.tag === 'codex' && m.text.includes('partial answer'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const failedReply = chat.find((m) => m.tag === 'codex' && m.text.includes('partial answer'));
    assert.ok(failedReply);
    assert.doesNotMatch(failedReply.text, /example-secret-value/);
    assert.ok(chat.some((m) => m.kind === 'work' && m.work?.state === 'fail'));
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((resolve) => proc.once('exit', resolve));
      stopProcess(proc);
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
