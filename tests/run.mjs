#!/usr/bin/env node
// npm test: the example reel must pass the self-check, and each design rule must fire on the fixture.
// Each case runs a real `npm run check` and asserts on its exit code and output.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cases = [
  { name: 'example reel passes the self-check', reel: 'airplane-food', exit: 0, expect: [] },
  { name: 'design rules: each banned pattern fails for its own reason, controls pass', reel: path.resolve('tests/fixtures/rules'), exit: 2,
    expect: [
      'data-ease="out" on a moving "rise" entrance',
      '.card-x: CSS transition in an inline <style>',
      '@keyframes wobble: CSS keyframe animation',
      'inline CSS animation',
      '"Game changer": all-caps centred text on a colour gradient',
      '5 errors',
    ],
    forbid: [/Pattern ok.*all-caps/, /Vignette ok.*all-caps/] },
];

let failed = 0;
for (const c of cases) {
  const r = spawnSync(process.execPath, ['scripts/check.mjs', c.reel], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const missing = c.expect.filter(s => !out.includes(s));
  const hit = (c.forbid || []).filter(rx => rx.test(out));
  const ok = r.status === c.exit && !missing.length && !hit.length;
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) {
    failed++;
    console.log(`  exit ${r.status} (wanted ${c.exit})${missing.length ? '\n  missing: ' + missing.join(' | ') : ''}${hit.length ? '\n  should not appear: ' + hit.join(' | ') : ''}`);
    console.log(out.split('\n').map(l => '    ' + l).join('\n'));
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
