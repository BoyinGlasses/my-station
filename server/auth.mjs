// HTTP security boundaries, PIN & signed cookie auth, lockout tracking, and JSON/form body helpers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PIN_RE = /^\d{6,10}$/;
const COOKIE = 'office_pin';
export const KEEP_DAYS = 365;
const VISIT_MS = 12 * 3600e3;
const LOCK_MS = 15 * 60e3;

const PIN_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#f4f1ea;color:#1d1b16;
font:16px/1.5 system-ui,-apple-system,sans-serif;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom))}@media (prefers-color-scheme:dark){body{background:#16151a;color:#ece9e2}
.card{background:#211f26!important;border-color:#3a3742!important}input[name=pin]{background:#16151a!important;color:#ece9e2!important;border-color:#4a4654!important}.keep small{color:#9a948a!important}}
.card{width:100%;max-width:360px;background:#fff;border:1px solid #e3ddd0;border-radius:20px;padding:28px 24px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
h1{font-size:1.25rem;margin:0 0 4px}p{margin:0 0 18px;color:#7a7468;font-size:.92rem}
input[name=pin]{width:100%;font:600 1.75rem/1 ui-monospace,Menlo,monospace;letter-spacing:.3em;text-align:center;padding:14px 0 14px .3em;border:1.5px solid #d8d1c2;
border-radius:14px;background:#fbfaf7;outline:none}input[name=pin]:focus{border-color:#d97757;box-shadow:0 0 0 4px rgba(217,119,87,.18)}
.keep{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;cursor:pointer;font-size:.95rem;line-height:1.35}.keep input{width:22px;height:22px;margin:0;flex:none;accent-color:#d97757}
.keep small{display:block;color:#7a7468;font-size:.8rem;margin-top:2px}
button{margin-top:14px;width:100%;height:48px;border:0;border-radius:14px;background:#d97757;color:#fff;font:600 1rem system-ui;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.err{color:#c0392b;margin:12px 0 0;font-size:.9rem}.ico{font-size:2rem;margin-bottom:8px}`;

export function sameBytes(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** A PIN of your own that a stranger would try first: all one digit, or a run like 123456 or 987654 (or not 6–10 digits). */
export function pinWeak(p) {
  if (!PIN_RE.test(p)) return true;
  const d = [...p].map(Number), steps = new Set(d.slice(1).map((x, i) => x - d[i]));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]);
}

export function readJson(req, max = 64_000) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('error', () => resolve(null));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
  });
}

export const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));

export function withJson(req, res, fn, max = 64_000) {
  readJson(req, max).then(fn).catch((err) => {
    console.error('http', req.method, req.url, err);
    try { if (!res.headersSent) json(res, 500, { ok: false }); else if (!res.writableEnded) res.end(); } catch { /* gone */ }
  });
}

export function readForm(req, max = 2_000) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { if (body.length <= max) body += c; });
    req.on('error', () => resolve(new URLSearchParams()));
    req.on('end', () => resolve(new URLSearchParams(body.slice(0, max))));
  });
}

