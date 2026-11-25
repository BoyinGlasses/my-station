import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listModels } from '../../server/models.mjs';

test('lists configured models from the CLI, filters invalid output and isolates the project', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-models-'));
  const script = path.join(dir, 'cli.mjs');
  fs.writeFileSync(script, `if(process.env.PWD!==process.cwd())process.exit(1);console.log('custom/model-1\\nother/model-2\\n--unsafe\\ncustom/model-1');`);
  try {
    const result = await listModels('opencode', { file: process.execPath, args: [script] }, dir);
    assert.deepEqual(result.map((m) => m.id), ['custom/model-1', 'other/model-2']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reads Codex model list using its app-server protocol', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-models-'));
  const script = path.join(dir, 'cli.mjs');
  fs.writeFileSync(script, `import readline from 'node:readline';for await (const line of readline.createInterface({input:process.stdin})) {const q=JSON.parse(line);if(q.method==='initialize') console.log(JSON.stringify({id:q.id,result:{}}));if(q.method==='model/list') console.log(JSON.stringify({id:q.id,result:{data:[{model:'my-model',displayName:'My Model'}],nextCursor:null}}));}`);
  try { assert.deepEqual(await listModels('codex', { file: process.execPath, args: [script] }, dir), [{ id: 'my-model', name: 'My Model' }]); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import { modelsOf, withModels, hasSplit, withSplit } from '../../server/models.mjs';

// settings.json: the session's model, the subagents' in the env block; the rest of the file untouched
test('the coordinator on Opus, the subagents on Sonnet, forced or not, and back to the defaults', () => {
  const mine = { model: 'opus', permissions: { allow: ['Bash(ls:*)'] }, env: { OTEL_LOGS_EXPORTER: 'otlp' } };
  assert.deepEqual(modelsOf(mine), { main: 'opus', sub: '', force: false });
  const s1 = withModels(mine, { sub: 'sonnet' });
  assert.deepEqual(s1.env, { OTEL_LOGS_EXPORTER: 'otlp', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
  assert.deepEqual(s1.permissions, mine.permissions);
  assert.deepEqual(modelsOf(s1), { main: 'opus', sub: 'sonnet', force: false });
  const s2 = withModels(s1, { force: true });
  assert.equal(s2.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE, '1');
  assert.deepEqual(modelsOf(s2), { main: 'opus', sub: 'sonnet', force: true });
  // another subagent model keeps "always"; "the same as the session" drops it (nothing to force)
  assert.equal(withModels(s2, { sub: 'haiku' }).env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE, '1');
  const s3 = withModels(s2, { sub: '', main: '' });
  assert.deepEqual(s3, { permissions: mine.permissions, env: { OTEL_LOGS_EXPORTER: 'otlp' } });
  assert.deepEqual(withModels({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' } }, { sub: '' }), {});   // (an empty env block goes)
  assert.deepEqual(modelsOf({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }), { main: '', sub: '', force: false });
  assert.equal(mine.env.CLAUDE_CODE_SUBAGENT_MODEL, undefined);   // (not changed in place)
});

test('the note in CLAUDE.md: added after what is there, taken out exactly, never twice', () => {
  const note = '## Big tasks\nSplit them.';
  const own = '# My rules\n\nWrite tests first.\n';
  const on = withSplit(own, true, note);
  assert.ok(on.startsWith(own.trimEnd() + '\n\n<!-- my-office:subagents -->\n## Big tasks'));
  assert.ok(hasSplit(on));
  assert.equal(withSplit(on, true, note), on);
  assert.equal(withSplit(on, false, note), own);
  assert.equal(withSplit('', true, note), '<!-- my-office:subagents -->\n## Big tasks\nSplit them.\n<!-- /my-office:subagents -->\n');
  assert.equal(withSplit(withSplit('', true, note), false, note), '');
  // what you wrote after it stays where it is
  const after = `${on}\n# Later\nmore\n`;
  assert.equal(withSplit(after, false, note), '# My rules\n\nWrite tests first.\n\n# Later\nmore\n');
});
