#!/usr/bin/env node
// Cross-platform stand-in for Claude Code's CLI in end-to-end and unit tests (OFFICE_CLAUDE_BIN).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const joined = ` ${args.join(' ')} `;
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const BG = path.join(HOME, '.fake-bg');
const OFFICE = `http://127.0.0.1:${process.env.OFFICE_PORT || '4310'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (id, sid, state, extra = {}) => {
  fs.mkdirSync(BG, { recursive: true });
  fs.writeFileSync(path.join(BG, `${id}.json`), JSON.stringify({ id, cwd: process.cwd(), kind: 'background', startedAt: Date.now(), sessionId: sid, name: id, state, ...extra }));
};
const post = async (url, body, headers = {}) => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
    return await r.text();
  } catch { return ''; }
};

if (args[0] === '__bg-worker') {
  const [, id, sid, prompt] = args;
  const hdr = { 'X-Office-Job': id, 'X-Office-Inbox': process.env.FAKE_INBOX || '' };
  const ev = (name, extra = {}) => post(`${OFFICE}/event`, { session_id: sid, cwd: process.cwd(), hook_event_name: name, ...extra }, hdr);
  await post(`${OFFICE}/hook/bind`, { session_id: sid, cwd: process.cwd(), hook_event_name: 'SessionStart', source: 'startup' }, hdr);
  await ev('SessionStart', { source: 'startup' });
  await ev('UserPromptSubmit', { prompt });
  await sleep(1000);
  await ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/e2e/README.md' } });
  let said = 'Done in the background.';
  if (prompt.includes('approval')) {
    const req = { session_id: sid, cwd: process.cwd(), hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm run e2e-bg' } };
    const short = await post(`${OFFICE}/hook/permission`, req);
    fs.appendFileSync(path.join(BG, `${id}.hooks`), `short=[${short}]\n`);
    const got = await post(`${OFFICE}/hook/permission?long=1`, req);
    fs.appendFileSync(path.join(BG, `${id}.hooks`), `long=${got}\n`);
    said = got.includes('"allow"') ? 'Done in the background: allowed.' : 'Done in the background: not allowed.';
  }
  if (prompt.includes('slowly')) await sleep(25_000);
  await ev('Stop', { last_assistant_message: said });
  row(id, sid, 'done');
  fs.rmSync(path.join(BG, `${id}.pid`), { force: true });
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'login') {
  console.log('Opening browser to sign in…');
  console.log("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&e2e=1");
  await sleep(6000);
  const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'e2e', organizationUuid: 'e2e' } }));
  console.log('Login successful.');
  process.exit(0);
}

if (args[0] === '--version') { console.log('2.1.316 (Claude Code)'); process.exit(0); }
if (args[0] === '--help') {
  console.log('Usage: claude [options] [command] [prompt]');
  console.log('  --bg, --background                    Start the session in the background and return immediately.');
  console.log('  -p, --print                           Print response and exit');
  console.log('Commands:');
  console.log('  agents [options]                      Manage background agents');
  console.log('  attach <id|name>                      Open a background session in this terminal.');
  process.exit(0);
}

if (args[0] === 'agents') {
  const rows = [];
  if (fs.existsSync(BG)) {
    for (const f of fs.readdirSync(BG).filter((n) => n.endsWith('.json')).sort()) {
      try { rows.push(JSON.parse(fs.readFileSync(path.join(BG, f), 'utf8'))); } catch { /* ignore */ }
    }
  }
  console.log(JSON.stringify(rows));
  process.exit(0);
}

if (args[0] === 'stop') {
  const target = args[1], file = path.join(BG, `${target}.json`), pidFile = path.join(BG, `${target}.pid`);
  if (!fs.existsSync(file)) { console.log(`No job matching '${target}'. Run 'claude agents' to list running sessions.`); process.exit(1); }
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (pid > 1) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    fs.rmSync(pidFile, { force: true });
  }
  const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  row(target, prev.sessionId, 'stopped');
  console.log(`stopped ${target}`);
  process.exit(0);
}

if (args[0] === '--bg') {
  fs.mkdirSync(BG, { recursive: true });
  fs.appendFileSync(path.join(HOME, '.fake-claude.log'), `${args.join(' ')}\n`);
  let prompt = '', seen = false, resume = '', prev = '';
  for (const a of args) {
    if (seen) prompt = a;
    else if (a === '--') seen = true;
    else if (prev === '--resume') resume = a;
    prev = a;
  }
  if (prompt.includes('untrusted')) {
    console.error(`Workspace not trusted. Run \`claude\` in ${process.cwd()} once and accept the trust prompt, then retry.`);
    process.exit(1);
  }
  let id = crypto.randomBytes(4).toString('hex');
  const sid = resume || `e2e-bg-${id}`;
  for (const f of fs.readdirSync(BG).filter((n) => n.endsWith('.json'))) {
    try { if (JSON.parse(fs.readFileSync(path.join(BG, f), 'utf8')).sessionId === sid) id = f.slice(0, -5); } catch { /* ignore */ }
  }
  row(id, sid, 'working', { pid: 1, status: 'busy' });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__bg-worker', id, sid, prompt], { cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  fs.writeFileSync(path.join(BG, `${id}.pid`), String(child.pid));
  console.log(`backgrounded · ${id}`);
  console.log('  claude agents             list sessions');
  console.log(`  claude attach ${id}    open in this terminal`);
  process.exit(0);
}

if (joined.includes(' --output-format json ')) {
  fs.appendFileSync(path.join(HOME, '.fake-claude-rewrite.log'), `${args.map((a) => `[${a}]`).join('')}\n`);
  if (joined.includes('slowly')) await sleep(5000);
  if (joined.includes('fail please')) {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached' }));
    process.exit(1);
  }
  if (joined.includes('Mục tiêu')) {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Mục tiêu: sửa lỗi đang thấy trong ảnh đính kèm.\nBối cảnh: [trang nào?]\nXong khi: trang hiện đúng, không còn lỗi.', total_cost_usd: 0.0004 }));
  } else {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '```\nGoal: fix the error in the attached screenshot.\nContext: [which page?]\nDone when: the page shows no error.\n```', total_cost_usd: 0.0004 }));
  }
  process.exit(0);
}

if (args.includes('-p')) {
  fs.appendFileSync(path.join(HOME, '.fake-claude.log'), `${args.join(' ')}\n`);
  const bindMatch = /http:\/\/127\.0\.0\.1:\d+\/hook\/bind\?task=[0-9a-z]+/.exec(joined);
  if (bindMatch && process.env.FAKE_INBOX) {
    await post(bindMatch[0], { session_id: 'e2e-task-1', hook_event_name: 'SessionStart' }, { 'X-Office-Inbox': process.env.FAKE_INBOX });
  }
  let sid = 'e2e-task-1';
  if (joined.includes('pick one')) {
    const idx = args.indexOf('--resume');
    if (idx >= 0 && args[idx + 1]) sid = args[idx + 1];
  }
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/e2e/README.md' } }] } }));
  await sleep(1000);
  if (joined.includes('slowly')) await sleep(25_000);
  if (joined.includes('pick one')) {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Which way?\nA) Push it now\nB) Wait for CI' }));
  } else if (joined.includes('with a picture')) {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `**Done**, with:\n- one change\n- and \`code\`\nSCREENSHOT: http://127.0.0.1:${process.env.OFFICE_PORT || '4310'}/health` }));
  } else {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done: the e2e task.' }));
  }
  process.exit(0);
}

process.exit(1);
