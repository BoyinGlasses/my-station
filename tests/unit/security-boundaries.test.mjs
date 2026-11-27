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
  const sendRaw = (headers, body, reqPath = '/event', method = 'POST') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
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

    const badDoctorHost = await sendRaw({ Host: `evil.example:${port}` }, undefined, '/api/doctor', 'GET');
    assert.equal(badDoctorHost, 421);

    const badOtelHost = await sendRaw({ Host: `evil.example:${port}` }, { resourceMetrics: [] }, '/v1/metrics', 'POST');
    assert.equal(badOtelHost, 421);

    // Top-level invalid `endpoint` alongside a valid `sub` previously threw `new URL(endpoint)` and crashed the server.
    const validSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-1', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };
    const badTopEndpoint = await sendRaw({}, { op: 'add', endpoint: 'not-a-url', sub: validSub }, '/api/push', 'POST');
    assert.equal(badTopEndpoint, 200);
    const invalidSub = await sendRaw({}, { op: 'add', sub: { endpoint: 'not-a-url' } }, '/api/push', 'POST');
    assert.equal(invalidSub, 400);
    assert.equal((await fetch(`${base}/health`)).status, 200);

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

test('toVi redacts secrets before any translation lookup or network request', async (t) => {
  const { createTranslator } = await import('../../server/translate.mjs');
  const { redact } = await import('../../server/redact.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tr = createTranslator({ dataDir: dir, redact, enabled: false, lang: () => 'vi', onTranslated: () => {} });
  t.after(() => tr.stop());
  const out = await tr.toVi('Deploy key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.doesNotMatch(out, /sk-ant-api03/);
  const src = fs.readFileSync(new URL('../../server/translate.mjs', import.meta.url), 'utf8');
  const fnMatch = /async function toVi\(text\)\s*\{([\s\S]*?)^\s*\}/m.exec(src);
  assert.ok(fnMatch, 'toVi exists in server/translate.mjs');
  assert.match(fnMatch[1].trimStart(), /^text = redact\(/, 'toVi must redact input before cache/network use');
});
