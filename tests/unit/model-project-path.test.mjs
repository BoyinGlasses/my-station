import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('model discovery and work accept the home project path returned by the task API', { timeout: 30_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-model-project-'));
  const project = path.join(home, 'Documents', 'Example project'); fs.mkdirSync(project, { recursive: true });
  const fake = path.join(home, 'cli.mjs');
  fs.writeFileSync(fake, `import {serveFakeAgent} from ${JSON.stringify(new URL('../fixtures/agent-rpc.mjs', import.meta.url).href)};if(process.argv[2]==='models'){console.log('custom/model\\tExample model');}else await serveFakeAgent({agent:'opencode',sid:'office-owned'});`);
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: {
    ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex'),
    OFFICE_DATA_DIR: home, OFFICE_HOST: '127.0.0.1', OFFICE_PORT: String(port), OFFICE_USAGE: '0', OFFICE_CI: '0', OFFICE_TRANSLATE: '0',
    OFFICE_NO_NEXT: '1',
    OFFICE_OPENCODE_BIN: fake, OFFICE_ANTIGRAVITY_BIN: fake,
  } });
  let output = ''; server.stdout.on('data', (c) => { output += c; }); server.stderr.on('data', (c) => { output += c; });
  const base = `http://127.0.0.1:${port}`, wait = () => new Promise((resolve) => setTimeout(resolve, 50));
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const deadline = Date.now() + 15_000;
    let up = false; while (!up && Date.now() < deadline && server.exitCode === null) { try { up = (await fetch(base + '/health')).ok; } catch { /* starting */ } if (!up) await wait(); }
    assert.ok(up, 'server started: ' + output.slice(-2000));
    await post('/event', { agent: 'opencode', session_id: 'source', hook_event_name: 'SessionStart', cwd: project });
    let listed;
    for (let i = 0; i < 50 && !listed; i++) { listed = (await (await fetch(base + '/api/tasks')).json()).projects.find((p) => p.name === 'Example project'); if (!listed) await wait(); }
    assert.equal(listed?.dir, '~' + path.sep + path.join('Documents', 'Example project'));
    for (const agent of ['opencode', 'antigravity']) {
      const response = await fetch(base + '/api/models?' + new URLSearchParams({ agent, dir: listed.dir }));
      assert.equal(response.status, 200, `${agent}: accepts the API's own project path`);
      assert.deepEqual((await response.json()).models, [{ id: 'custom/model', name: 'Example model' }]);
      const work = await post('/api/tasks', { agent, dir: listed.dir, text: 'Example work' });
      assert.equal(work.status, 200, `${agent}: work uses the same project path`);
      assert.equal((await work.json()).task.dir, project);
      let running = true;
      for (let i = 0; i < 50 && running; i++) { running = (await (await fetch(base + '/api/tasks')).json()).running.length > 0; if (running) await wait(); }
      assert.equal(running, false);
    }
    const unknown = '~' + path.sep + 'unknown';
    assert.equal((await fetch(base + '/api/models?' + new URLSearchParams({ agent: 'opencode', dir: unknown }))).status, 400);
    assert.equal((await post('/api/tasks', { agent: 'opencode', dir: unknown, text: 'Example' })).status, 400);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
