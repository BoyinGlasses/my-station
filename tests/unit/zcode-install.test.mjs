import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('ZCode installer preserves existing hooks and does not enable disabled user hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-zcode-'));
  const file = path.join(dir, 'config.json');
  const cli = path.resolve('bin/cli.mjs');
  const args = (op) => [cli, op, '--agent', 'zcode', '--settings', file];
  const cfg = { hooks: { enabled: true, events: { Stop: [{ hooks: [{ type: 'process', command: 'other', args: [] }] }] } }, model: 'custom' };
  try {
    fs.writeFileSync(file, JSON.stringify(cfg));
    execFileSync(process.execPath, args('install'));
    execFileSync(process.execPath, args('install'));
    const installed = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(installed.hooks.events.Stop[0], cfg.hooks.events.Stop[0]);
    assert.equal(installed.hooks.events.UserPromptSubmit.length, 1);
    assert.equal(installed.hooks.events.UserPromptSubmit[0].hooks[0].type, 'process');
    execFileSync(process.execPath, args('uninstall'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), cfg);
    cfg.hooks.enabled = false;
    fs.writeFileSync(file, JSON.stringify(cfg));
    assert.notEqual(spawnSync(process.execPath, args('install')).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), cfg);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
