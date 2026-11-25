import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';

test('Codex install preserves other hooks, forwards native events, and uninstall removes only its own hooks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-'));
  const file = path.join(dir, 'hooks.json');
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-hook' }] }, { matcher: 'keep-empty', hooks: [] }] }, extra: true };
  fs.writeFileSync(file, JSON.stringify(existing));
  let received;
  const office = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received = JSON.parse(Buffer.concat(chunks)); res.end('{}'); });
  });
  await new Promise((resolve) => office.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, OFFICE_PORT: String(office.address().port), OFFICE_DATA_DIR: dir };
  const cli = path.resolve('bin/cli.mjs');
  const run = (cmd) => execFileSync(process.execPath, [cli, cmd, '--agent', 'codex', '--settings', file], { env });
  try {
    run('install'); run('install');
    const cfg = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(cfg.hooks.Stop[0], existing.hooks.Stop[0]);
    assert.equal(cfg.hooks.UserPromptSubmit.length, 1);
    assert.equal(cfg.hooks.PermissionRequest.length, 2);
    const permission = cfg.hooks.PermissionRequest.find((e) => e.hooks[0].command.includes('/hook/permission')).hooks[0];
    const permissionCommand = permission.command;
    assert.ok(!permission.command.includes('--async'));
    assert.ok(permission.timeout >= 50);
    const command = cfg.hooks.UserPromptSubmit[0].hooks[0].command;
    const shells = process.platform === 'win32' ? [true, 'powershell.exe'] : [true];
    for (const shell of shells) {
      received = undefined;
      const hook = shell === true ? spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = ''; hook.stderr.on('data', (chunk) => { stderr += chunk; });
      hook.stdin.end(JSON.stringify({ session_id: 'thread', hook_event_name: 'UserPromptSubmit', prompt: 'hello' }));
      const code = await new Promise((resolve) => hook.on('close', resolve));
      assert.equal(code, 0, stderr);
      assert.equal(received?.agent, 'codex');
      assert.equal(received?.prompt, 'hello');
    }
    // Existing installs must receive command fixes without losing other hooks or their positions.
    for (const groups of Object.values(cfg.hooks)) for (const group of groups) for (const hook of group.hooks) {
      if (hook.command?.includes('--agent=codex')) hook.command = hook.command.replace(/^[\s\S]*?(?="[^"]*\/hooks\/send\.mjs")/, 'old-node ');
    }
    fs.writeFileSync(file, JSON.stringify(cfg));
    run('install');
    const repaired = JSON.parse(fs.readFileSync(file));
    assert.equal(repaired.hooks.UserPromptSubmit[0].hooks[0].command, command);
    assert.equal(repaired.hooks.PermissionRequest[1].hooks[0].command, permissionCommand);
    assert.deepEqual(repaired.hooks.Stop[0], existing.hooks.Stop[0]);
    run('uninstall');
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), existing);
  } finally {
    office.closeAllConnections(); await new Promise((resolve) => office.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
