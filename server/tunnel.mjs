// LAN listeners, macOS caffeinate keep-awake, and Cloudflare quick/named tunnel lifecycle.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { cliCommand } from './cli-command.mjs';

const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function createTunnel({
  dataDir, port, host, prefs, server, osAdapter, alive, actionLog, tr, currentPin, rcAtStartup, bgOut, pushOut,
}) {
  const lanFixed = host !== '127.0.0.1' && host !== 'localhost';
  const lanServers = new Map();
  function syncLan() {
    const want = new Set(!lanFixed && prefs.get('lan') ? Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address) : []);
    for (const [addr, srv] of lanServers) if (!want.has(addr)) { srv.close(); srv.closeAllConnections?.(); lanServers.delete(addr); }
    for (const addr of want) {
      if (lanServers.has(addr)) continue;
      const srv = http.createServer(server.listeners('request')[0]);
      srv.on('error', () => { if (lanServers.get(addr) === srv) lanServers.delete(addr); });
      srv.listen(port, addr); lanServers.set(addr, srv);
    }
  }
  const lanIsOn = () => lanFixed || lanServers.size > 0;
  setInterval(syncLan, 30_000).unref();

  const tunnel = { state: 'off', url: '', host: '', error: '', pid: 0, srv: null, port: 0, tries: 0, gen: 0, watch: null };
  const TUNNEL_PID = path.join(dataDir, 'tunnel.pid');
  const CF_BIN = path.join(dataDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const TUNNEL_FILE = path.join(dataDir, 'tunnel.json');
  const TUNNEL_LOG = path.join(dataDir, 'tunnel.log');
  const TUNNEL_PORT = Number(process.env.OFFICE_TUNNEL_PORT) || port + 7;
  const CF_HOME = path.join(os.homedir(), '.cloudflared');
  const NAMED = 'my-office';

  let awakeProc = null, powerAC = null, powerT = null;
  function readPower() {
    execFile('pmset', ['-g', 'batt'], { timeout: 4000 }, (err, out) => { powerAC = err ? null : /AC Power/.test(String(out)); });
  }
  function keepAwake(on) {
    if (process.platform !== 'darwin') return;
    if (on && !awakeProc) {
      const p = awakeProc = spawn('caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' });
      p.on('error', () => { if (awakeProc === p) awakeProc = null; });
      p.on('exit', () => { if (awakeProc === p) awakeProc = null; });
      readPower(); clearInterval(powerT); powerT = setInterval(readPower, 60_000); powerT.unref();
    } else if (!on) {
      if (awakeProc) { try { awakeProc.kill(); } catch { /* gone */ } awakeProc = null; }
      clearInterval(powerT); powerT = null;
    }
  }

  async function cloudflared() {
    if (process.env.OFFICE_TUNNEL_CMD) return process.env.OFFICE_TUNNEL_CMD;
    if (fs.existsSync(CF_BIN)) return CF_BIN;
    const onPath = await new Promise((resolve) => execFile(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { timeout: 4000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out).split('\n')[0].trim())));
    if (onPath) return onPath;
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const asset = { darwin: `cloudflared-darwin-${arch}.tgz`, linux: `cloudflared-linux-${arch}`, win32: 'cloudflared-windows-amd64.exe' }[process.platform];
    if (!asset) throw new Error(tr('server.tunnel.noPlatform'));
    tunnel.state = 'download';
    const r = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw new Error(tr('server.tunnel.downloadFailed', { status: r.status }));
    fs.mkdirSync(path.dirname(CF_BIN), { recursive: true });
    const tmp = `${CF_BIN}.download`;
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    if (asset.endsWith('.tgz')) { await new Promise((resolve, reject) => execFile('tar', ['-xzf', tmp, '-C', path.dirname(CF_BIN)], (err) => (err ? reject(err) : resolve()))); fs.rmSync(tmp, { force: true }); }
    else fs.renameSync(tmp, CF_BIN);
    fs.chmodSync(CF_BIN, 0o755);
    return CF_BIN;
  }

  async function isCloudflared(pid) {
    if (!(pid > 1) || !alive(pid)) return false;
    try {
      if (process.platform === 'win32') {
        const p = (await osAdapter.processes()).procs.get(pid);
        return !!p && /cloudflared|tunnel/i.test(`${p.comm} ${p.args}`);
      }
      const comm = await new Promise((resolve) => execFile('ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 4000 }, (err, out) => resolve(err ? '' : String(out).trim())));
      return /cloudflared|tunnel/i.test(path.basename(comm));
    } catch { return false; }
  }

  async function killStaleTunnel() {
    try {
      const pid = Number(fs.readFileSync(TUNNEL_PID, 'utf8'));
      if (await isCloudflared(pid)) process.kill(pid, 'SIGTERM');
    } catch { /* none, or gone */ }
    fs.rmSync(TUNNEL_PID, { force: true });
  }

  async function listenTunnel() {
    if (tunnel.srv) return;
    const handle = server.listeners('request')[0], srv = http.createServer((req, res) => { req.viaTunnel = true; handle(req, res); });
    await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(TUNNEL_PORT, '127.0.0.1', resolve); });
    tunnel.srv = srv; tunnel.port = TUNNEL_PORT;
  }

  const namedTunnel = () => { const n = prefs.get('tunnelNamed'); return n?.id && n?.host && n?.cred && fs.existsSync(n.cred) ? n : null; };
  let domainJob = null;

  function setTunnelDomain(domainHost) {
    domainHost = String(domainHost || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (domainJob && !['done', 'error'].includes(domainJob.state)) return { ok: false, message: tr('server.tunnel.busy') };
    const again = () => { if (prefs.get('tunnel')) { stopTunnel(); startTunnel(); } };
    if (!domainHost) { prefs.set('tunnelNamed', undefined); domainJob = null; again(); return { ok: true }; }
    if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domainHost)) return { ok: false, message: tr('server.tunnel.badHost') };
    const job = domainJob = { state: 'login', host: domainHost, note: '' };
    const step = (state) => { job.state = state; };
    const fail = (key, vars) => { job.state = 'error'; job.note = tr(key, vars); };
    (async () => {
      const rawCmd = await cloudflared(), cmd = cliCommand(rawCmd) || { file: rawCmd };
      const run = (args, timeout) => new Promise((resolve) => execFile(cmd.file, [...(cmd.args || []), ...args], { timeout, maxBuffer: 4 << 20, windowsHide: true }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || '') })));
      if (!fs.existsSync(path.join(CF_HOME, 'cert.pem'))) {
        const r = await run(['tunnel', 'login'], 5 * 60e3);
        if (!r.ok || !fs.existsSync(path.join(CF_HOME, 'cert.pem'))) { fail('server.tunnel.loginFailed'); return; }
      }
      step('create');
      const idOf = async () => { const r = await run(['tunnel', 'list', '-o', 'json'], 60e3); try { return JSON.parse(r.out).find((t) => t.name === NAMED)?.id || ''; } catch { return ''; } };
      let id = await idOf();
      if (!id) { await run(['tunnel', 'create', NAMED], 60e3); id = await idOf(); }
      const cred = id && path.join(CF_HOME, `${id}.json`);
      if (!id || !fs.existsSync(cred)) { fail(id ? 'server.tunnel.noCred' : 'server.tunnel.createFailed', { name: NAMED }); return; }
      step('route');
      const r = await run(['tunnel', 'route', 'dns', NAMED, domainHost], 60e3);
      if (!r.ok && !/already configured to route to your tunnel/i.test(r.err + r.out)) { fail(/already exists/i.test(r.err + r.out) ? 'server.tunnel.hostTaken' : 'server.tunnel.routeFailed', { host: domainHost }); return; }
      prefs.set('tunnelNamed', { id, host: domainHost, cred });
      fsp.appendFile(actionLog, `${new Date().toISOString()} tunnel fixed address ${domainHost}\n`).catch(() => {});
      step('done');
      again();
    })().catch((e) => fail('server.tunnel.routeFailed', { host: String(e?.message || e).slice(0, 80) }));
    return { ok: true };
  }

  function tunnelRevoked() {
    let tail = '';
    try {
      const fd = fs.openSync(TUNNEL_LOG, 'r'), size = fs.fstatSync(fd).size, n = Math.min(size, 8192), buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd); tail = buf.toString('utf8');
    } catch { return false; }
    const gone = tail.lastIndexOf('Tunnel not found');
    return gone >= 0 && gone > tail.lastIndexOf('Registered tunnel connection');
  }

  function tunnelUp(pid, url) {
    if (tunnel.revoked && tunnel.revoked !== url) pushOut({ title: tr('server.tunnel.newTitle'), body: tr('server.tunnel.newBody', { url }), tag: 'tunnel', url });
    tunnel.revoked = '';
    Object.assign(tunnel, { pid, url, host: new URL(url).host, state: 'on', tries: 0, error: '' });
    try { fs.writeFileSync(TUNNEL_FILE, JSON.stringify({ pid, url, port: tunnel.port })); } catch { /* read-only data */ }
    console.log(`[my-office] ${tr('server.tunnel.ready', { url })}`);
    clearInterval(tunnel.watch);
    tunnel.watch = setInterval(() => {
      if (tunnel.pid && alive(tunnel.pid) && !namedTunnel() && tunnelRevoked()) {
        tunnel.revoked = tunnel.url;
        fsp.appendFile(actionLog, `${new Date().toISOString()} tunnel taken back by Cloudflare ${tunnel.url} -> a new address\n`).catch(() => {});
        try { process.kill(tunnel.pid, 'SIGTERM'); } catch { /* gone */ }
        return;
      }
      if (!tunnel.pid || alive(tunnel.pid)) return;
      clearInterval(tunnel.watch); Object.assign(tunnel, { pid: 0, url: '', host: '' }); fs.rmSync(TUNNEL_FILE, { force: true });
      if (!prefs.get('tunnel')) { tunnel.state = 'off'; return; }
      tunnel.state = 'error'; tunnel.error = tr(tunnel.revoked ? 'server.tunnel.revoked' : 'server.tunnel.dropped');
      if (++tunnel.tries <= 6) setTimeout(() => { if (prefs.get('tunnel')) startTunnel(); }, Math.min(60_000, 3000 * 2 ** tunnel.tries)).unref();
    }, 5000);
    tunnel.watch.unref();
  }

  async function startTunnel() {
    if (tunnel.pid || tunnel.state === 'download' || tunnel.state === 'starting') return;
    keepAwake(true);
    const gen = ++tunnel.gen;
    tunnel.state = 'starting'; tunnel.error = ''; tunnel.url = ''; tunnel.host = '';
    try {
      await listenTunnel();
      const saved = readJsonFile(TUNNEL_FILE);
      const named = namedTunnel(), want = named ? `https://${named.host}` : null;
      if (saved?.url && saved.port === tunnel.port && saved.pid > 1 && alive(saved.pid) && (await isCloudflared(saved.pid)) && (want ? saved.url === want : /trycloudflare/.test(saved.url))) { tunnelUp(saved.pid, saved.url); return; }
      await killStaleTunnel();
      const rawCmd = await cloudflared(), cmd = cliCommand(rawCmd) || { file: rawCmd };
      if (gen !== tunnel.gen || !prefs.get('tunnel')) return;
      tunnel.state = 'starting';
      fs.writeFileSync(TUNNEL_LOG, '');
      const out = fs.openSync(TUNNEL_LOG, 'a');
      const args = named ? ['tunnel', '--no-autoupdate', 'run', '--url', `http://127.0.0.1:${tunnel.port}`, '--credentials-file', named.cred, named.id] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${tunnel.port}`];
      const proc = spawn(cmd.file, [...(cmd.args || []), ...args], { stdio: ['ignore', out, out], detached: true, windowsHide: true });
      fs.closeSync(out); proc.unref();
      proc.on('error', (err) => { tunnel.error = String(err.message || err).slice(0, 200); });
      try { fs.writeFileSync(TUNNEL_PID, String(proc.pid)); } catch { /* read-only data */ }
      const t0 = Date.now();
      await new Promise((resolve) => {
        const look = () => {
          if (gen !== tunnel.gen) { resolve(); return; }
          let log = ''; try { log = fs.readFileSync(TUNNEL_LOG, 'utf8'); } catch { /* not yet */ }
          const m = named ? (/Registered tunnel connection/.test(log) ? [want] : null) : /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
          if (m) { tunnelUp(proc.pid, m[0]); resolve(); return; }
          if (!alive(proc.pid) || Date.now() - t0 > 90_000) { tunnel.state = 'error'; tunnel.error ||= clip(oneLine(log.split('\n').filter(Boolean).pop() || tr('server.tunnel.dropped')), 200); try { process.kill(proc.pid); } catch { /* gone */ } resolve(); return; }
          setTimeout(look, 500);
        };
        look();
      });
    } catch (err) {
      if (gen !== tunnel.gen) return;
      tunnel.state = 'error'; tunnel.error = String(err.message || err).slice(0, 200);
    }
  }

  function stopTunnel() {
    tunnel.gen++;
    keepAwake(false); clearInterval(tunnel.watch);
    if (tunnel.pid) { try { process.kill(tunnel.pid, 'SIGTERM'); } catch { /* gone */ } }
    fs.rmSync(TUNNEL_PID, { force: true }); fs.rmSync(TUNNEL_FILE, { force: true });
    if (tunnel.srv) { tunnel.srv.close(); tunnel.srv.closeAllConnections?.(); tunnel.srv = null; tunnel.port = 0; }
    Object.assign(tunnel, { state: 'off', url: '', host: '', error: '', tries: 0, pid: 0 });
  }

  const tunnelOut = () => ({
    ok: true, on: !!prefs.get('tunnel'), state: tunnel.state, url: tunnel.url, error: tunnel.error, port: tunnel.port, pin: currentPin(),
    awake: process.platform === 'darwin' ? { held: !!awakeProc, ac: powerAC } : null,
    rc: rcAtStartup(), tasks: !!prefs.get('phoneTasks'), bg: bgOut(),
    fixed: namedTunnel()?.host || '',
    domain: domainJob && { state: domainJob.state, host: domainJob.host, note: domainJob.note },
  });

  const cleanup = () => { try { awakeProc?.kill(); } catch { /* gone */ } };

  return { tunnel, lanFixed, lanServers, syncLan, lanIsOn, tunnelOut, setTunnelDomain, startTunnel, stopTunnel, killStaleTunnel, cleanup };
}
