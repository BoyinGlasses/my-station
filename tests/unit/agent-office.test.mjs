import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dangerKey } from '../../src/shared/danger.js';
import { stopProcess } from '../../server/agent-rpc.mjs';

test('Office approvals, Antigravity resume and conversation history work across agents and server restarts', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-protocol-integration-'));
  const fixture = new URL('../fixtures/agent-rpc.mjs', import.meta.url).href;
  const env = { ...process.env, HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), CODEX_HOME: path.join(dir, 'codex'), OFFICE_AI_ACCOUNTS: '0', OFFICE_TRANSLATE: '0', OFFICE_USAGE: '0', OFFICE_CI: '0', OFFICE_DATA_DIR: dir, OFFICE_HOST: '127.0.0.1', OFFICE_NO_NEXT: '1' };
  for (const agent of ['codex', 'opencode', 'antigravity']) {
    const script = path.join(dir, agent + '.mjs');
    fs.writeFileSync(script, `import {serveFakeAgent} from ${JSON.stringify(fixture)};await serveFakeAgent({agent:${JSON.stringify(agent)},sid:'owned',capture:${JSON.stringify(path.join(dir, agent + '.calls'))}});`);
    env['OFFICE_' + agent.toUpperCase() + '_BIN'] = script;
  }
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  env.OFFICE_PORT = String(socket.address().port); await new Promise((resolve) => socket.close(resolve));
  const base = 'http://127.0.0.1:' + env.OFFICE_PORT;
  const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
  const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const x = await fn(); if (x) return x; await wait(); } assert.fail('timed out'); };
  let server;
  const start = async () => {
    server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'ignore', windowsHide: true });
    await until(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } }, 30000);
  };
  const stop = async () => { if (server?.exitCode === null && server.signalCode === null) { const ended = once(server, 'exit'); stopProcess(server); await ended; } };
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const snapshot = async () => (await (await fetch(base + '/api/live')).json()).msgs[0];
  const idle = () => until(async () => !(await (await fetch(base + '/api/tasks')).json()).running.length);
  try {
    await start();
    await post('/event', { agent: 'antigravity', conversationId: 'source', workspacePaths: [dir], hook_event_name: 'SessionStart' });
    await until(async () => (await (await fetch(base + '/api/tasks')).json()).projects.length);
    for (const agent of ['codex', 'opencode', 'antigravity']) {
      assert.equal((await post('/api/tasks', { dir, agent, text: 'ask permission', fresh: true })).status, 200);
      const p = await until(async () => (await snapshot()).perms.find((x) => x.agent === agent));
      assert.equal(p.tool, 'Bash'); assert.equal(dangerKey(p), 'gitPush');
      assert.notEqual((await post('/api/perm', { id: p.id, choice: 'always' })).status, 200);
      assert.equal((await post('/api/perm', { id: p.id, choice: 'deny' })).status, 200);
      await idle();
      const approval = JSON.parse(fs.readFileSync(path.join(dir, agent + '.calls.approvals'), 'utf8').trim());
      assert.equal(agent === 'codex' ? approval.result.decision : approval.result.outcome.optionId, agent === 'codex' ? 'decline' : 'no');
      const s = (await snapshot()).sessions.find((x) => x.sid === agent + ':owned');
      const items = (await (await fetch(base + '/api/log?id=' + s.id)).json()).items;
      assert.equal(items[0].role, 'user'); assert.equal(items.at(-1).text, 'done');
    }
    const resumed = await post('/api/tasks', { sid: 'antigravity:source', text: 'continue original' });
    assert.equal(resumed.status, 200); await idle();
    const agCalls = fs.readFileSync(path.join(dir, 'antigravity.calls'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(agCalls.at(-1).start.method, 'session/load'); assert.equal(agCalls.at(-1).start.params.sessionId, 'source');
    assert.equal((await post('/api/tasks', { dir, agent: 'codex', text: 'ask question' })).status, 200);
    const question = await until(async () => (await snapshot()).perms.find((x) => x.agent === 'codex' && x.kind === 'ask'));
    assert.equal((await post('/api/perm', { id: question.id, choice: 'answer', answers: [{ q: 0, pick: [1] }] })).status, 200);
    await idle();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'codex.calls.questions'), 'utf8')).result.answers, { direction: { answers: ['B'] } });
    await stop(); await start();
    await post('/event', { agent: 'opencode', session_id: 'owned', cwd: dir, hook_event_name: 'SessionStart' });
    const restored = await until(async () => (await snapshot()).sessions.find((x) => x.sid === 'opencode:owned'));
    assert.equal((await (await fetch(base + '/api/log?id=' + restored.id)).json()).items.at(-1).text, 'done');
    assert.equal((await post('/api/tasks', { dir, agent: 'opencode', text: 'continue after restart' })).status, 200);
    await idle();
    const ocCalls = fs.readFileSync(path.join(dir, 'opencode.calls'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(ocCalls.at(-1).start.method, 'session/load'); assert.equal(ocCalls.at(-1).start.params.sessionId, 'owned');
  } finally {
    await stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
