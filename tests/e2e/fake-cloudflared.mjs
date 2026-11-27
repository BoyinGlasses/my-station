#!/usr/bin/env node
// Cross-platform stand-in for cloudflared in end-to-end tests (OFFICE_TUNNEL_CMD).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const joined = args.join(' ');
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const CF = path.join(HOME, '.cloudflared');
const hold = () => setInterval(() => {}, 3_600_000);

if (joined.startsWith('tunnel login')) {
  fs.mkdirSync(CF, { recursive: true });
  fs.writeFileSync(path.join(CF, 'cert.pem'), 'fake\n');
  console.error('INF You have successfully logged in.');
  process.exit(0);
}
if (joined.startsWith('tunnel list')) {
  const f = path.join(CF, 'fake-id');
  console.log(fs.existsSync(f) ? JSON.stringify([{ id: fs.readFileSync(f, 'utf8').trim(), name: 'my-office' }]) : '[]');
  process.exit(0);
}
if (joined.startsWith('tunnel create')) {
  const id = '11111111-2222-3333-4444-555555555555';
  fs.mkdirSync(CF, { recursive: true });
  fs.writeFileSync(path.join(CF, 'fake-id'), `${id}\n`);
  fs.writeFileSync(path.join(CF, `${id}.json`), '{}\n');
  console.log(`Created tunnel my-office with id ${id}`);
  process.exit(0);
}
if (joined.startsWith('tunnel route dns')) {
  console.error('INF Added CNAME which will route to this tunnel');
  process.exit(0);
}
if (args.includes('run')) {
  console.error('INF Registered tunnel connection connIndex=0');
  hold();
} else if (process.env.FAKE_REVOKE && fs.existsSync(process.env.FAKE_REVOKE)) {
  fs.rmSync(process.env.FAKE_REVOKE, { force: true });
  console.error('INF |  https://e2e-revoked.trycloudflare.com  |');
  console.error('INF Registered tunnel connection connIndex=0');
  setTimeout(() => console.error('ERR Register tunnel error from server side error="Unauthorized: Tunnel not found" connIndex=0'), 2000);
  hold();
} else {
  console.error('INF |  https://e2e-office-test.trycloudflare.com  |');
  hold();
}
