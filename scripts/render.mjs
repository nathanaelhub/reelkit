#!/usr/bin/env node
// Render a reel to MP4: seek each frame in headless Chromium, screenshot, pipe into ffmpeg, mux voiceover (+ optional music).
//   npm run render -- <reel> [--draft] [--from 3 --to 9] [--fps 30] [--workers 4]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { parseArgs, reelDir, openReel, ffmpegPath, OUT, ROOT, readJSON, run, die } from './lib.mjs';

const args = parseArgs();
const dir = reelDir(args._[0]);
const name = path.basename(dir);
const tl = readJSON(path.join(dir, 'timeline.json'));
const draft = !!args.draft;
const fps = +(args.fps || (draft ? 15 : tl.fps || 30));
const scale = draft ? 0.5 : 1;
const from = args.from ? +args.from : 0;
const to = args.to ? Math.min(+args.to, tl.duration) : tl.duration;
const total = Math.max(1, Math.round((to - from) * fps));
const workers = Math.max(1, Math.min(+(args.workers || Math.min(4, Math.max(1, os.cpus().length - 1))), Math.ceil(total / 30)));
const ff = ffmpegPath(); if (!ff) die('ffmpeg not found. Run: npm run doctor -- --fix');

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-'));
const outFile = path.resolve(args.out || path.join(OUT, `${name}${draft ? '.draft' : ''}.mp4`));

async function renderChunk(k, f0, f1) {
  const seg = path.join(tmp, `seg${k}.mp4`);
  const { page, close, errors } = await openReel(dir, { scale });
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    // screenshots are full-range JPEG; convert to limited-range bt709 yuv420p, the standard for social video
    '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', draft ? 'ultrafast' : 'veryfast', '-crf', draft ? '28' : '18', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(fps), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => enc.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));
  const stage = await page.$('#stage');
  for (let f = f0; f < f1; f++) {
    const t = from + f / fps;
    await page.evaluate(t => window.__reel.seek(t), t);
    const buf = await stage.screenshot({ type: 'jpeg', quality: draft ? 80 : 94 });
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    progress[k] = f - f0 + 1;
  }
  enc.stdin.end();
  await done; await close();
  if (errors.length) console.warn(`\n⚠ page errors in worker ${k}:\n  ${[...new Set(errors)].join('\n  ')}`);
  return seg;
}

const progress = new Array(workers).fill(0);
const started = Date.now();
const timer = setInterval(() => {
  const n = progress.reduce((a, b) => a + b, 0);
  const el = (Date.now() - started) / 1000;
  const pct = Math.round(100 * n / total);
  if (process.stdout.isTTY) process.stdout.write(`\r  rendering ${name}: ${n}/${total} frames (${pct}%)  ${el.toFixed(0)}s   `);
  else if (pct >= (timer.lastPct ?? -10) + 10) { timer.lastPct = pct - (pct % 10); console.log(`  ${pct}% (${n}/${total} frames, ${el.toFixed(0)}s)`); }
}, 500);

console.log(`\n▸ ${name}: ${(to - from).toFixed(2)}s @ ${fps}fps, ${draft ? '540x960 draft' : '1080x1920'}, ${workers} worker${workers > 1 ? 's' : ''}`);
const per = Math.ceil(total / workers);
let segs;
try {
  segs = await Promise.all([...Array(workers)].map((_, k) => renderChunk(k, k * per, Math.min(total, (k + 1) * per))));
} catch (e) { clearInterval(timer); die(e.message); }
clearInterval(timer);
process.stdout.write(`\r  rendered ${total} frames in ${((Date.now() - started) / 1000).toFixed(1)}s                     \n`);

// concat + audio
const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
const audio = tl.audio ? path.join(dir, tl.audio) : null;
const music = ['music.mp3', 'music.m4a', 'music.wav'].map(f => path.join(dir, f)).find(f => fs.existsSync(f))
  || (tl.music ? path.resolve(dir, tl.music) : null);
const a = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
let filter = null; const maps = ['-map', '0:v'];
let ai = 1;
if (audio && fs.existsSync(audio)) { a.push('-ss', String(from), '-t', String(to - from), '-i', audio); }
else ai = 0;
if (music && fs.existsSync(music)) {
  a.push('-stream_loop', '-1', '-t', String(to - from), '-i', music);
  const mv = tl.musicVolume ?? 0.12;
  filter = ai
    ? `[2:a]volume=${mv},afade=t=out:st=${Math.max(0, to - from - 1.5)}:d=1.5[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`
    : `[1:a]volume=${mv},afade=t=out:st=${Math.max(0, to - from - 1.5)}:d=1.5[a]`;
}
if (filter) { a.push('-filter_complex', filter); maps.push('-map', '[a]'); }
else if (ai) maps.push('-map', '1:a');
a.push(...maps, '-c:v', 'copy');
if (ai || filter) a.push('-c:a', 'aac', '-b:a', '192k');
a.push('-t', String(to - from), '-movflags', '+faststart', outFile);
run(ff, a);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ ${path.relative(process.cwd(), outFile) || outFile}`);
