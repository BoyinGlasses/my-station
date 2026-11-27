// Resolve npm and Windows command shims without invoking a shell or choosing another installed CLI,
// plus cached CLI discovery across Claude Code, Codex, OpenCode, Antigravity, and ZCode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EDITORS } from './editors.mjs';

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
export const verNum = (f) => (/-(\d+)\.(\d+)\.(\d+)/.exec(f) || [0, 0, 0, 0]).slice(1).reduce((x, n) => x * 100000 + Number(n), 0);

export function cliCommand(file, depth = 0) {
  try {
    if (!fs.statSync(file).isFile() || depth > 4) return null;
    if (/\.(cmd|bat)$/i.test(file)) {
      const text = fs.readFileSync(file, 'utf8'), dir = path.dirname(file);
      for (const match of text.matchAll(/"([^"\r\n]+)"/g)) {
        const target = match[1].replace(/%dp0%|%~dp0/gi, dir + path.sep);
        if (/%/.test(target) || !path.isAbsolute(target) || /(?:^|[\\/])node(?:\.exe)?$/i.test(target)) continue;
        const result = cliCommand(path.normalize(target), depth + 1);
        if (result) return result;
      }
      return null;
    }
    const buf = Buffer.alloc(100), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    return /\.[cm]?js$/i.test(file) || /^#!.*\bnode\b/.test(buf.toString('utf8')) ? { file: process.execPath, args: [file] } : { file };
  } catch { return null; }
}

export function openCodeCommand(env = process.env) {
  if (env.OFFICE_OPENCODE_BIN) { const b = cliCommand(env.OFFICE_OPENCODE_BIN); return b && { ...b, protocol: 'acp' }; }
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode.bat'] : ['opencode']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) { const b = cliCommand(file); return b && { ...b, protocol: 'acp' }; }
    }
  }
  return null;
}

export function createBinFinder({ home = os.homedir(), env = process.env } = {}) {
  let claudeBin = null;
  const binCache = new Map();
  const cachedBin = (key, envVar, resolve) => {
    const envVal = env[envVar] || '';
    const hit = binCache.get(key), now = Date.now();
    if (hit && hit.envVal === envVal && now - hit.at < 60_000 && (!hit.val || fs.existsSync(hit.val.file))) return hit.val;
    const val = resolve();
    binCache.set(key, { envVal, val, at: now });
    return val;
  };
  const asProto = (f, protocol) => {
    const base = /\.[cm]?js$/i.test(f) ? { file: process.execPath, args: [f] } : { file: f };
    return protocol ? { ...base, protocol } : base;
  };

  const findOpenCode = () => cachedBin('opencode', 'OFFICE_OPENCODE_BIN', () => openCodeCommand(env));

  const findCodex = () => cachedBin('codex', 'OFFICE_CODEX_BIN', () => {
    const override = env.OFFICE_CODEX_BIN;
    if (override && isFile(override)) return asProto(override, 'codex');
    const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
    for (const d of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (isFile(path.join(d, exe))) return asProto(path.join(d, exe), 'codex');
      const npm = path.join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (isFile(npm)) return asProto(npm, 'codex');
    }
    const found = [];
    for (const { dot } of EDITORS) {
      const base = path.join(home, dot, 'extensions');
      let names = []; try { names = fs.readdirSync(base).filter((e) => /^openai\.chatgpt-/.test(e)); } catch { /* not installed */ }
      for (const e of names) { try { for (const p of fs.readdirSync(path.join(base, e, 'bin'))) if (isFile(path.join(base, e, 'bin', p, exe))) found.push(path.join(base, e, 'bin', p, exe)); } catch { /* no programs */ } }
    }
    const latest = found.sort((a, b) => verNum(b) - verNum(a))[0];
    return latest ? asProto(latest, 'codex') : null;
  });

  const findAntigravity = () => cachedBin('antigravity', 'OFFICE_ANTIGRAVITY_BIN', () => {
    const override = env.OFFICE_ANTIGRAVITY_BIN;
    if (override && isFile(override)) return asProto(override, 'acp');
    const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
    for (const d of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (isFile(path.join(d, exe))) return asProto(path.join(d, exe), 'acp');
    }
    const installed = path.join(env.LOCALAPPDATA || path.join(home, '.local'), 'agy', 'bin', exe);
    return isFile(installed) ? asProto(installed, 'acp') : null;
  });

  const findZCode = () => cachedBin('zcode', 'OFFICE_ZCODE_BIN', () => {
    const override = env.OFFICE_ZCODE_BIN;
    if (override && isFile(override)) return asProto(override);
    const resources = process.platform === 'win32' ? path.join(env.LOCALAPPDATA || '', 'Programs', 'ZCode', 'resources') : process.platform === 'darwin' ? '/Applications/ZCode.app/Contents/Resources' : '';
    if (resources) {
      const script = path.join(resources, 'glm', 'zcode.cjs'), config = path.join(resources, 'config', 'provider', 'zcode-builtin.json');
      if (isFile(script) && isFile(config)) return { ...asProto(script), env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: config } };
    }
    const exe = process.platform === 'win32' ? 'zcode.exe' : 'zcode';
    for (const d of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (isFile(path.join(d, exe))) return asProto(path.join(d, exe));
    }
    return null;
  });

  const findClaude = () => {
    if (claudeBin && fs.existsSync(claudeBin.file)) return claudeBin;
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    if (env.OFFICE_CLAUDE_BIN && isFile(env.OFFICE_CLAUDE_BIN)) {
      const cmd = cliCommand(env.OFFICE_CLAUDE_BIN) || { file: env.OFFICE_CLAUDE_BIN };
      return (claudeBin = { ...cmd, onPath: false });
    }
    const npmExe = (d) => path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe);
    for (const d of String(env.PATH || '').split(path.delimiter)) {
      if (d && isFile(path.join(d, exe))) return (claudeBin = { file: path.join(d, exe), onPath: true });
      if (d && process.platform === 'win32' && isFile(npmExe(d))) return (claudeBin = { file: npmExe(d), onPath: true });
    }
    for (const f of [...(env.APPDATA ? [npmExe(path.join(env.APPDATA, 'npm'))] : []), path.join(home, '.local', 'bin', exe), path.join(home, '.claude', 'local', exe), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', exe), path.join(home, '.bun', 'bin', exe)]) {
      if (isFile(f)) return (claudeBin = { file: f, onPath: false });
    }
    const found = [];
    for (const { dot } of EDITORS) {
      try { for (const e of fs.readdirSync(path.join(home, dot, 'extensions'))) if (/^anthropic\.claude-code-/.test(e)) found.push(path.join(home, dot, 'extensions', e, 'resources', 'native-binary', exe)); } catch { /* not installed */ }
    }
    const best = found.filter(isFile).sort((a, b) => verNum(b) - verNum(a))[0];
    return (claudeBin = best ? { file: best, onPath: false } : null);
  };

  return { findClaude, findCodex, findOpenCode, findAntigravity, findZCode };
}
