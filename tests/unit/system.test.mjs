import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { within, fmtBytes, fmtDur } from '../../server/system.mjs';

test('within enforces directory containment and blocks sibling prefix tricks', () => {
  const root = path.join(os.tmpdir(), 'office-root');
  const child = path.join(root, 'nested', 'cache');
  const sibling = path.join(os.tmpdir(), 'office-root-other', 'file');
  const escaped = path.join(root, '..', 'outside');

  assert.equal(within(child, [root]), true);
  assert.equal(within(root, [root]), false);      // root itself is not a deletable child
  assert.equal(within(sibling, [root]), false);   // prefix collision must not match
  assert.equal(within(escaped, [root]), false);
  if (process.platform === 'win32') {
    assert.equal(within(child.toUpperCase(), [root.toLowerCase()]), true);
  }
});

test('fmtBytes and fmtDur format memory and elapsed time readably', () => {
  assert.match(fmtBytes(512 * 1024 ** 2), /512/);
  assert.match(fmtBytes(2.5 * 1024 ** 3), /2\.5/);
  assert.match(fmtDur(120), /2/);
  assert.match(fmtDur(3660), /1/);
  assert.match(fmtDur(90_000), /1/);
});
