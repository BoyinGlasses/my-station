// Resolve npm and Windows command shims without invoking a shell or choosing another installed CLI.
import fs from 'node:fs';
import path from 'node:path';

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
