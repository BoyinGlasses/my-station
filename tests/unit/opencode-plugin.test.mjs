import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOfficePlugin, createOpenCode2Plugin } from '../../hooks/opencode.mjs';

test('OpenCode plugin forwards native session and tool events without exposing credentials', async () => {
  const events = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const plugin = await createOfficePlugin(server.address().port)({ directory: '/work' });
    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 's1', directory: '/work' } } } });
    await plugin.event({ event: { type: 'session.next.prompt.admitted', properties: { sessionID: 's1', prompt: { text: 'fix this' } } } });
    await plugin['tool.execute.before']({ sessionID: 's1', tool: 'bash', callID: 'c1' }, { args: { command: 'npm test' } });
    await plugin['tool.execute.after']({ sessionID: 's1', tool: 'bash', callID: 'c1', args: { command: 'npm test' } }, { title: '', output: 'ok', metadata: {} });
    await plugin.event({ event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } } });
    assert.deepEqual(events.map((x) => x.hook_event_name), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    assert.ok(events.every((x) => x.agent === 'opencode' && x.session_id === 's1' && x.cwd === '/work'));
    assert.equal(events[1].prompt, 'fix this');
    assert.equal(events[2].tool_input.command, 'npm test');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('OpenCode 2 setup subscribes to execution lifecycle and prompt hooks', async () => {
  const events = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let prompt, finish;
  const done = new Promise((resolve) => { finish = resolve; });
  try {
    const plugin = createOpenCode2Plugin(server.address().port);
    const dispose = await plugin.setup({ session: { hook: async (_name, fn) => { prompt = fn; return { dispose() {} }; } }, event: { subscribe: async function* () {
      yield { type: 'session.created', data: { sessionID: 's2', location: { directory: '/project' }, projectID: 'p1', slug: 'session', version: '2' } };
      await done;
    } } });
    for (let i = 0; i < 30 && !events.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await prompt({ sessionID: 's2', prompt: { text: 'v2 prompt' } });
    finish(); await dispose();
    assert.deepEqual(events.map((x) => x.hook_event_name), ['SessionStart', 'UserPromptSubmit']);
    assert.equal(events[1].cwd, '/project');
    assert.equal(events[1].prompt, 'v2 prompt');
  } finally { finish(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('OpenCode 2 tool events retain the tool identity through success and failure', async () => {
  const events = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const plugin = await createOfficePlugin(server.address().port)({ directory: '/work' });
    const event = (type, properties) => plugin.event({ event: { type, properties: { sessionID: 's', id: 'tool1', ...properties } } });
    await event('session.tool.input.started', { name: 'bash' });
    await event('session.tool.called', { input: { command: 'npm test' } });
    await event('session.tool.failed', {});
    assert.deepEqual(events.map((x) => x.hook_event_name), ['PreToolUse', 'PostToolUseFailure']);
    assert.equal(events[1].tool_name, 'bash');
    assert.equal(events[1].tool_input.command, 'npm test');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('OpenCode 1 captures finalized user and assistant messages once', async () => {
  const events = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const plugin = await createOfficePlugin(server.address().port)({ directory: '/work' });
    const event = (type, properties) => plugin.event({ event: { type, properties } });
    await event('message.updated', { info: { id: 'u1', role: 'user', sessionID: 's' } });
    const user = { part: { id: 'p1', sessionID: 's', messageID: 'u1', type: 'text', text: 'hello', time: { end: 1 } } };
    await event('message.part.updated', user); await event('message.part.updated', user);
    await event('message.updated', { info: { id: 'a1', role: 'assistant', sessionID: 's' } });
    await event('message.part.updated', { part: { id: 'p2', sessionID: 's', messageID: 'a1', type: 'text', text: 'done', time: { end: 2 } } });
    await event('session.idle', { sessionID: 's' });
    assert.deepEqual(events.map((x) => x.hook_event_name), ['UserPromptSubmit', 'Stop']);
    assert.equal(events[1].last_assistant_message, 'done');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('OpenCode 2 resumed sessions use their own project directory', async () => {
  const events = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let prompt;
  try {
    const plugin = createOpenCode2Plugin(server.address().port);
    const dispose = await plugin.setup({ session: { get: async () => ({ id: 'resumed', location: { directory: '/actual-project' } }), hook: async (_name, fn) => { prompt = fn; return { dispose() {} }; } }, event: { subscribe: async function* () {} } });
    await prompt({ sessionID: 'resumed', prompt: { text: 'resume' } });
    await dispose();
    assert.equal(events[0].cwd, '/actual-project');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('OpenCode 2 preserves execution success, failure and interruption semantics', async () => {
  const events = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { events.push(JSON.parse(Buffer.concat(chunks))); res.end('{}'); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let release, done = new Promise((resolve) => { release = resolve; });
  try {
    const plugin = createOpenCode2Plugin(server.address().port);
    const dispose = await plugin.setup({
      session: { hook: async () => ({ dispose() {} }) },
      event: {
        subscribe: async function* () {
          yield { type: 'session.execution.started', data: { sessionID: 's1' } };
          yield { type: 'session.execution.succeeded', data: { sessionID: 's1' } };
          yield { type: 'session.execution.started', data: { sessionID: 's2' } };
          yield { type: 'session.execution.failed', data: { sessionID: 's2', error: { message: 'boom' } } };
          yield { type: 'session.execution.started', data: { sessionID: 's3' } };
          yield { type: 'session.execution.interrupted', data: { sessionID: 's3' } };
          await done;
        },
      },
    });
    for (let i = 0; i < 40 && events.length < 6; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    release(); await dispose();
    assert.deepEqual(events.map((x) => `${x.session_id}:${x.hook_event_name}`), [
      's1:UserPromptSubmit', 's1:Stop',
      's2:UserPromptSubmit', 's2:StopFailure',
      's3:UserPromptSubmit', 's3:Interrupt',
    ]);
    assert.equal(events[3].error, 'boom');
    assert.equal(events[5].interrupted, true);
  } finally { release(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
