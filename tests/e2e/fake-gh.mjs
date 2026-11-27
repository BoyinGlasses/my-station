#!/usr/bin/env node
// Cross-platform stand-in for GitHub CLI `gh` in end-to-end tests (GH_PATH).
import fs from 'node:fs';
import path from 'node:path';

const cmd = `${process.argv[2] || ''} ${process.argv[3] || ''}`;
if (cmd === 'run list') {
  const file = path.join(process.env.FAKE_GH_DIR || '', `${path.basename(process.cwd())}.json`);
  try { process.stdout.write(fs.readFileSync(file, 'utf8')); } catch { console.log('[]'); }
  process.exit(0);
}
if (cmd === 'release list') {
  console.log('[]');
  process.exit(0);
}
process.exit(1);