export function createAuth({ dataDir, token, port, tunnel, lang, tr }) {
  const pinFile = path.join(dataDir, 'pin');
  let pinCache = { value: '', at: 0 };
  function writePin(p) {
    fs.writeFileSync(pinFile, p, { mode: 0o600 });
    pinCache = { value: p, at: Date.now() };
  }
  function currentPin() {
    const now = Date.now();
    if (pinCache.value && now - pinCache.at < 2000) return pinCache.value;
    try {
      const p = fs.readFileSync(pinFile, 'utf8').trim();
      if (PIN_RE.test(p)) { pinCache = { value: p, at: now }; return p; }
    } catch { /* first run */ }
    const p = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    writePin(p);
    return p;
  }
  currentPin();

  const isLoopback = (req) => !req.viaTunnel && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const clientIp = (req) => (req.viaTunnel ? String(req.headers['cf-connecting-ip'] || 'tunnel').slice(0, 64) : req.socket.remoteAddress);

  function sameOriginOf(req) {
    const o = req.headers.origin, t = typeof tunnel === 'function' ? tunnel() : tunnel;
    return !o || o === `http://${req.headers.host}` || (req.viaTunnel && !!t?.url && o === t.url);
  }
  function hostAllowed(req) {
    const h = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    const t = typeof tunnel === 'function' ? tunnel() : tunnel;
    if (req.viaTunnel) return h === t?.host || h === '127.0.0.1';
    if (['localhost', '127.0.0.1', '::1', `${os.hostname().toLowerCase()}`, `${os.hostname().toLowerCase().replace(/\.local$/, '')}.local`].includes(h)) return true;
    return Object.values(os.networkInterfaces()).flat().some((n) => n && n.address === h);
  }
  function tsUrl() {
    for (const n of Object.values(os.networkInterfaces()).flat()) {
      const m = n && n.family === 'IPv4' && /^100\.(\d+)\./.exec(n.address);
      if (m && +m[1] >= 64 && +m[1] <= 127) return `http://${n.address}:${port}/`;
    }
    return null;
  }
  function lanUrl(withToken = true) {
    const nets = os.networkInterfaces();
    const order = ['en0', 'en1', ...Object.keys(nets)];
    for (const name of order) for (const n of nets[name] || []) if (n.family === 'IPv4' && !n.internal) return `http://${n.address}:${port}/${withToken ? `?k=${token}` : ''}`;
    return null;
  }

  const sign = (exp, kind = '') => crypto.createHmac('sha256', token).update(`pin:${exp}:${kind ? `${kind}:` : ''}${currentPin()}`).digest('base64url');
  function pinCookie(req, keep = true) {
    const kind = keep ? 'k' : 's', exp = Date.now() + (keep ? KEEP_DAYS * 86400e3 : VISIT_MS);
    return `${COOKIE}=${exp}.${kind}.${sign(exp, kind)};${keep ? ` Max-Age=${KEEP_DAYS * 86400};` : ''} Path=/; HttpOnly; SameSite=Lax${req?.viaTunnel ? '; Secure' : ''}`;
  }
  function pinCookieOf(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.(?:([ks])\\.)?([\\w-]+)`).exec(String(req.headers.cookie || ''));
    return m && Number(m[1]) > Date.now() && sameBytes(m[3], sign(m[1], m[2] || '')) ? { exp: Number(m[1]), keep: m[2] !== 's' } : null;
  }
  const cookieOk = (req) => !!pinCookieOf(req);
  const authorized = (req, url) => isLoopback(req) || (!req.viaTunnel && sameBytes(url.searchParams.get('k') || '', token)) || cookieOk(req);

  const pinFails = new Map();
  let allFails = [];
  function pinLockedUntil(ip) {
    const now = Date.now();
    allFails = allFails.filter((t) => now - t < LOCK_MS);
    if (allFails.length >= 20) return allFails[0] + LOCK_MS;
    const f = pinFails.get(ip);
    return f && f.until > now ? f.until : 0;
  }
  function pinFailed(ip) {
    const now = Date.now();
    allFails.push(now);
    for (const [k, v] of pinFails) if (v.until && v.until <= now && v.n === 0) pinFails.delete(k);
    const f = pinFails.get(ip) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 5) { f.n = 0; f.until = now + LOCK_MS; }
    pinFails.delete(ip); pinFails.set(ip, f);
    if (pinFails.size > 500) pinFails.delete(pinFails.keys().next().value);
    return f.until > now ? 0 : 5 - f.n;
  }
  function pinPage(res, code, msg = '', locked = false) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }).end(`<!doctype html>
<html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Office</title><style>${PIN_CSS}</style></head>
<body><form class="card" method="post" action="/pin" autocomplete="off"><div class="ico">🏢</div><h1>${esc(tr('server.pin.title'))}</h1>
<p>${esc(tr('server.pin.help'))}</p>
<input name="pin" inputmode="numeric" pattern="\\d{6,10}" maxlength="10" autocomplete="one-time-code" required autofocus aria-label="${esc(tr('server.pin.label'))}" ${locked ? 'disabled' : ''}>
<label class="keep"><input type="checkbox" name="keep" value="1" checked ${locked ? 'disabled' : ''}><span>${esc(tr('server.pin.keep'))}<small>${esc(tr('server.pin.keepHint'))}</small></span></label>
<button type="submit" ${locked ? 'disabled' : ''}>${esc(tr('server.pin.submit'))}</button>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}</form></body></html>`);
  }
  const lockMsg = (until) => tr('server.pin.locked', { n: Math.max(1, Math.ceil((until - Date.now()) / 60e3)) });

  return {
    writePin, currentPin, pinWeak, sameBytes,
    isLoopback, clientIp, sameOriginOf, hostAllowed,
    readJson, withJson, json, readForm,
    tsUrl, lanUrl, pinCookie, pinCookieOf, cookieOk, authorized,
    pinFails, pinLockedUntil, pinFailed, pinPage, lockMsg,
  };
}
