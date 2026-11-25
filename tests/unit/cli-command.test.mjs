import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cliCommand, openCodeCommand } from '../../server/cli-command.mjs';

test('the explicit OpenCode executable wins and Node launchers without extensions keep their runtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-cli-'));
  try {
    const script = path.join(dir, 'opencode'); fs.writeFileSync(script, '#!/usr/bin/env node\n');
    assert.deepEqual(openCodeCommand({ OFFICE_OPENCODE_BIN: script, PATH: '' }), { file: process.execPath, args: [script], protocol: 'acp' });
    assert.equal(openCodeCommand({ OFFICE_OPENCODE_BIN: path.join(dir, 'missing'), PATH: process.env.PATH }), null);
    const inner = path.join(dir, 'inner.cmd'), outer = path.join(dir, 'opencode.cmd');
    fs.writeFileSync(inner, `@echo off\nnode "%dp0%opencode" %*\n`);
    fs.writeFileSync(outer, `@echo off\n"${inner}" %*\n`);
    assert.deepEqual(cliCommand(outer), { file: process.execPath, args: [script] });
    fs.writeFileSync(inner, `@echo off\n"${outer}" %*\n`);
    assert.equal(cliCommand(outer), null, 'cycles never invoke a shell');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OpenCode installs the bridge for the selected CLI version without touching provider settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-opencode-version-'));
  try {
    const script = path.join(dir, 'cli.mjs'), plugin = path.join(dir, 'my-office.js');
    const run = () => execFileSync(process.execPath, ['bin/cli.mjs', 'install', '--agent', 'opencode', '--settings', plugin], { env: { ...process.env, OFFICE_OPENCODE_BIN: script, OFFICE_OPENCODE_V1: '' }, stdio: 'pipe' });
    fs.writeFileSync(script, "console.log('1.5.0');"); run();
    assert.match(fs.readFileSync(plugin, 'utf8'), /export default createOfficePlugin\(/);
    fs.writeFileSync(script, "console.log('opencode v2.2.7');"); run();
    assert.match(fs.readFileSync(plugin, 'utf8'), /export default createOpenCode2Plugin\(/);
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('my-office.js.backup-')).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
