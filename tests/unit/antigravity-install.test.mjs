import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('Antigravity installer adds and removes only its named hook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agy-'));
  const file = path.join(dir, 'hooks.json');
  const cli = path.resolve('bin/cli.mjs');
  const args = (op) => [cli, op, '--agent', 'antigravity', '--settings', file];
  const other = { existing: { enabled: false, Stop: [{ type: 'command', command: 'other' }] } };
  try {
    fs.writeFileSync(file, JSON.stringify(other));
    execFileSync(process.execPath, args('install')); execFileSync(process.execPath, args('install'));
    const installed = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(installed.existing, other.existing);
    assert.equal(installed['my-office'].PreToolUse[0].matcher, '*');
    assert.match(installed['my-office'].PreInvocation[0].command, /--event=PreInvocation/);
    installed['my-office'].PreToolUse[0].hooks.push({ type: 'command', command: 'user-hook' });
    fs.writeFileSync(file, JSON.stringify(installed));
    execFileSync(process.execPath, args('uninstall'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), installed);
    installed['my-office'].PreToolUse[0].hooks.pop();
    fs.writeFileSync(file, JSON.stringify(installed));
    execFileSync(process.execPath, args('uninstall'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), other);
    fs.writeFileSync(file, JSON.stringify({ 'my-office': { Stop: [{ command: 'someone-else' }] } }));
    assert.notEqual(spawnSync(process.execPath, args('install')).status, 0);
    execFileSync(process.execPath, args('uninstall'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { 'my-office': { Stop: [{ command: 'someone-else' }] } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
