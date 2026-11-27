import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotsIn, shoot } from '../../server/shots.mjs';

test('shotsIn extracts unique loopback http/https URLs up to 3 and strips SCREENSHOT lines', () => {
  const input = [
    'Fixed the layout.',
    'SCREENSHOT: http://localhost:3000/dashboard',
    'SCREENSHOT: http://127.0.0.1:4310/panel?x=1',
    'SCREENSHOT: http://localhost:3000/dashboard',
    'SCREENSHOT: http://[::1]:8080/ok',
    'SCREENSHOT: http://localhost:3000/fourth-dropped',
    'All green.',
  ].join('\n');
  const res = shotsIn(input);
  assert.equal(res.text, 'Fixed the layout.\n\nAll green.');
  assert.deepEqual(res.urls, [
    'http://localhost:3000/dashboard',
    'http://127.0.0.1:4310/panel?x=1',
    'http://[::1]:8080/ok',
  ]);
});

test('shotsIn and shoot reject external, metadata, and non-http URLs', async () => {
  const bad = [
    'https://evil.example/steal',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost.evil.example/a',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://localhost/file',
    'not-a-url',
  ];
  const res = shotsIn(bad.map((u) => `SCREENSHOT: ${u}`).join('\n'));
  assert.deepEqual(res.urls, []);
  for (const u of bad) assert.equal(await shoot(u), null, u);
});
