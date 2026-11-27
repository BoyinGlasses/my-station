import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrophies, MILESTONES } from '../../server/trophies.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'office-trophies-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const today = () => '2026-10-27';

test('the opening plaque is earned on the first run, without a message', (t) => {
  const sent = [];
  const tr = createTrophies({ dataDir: tmp(t), claudeDir: tmp(t), today, deployRe: /git push .*v\d/, onChange: (p, earned) => sent.push(earned) });
  assert.ok(tr.pub().earned.open);
  assert.equal(sent.length, 0);
});

test('live counts reach a milestone and announce it once', (t) => {
  const sent = [];
  const tr = createTrophies({ dataDir: tmp(t), claudeDir: tmp(t), today, deployRe: /git push .*v\d/, onChange: (p, earned) => sent.push(...earned) });
  tr.bump('deploy');
  assert.deepEqual(sent, ['d1']);
  tr.bump('deploy');
  assert.deepEqual(sent, ['d1'], 'not announced twice');
  assert.equal(tr.pub().totals.deploy, 2);
});

test('a session counts once however many prompts it gets', (t) => {
  const tr = createTrophies({ dataDir: tmp(t), claudeDir: tmp(t), today, deployRe: /x/, onChange: () => {} });
  tr.session('abc'); tr.session('abc'); tr.session('def');
  assert.equal(tr.pub().totals.sessions, 2);
});

test('every milestone has a known kind and a positive threshold', () => {
  for (const m of MILESTONES) { assert.ok(['plaque', 'cup', 'star', 'book', 'rocket', 'medal'].includes(m.kind), m.id); assert.ok(m.n > 0, m.id); }
});
