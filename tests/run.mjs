#!/usr/bin/env node
// npm test: the example reel must pass the self-check with no errors.
// Each case runs a real `npm run check` and asserts on its exit code and output.
import { spawnSync } from 'node:child_process';

const cases = [
  { name: 'example reel passes the self-check', reel: 'airplane-food', exit: 0, expect: [] },
];

let failed = 0;
for (const c of cases) {
  const r = spawnSync(process.execPath, ['scripts/check.mjs', c.reel], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const missing = c.expect.filter(s => !out.includes(s));
  const ok = r.status === c.exit && !missing.length;
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) {
    failed++;
    console.log(`  exit ${r.status} (wanted ${c.exit})${missing.length ? '\n  missing: ' + missing.join(' | ') : ''}`);
    console.log(out.split('\n').map(l => '    ' + l).join('\n'));
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
