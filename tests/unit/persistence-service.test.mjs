import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { serviceEnv, serviceFor } from '../../bin/service.mjs';
import { createPrefs } from '../../server/prefs.mjs';
import { createTrophies } from '../../server/trophies.mjs';

test('serviceEnv persists OFFICE_PORT alongside OFFICE_HOST', () => {
  assert.deepEqual(serviceEnv({ host: '127.0.0.1', port: 4555 }), {
    OFFICE_HOST: '127.0.0.1',
    OFFICE_PORT: '4555',
    NODE_ENV: 'production',
  });
});

test('Windows startup script preserves OFFICE_PORT', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-svc-'));
  const prevAppData = process.env.APPDATA;
  const server = http.createServer((_req, res) => res.writeHead(200).end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    process.env.APPDATA = dir;
    const svc = serviceFor({ root: dir, server: path.join(dir, 'server.mjs'), log: path.join(dir, 'server.log'), host: '127.0.0.1', port });
    assert.equal(await svc.install(), true);
    const body = fs.readFileSync(svc.file, 'utf8');
    assert.match(body, new RegExp(`env\\("OFFICE_PORT"\\) = "${port}"`));
    assert.equal(await svc.uninstall(), true);
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createPrefs and createTrophies flush atomically without leaving temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-persist-'));
  try {
    const prefs = createPrefs(dir);
    prefs.set('lan', true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'prefs.json'), 'utf8')).lan, true);

    const trophies = createTrophies({ dataDir: dir, claudeDir: path.join(dir, 'claude'), today: () => '2026-11-25', deployRe: /$^/, tr: (k) => k, num: String, onChange: () => {} });
    trophies.bump('prompts', 2);
    trophies.saveSync();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'totals.json'), 'utf8'));
    assert.equal(saved.live.prompts, 2);

    const files = fs.readdirSync(dir);
    assert.equal(files.some((f) => f.endsWith('.tmp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
