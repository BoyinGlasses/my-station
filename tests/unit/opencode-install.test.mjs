import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('OpenCode installer is idempotent and never overwrites or deletes another plugin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-opencode-'));
  const file = path.join(dir, 'my-office.js');
  const cli = path.resolve('bin/cli.mjs');
  const args = (op) => [cli, op, '--agent', 'opencode', '--settings', file];
  try {
    fs.writeFileSync(file, 'export const other = true;');
    assert.notEqual(spawnSync(process.execPath, args('install')).status, 0);
    execFileSync(process.execPath, args('uninstall'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'export const other = true;');
    fs.unlinkSync(file);
    execFileSync(process.execPath, args('install'));
    const installed = fs.readFileSync(file, 'utf8');
    execFileSync(process.execPath, args('install'));
    assert.equal(fs.readFileSync(file, 'utf8'), installed);
    execFileSync(process.execPath, args('uninstall'));
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
