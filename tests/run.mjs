#!/usr/bin/env node
// npm test. Each case runs the real scripts and asserts on exit codes and output, so a guard
// only passes when it fails for its own reason.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath, ffprobePath } from '../scripts/lib.mjs';

const node = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// check a script's exit code, required substrings and forbidden patterns
const expectRun = (r, { exit, expect = [], forbid = [] }) => {
  const missing = expect.filter(s => !r.out.includes(s)), hit = forbid.filter(rx => rx.test(r.out));
  const ok = r.status === exit && !missing.length && !hit.length;
  return { ok, detail: `exit ${r.status} (wanted ${exit})${missing.length ? '\n  missing: ' + missing.join(' | ') : ''}${hit.length ? '\n  should not appear: ' + hit.join(' | ') : ''}\n${r.out}` };
};

const cases = [
  ['clips: every rendered frame shows its exact source frame', () => {
    const fx = path.resolve('tests/fixtures/clip'), vid = path.join(fx, 'assets', 'ramp.webm');
    fs.mkdirSync(path.dirname(vid), { recursive: true });
    // 4 s at 30 fps; frame N has brightness (N * 8) mod 256, so one frame of lag is visible
    if (!fs.existsSync(vid)) {
      const g = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=4,format=gray,geq=lum=mod(N*8\\,256)',
        '-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '10', vid], { encoding: 'utf8' });
      if (g.status !== 0) return { ok: false, detail: 'could not make ramp.webm: ' + g.stderr };
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'f.mp4');
    const from = 0.5, n = 8; // data-from=1: scene time t shows source time 1 + t
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--fps', '30', '--from', String(from), '--to', String(from + n / 30), '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    const raw = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', out, '-vf', 'crop=4:4:iw/2:ih/2,scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
    fs.rmSync(tmp, { recursive: true, force: true });
    const problems = [];
    for (let i = 0; i < n; i++) {
      const want = (Math.round((1 + from + i / 30) * 30) * 8) % 256, got = raw[i];
      if (got == null || Math.abs(got - want) > 3) problems.push(`frame ${i}: brightness ${got}, source frame wants ${want}`);
    }
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['render: a 1 s draft is standard yuv420p, limited range, bt709', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'clip.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', 'airplane-food', '--draft', '--from', '0', '--to', '1', '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    const p = spawnSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=pix_fmt,color_range,color_space', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().replace(/,+$/, '');
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: p === 'yuv420p,tv,bt709', detail: `ffprobe: ${p} (wanted yuv420p,tv,bt709)` };
  }],

  ['example reel passes the self-check', () => expectRun(node('scripts/check.mjs', ['airplane-food']), { exit: 0 })],

  ['design rules: each banned pattern fails for its own reason, controls pass', () => expectRun(node('scripts/check.mjs', [path.resolve('tests/fixtures/rules')]), {
    exit: 2,
    expect: [
      'data-ease="out" on a moving "rise" entrance',
      '.card-x: CSS transition in an inline <style>',
      '@keyframes wobble: CSS keyframe animation',
      'inline CSS animation',
      '"Game changer": all-caps centred text on a colour gradient',
      '5 errors',
    ],
    forbid: [/Pattern ok.*all-caps/, /Vignette ok.*all-caps/],
  })],

  ['taste: a reel slower than its references gets a pacing warning', () => expectRun(node('scripts/check.mjs', ['airplane-food', '--taste', path.resolve('tests/fixtures/taste-fast')]), {
    exit: 0, expect: ['slower than the', 'they show something new every 0.8s', 'taste "'],
  })],

  ['ref: measures cuts, colours and loudness, and keeps hand-written notes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-'));
    const vid = path.join(tmp, 'three-shots.mp4'), taste = path.join(tmp, 'taste');
    // white, black, blue: one second each, with a tone, so cuts land at exactly 1s and 2s
    const f = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error',
      ...['white', 'black', '0x2050c0'].flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=360x640:d=1:r=30`]),
      '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid], { encoding: 'utf8' });
    if (f.status !== 0) return { ok: false, detail: 'could not make the test video: ' + f.stderr };
    const r1 = node('scripts/ref.mjs', [taste, vid]);
    const mf = path.join(taste, 'refs', 'three-shots.metrics.json');
    if (r1.status !== 0 || !fs.existsSync(mf)) return { ok: false, detail: r1.out };
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const near = (hex, rgb) => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.hypot(...v.map((x, i) => x - rgb[i])) < 40; };
    const problems = [];
    if (JSON.stringify(m.cuts) !== '[1,2]') problems.push(`cuts ${JSON.stringify(m.cuts)}, wanted [1,2]`);
    if (m.shots !== 3 || m.avgShot !== 1) problems.push(`shots ${m.shots}, avgShot ${m.avgShot}`);
    if (!(m.motion < 0.01)) problems.push(`motion ${m.motion} for still shots, wanted < 0.01`);
    if (m.beats.length !== 0 || m.pace !== 1) problems.push(`beats ${JSON.stringify(m.beats)}, pace ${m.pace}: still shots have no beats, pace = shot length`);
    if (!m.palette.some(h => near(h, [255, 255, 255])) || !m.palette.some(h => near(h, [0, 0, 0])) || !m.palette.some(h => near(h, [32, 80, 192]))) problems.push(`palette ${m.palette}`);
    if (typeof m.lufs !== 'number') problems.push('no loudness');
    if (!fs.existsSync(path.join(taste, 'refs', 'three-shots.sheet.jpg'))) problems.push('no contact sheet');
    // notes outside the measured block survive a re-measure
    const md = path.join(taste, 'taste.md');
    fs.appendFileSync(md, '\nMY NOTE: keep the hold on the logo.\n');
    const r2 = node('scripts/ref.mjs', [taste]);
    const text = fs.readFileSync(md, 'utf8');
    if (r2.status !== 0) problems.push('re-measure failed: ' + r2.out);
    if (!text.includes('MY NOTE: keep the hold on the logo.')) problems.push('re-measure dropped the hand-written note');
    if ((text.match(/measured:start/g) || []).length !== 1) problems.push('measured block duplicated');
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: !problems.length, detail: problems.join('\n  ') + '\n' + r1.out };
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  const { ok, detail } = fn();
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) { failed++; console.log(detail.split('\n').map(l => '    ' + l).join('\n')); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
