import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('/event rejects browser Origins and foreign Host headers while accepting clean loopback hooks', { timeout: 30_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-sec-'));
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
      CODEX_HOME: path.join(dir, 'codex'),
      OFFICE_DATA_DIR: dir,
      OFFICE_HOST: '127.0.0.1',
      OFFICE_PORT: String(port),
      OFFICE_NO_NEXT: '1',
      OFFICE_AI_ACCOUNTS: '0',
      OFFICE_TRANSLATE: '0',
      OFFICE_USAGE: '0',
      OFFICE_CI: '0',
    },
  });
  const base = `http://127.0.0.1:${port}`;
  const sendRaw = (headers, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/event', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  try {
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      try { up = (await fetch(`${base}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 50)); }
    }
    assert.ok(up, 'server started');

    const withOrigin = await sendRaw({ Origin: 'https://evil.example' }, { session_id: 'bad-origin', hook_event_name: 'SessionStart', cwd: dir });
    assert.equal(withOrigin, 403);

    const badHost = await sendRaw({ Host: `evil.example:${port}` }, { session_id: 'bad-host', hook_event_name: 'SessionStart', cwd: dir });
    assert.equal(badHost, 421);

    const ok = await sendRaw({}, { session_id: 'good-loopback', hook_event_name: 'SessionStart', cwd: dir });
    assert.equal(ok, 200);

    let sessions = [];
    for (let i = 0; i < 40; i++) {
      sessions = (await (await fetch(`${base}/api/live`)).json()).msgs[0].sessions;
      if (sessions.some((s) => s.sid === 'good-loopback')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(sessions.some((s) => s.sid === 'bad-origin' || s.sid === 'bad-host'), false);
    assert.equal(sessions.some((s) => s.sid === 'good-loopback'), true);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('toVi redacts secrets before any translation lookup or network request', async () => {
  const src = fs.readFileSync(new URL('../../server/index.mjs', import.meta.url), 'utf8');
  const fnMatch = /async function toVi\(text\)\s*\{([\s\S]*?)^\}/m.exec(src);
  assert.ok(fnMatch, 'toVi exists');
  assert.match(fnMatch[1].trimStart(), /^text = redact\(/, 'toVi must redact input before cache/network use');
});
