#!/usr/bin/env node
// Render a reel to MP4: seek each frame in headless Chromium, screenshot, pipe into ffmpeg, mux voiceover (+ optional music).
//   npm run render -- <reel> [--draft] [--from 3 --to 9] [--fps 30] [--workers 4]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, reelDir, openReel, ffmpegPath, OUT, ROOT, readJSON, run, die } from './lib.mjs';
import { renderScore, scoreIsStale } from './score.mjs';
import { ensureDepthMaps } from './depth.mjs';

const args = parseArgs();
const dir = reelDir(args._[0]);
const name = path.basename(dir);
const tl = readJSON(path.join(dir, 'timeline.json'));
// mix settings are read live from script.json, so changing them doesn't need a re-voice
const mix = fs.existsSync(path.join(dir, 'script.json')) ? readJSON(path.join(dir, 'script.json')) : {};
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
    await page.evaluate(async t => { window.__reel.seek(t); await window.__reel.settle(); }, t);
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

const W = tl.width || 1080, H = tl.height || 1920;
console.log(`\n▸ ${name}: ${(to - from).toFixed(2)}s @ ${fps}fps, ${draft ? `${W / 2}x${H / 2} draft` : `${W}x${H}`}, ${workers} worker${workers > 1 ? 's' : ''}`);
await ensureDepthMaps(dir);
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
// score.js (music + sound effects in code) renders to score.wav; refresh it when the script or timeline changed
if (scoreIsStale(dir)) { console.log('  scoring score.js'); await renderScore(dir, { quiet: true }); }
const score = fs.existsSync(path.join(dir, 'score.js')) && fs.existsSync(path.join(dir, 'score.wav')) ? path.join(dir, 'score.wav') : null;
const a = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
const maps = ['-map', '0:v'];
const len = to - from, fadeOut = `afade=t=out:st=${Math.max(0, len - 1.5)}:d=1.5`;
let n = 1; const inputs = {};
if (audio && fs.existsSync(audio)) { a.push('-ss', String(from), '-t', String(len), '-i', audio); inputs.voice = n++; }
if (music && fs.existsSync(music)) { a.push('-stream_loop', '-1', '-t', String(len), '-i', music); inputs.music = n++; }
if (score) { a.push('-ss', String(from), '-t', String(len), '-i', score); inputs.score = n++; }
// Background layers (music file, score) are summed, then ducked under the voice with a sidechain compressor:
// the bed dips while someone is talking and comes back up in the gaps.
const bg = [];
if (inputs.music) bg.push(`[${inputs.music}:a]aformat=channel_layouts=stereo,volume=${mix.musicVolume ?? tl.musicVolume ?? 0.12}[mu]`);
if (inputs.score) bg.push(`[${inputs.score}:a]aformat=channel_layouts=stereo,volume=${mix.scoreVolume ?? 1}[sc]`);
const bgLabels = [inputs.music && '[mu]', inputs.score && '[sc]'].filter(Boolean);
let filter = null;
if (bgLabels.length) {
  const sum = bgLabels.length > 1 ? `${bgLabels.join('')}amix=inputs=${bgLabels.length}:duration=longest:normalize=0[bg0]` : `${bgLabels[0]}anull[bg0]`;
  if (inputs.voice) {
    const voiceChain = mix.duck === false
      ? [`[${inputs.voice}:a]aformat=channel_layouts=stereo[v]`, `[bg0]anull[bg]`]
      : [`[${inputs.voice}:a]aformat=channel_layouts=stereo,asplit=2[v][vsc]`, `[bg0][vsc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350:makeup=1[bg]`];
    filter = [...bg, sum, ...voiceChain, `[bg]${fadeOut}[bgf]`, `[v][bgf]amix=inputs=2:duration=first:normalize=0[a]`].join(';');
  } else filter = [...bg, sum, `[bg0]${fadeOut}[a]`].join(';');
}
const ai = !!inputs.voice;
if (filter) { a.push('-filter_complex', filter); maps.push('-map', '[a]'); }
else if (ai) maps.push('-map', `${inputs.voice}:a`);
a.push(...maps, '-c:v', 'copy');
if (ai || filter) a.push('-c:a', 'aac', '-b:a', '192k');
a.push('-t', String(to - from), '-movflags', '+faststart', outFile);
run(ff, a);

// Final loudness pass (two-pass loudnorm): the voice is normalised alone, so music, pauses and the end
// card pull the mix away from the target. Skipped for clips under 3 s, where the measurement is unreliable.
const target = tl.loudness ?? -14;
if ((ai || filter) && to - from >= 3) {
  const meas = spawnSync(ff, ['-hide_banner', '-nostats', '-i', outFile, '-vn', '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const j = JSON.parse(meas.slice(meas.lastIndexOf('{'), meas.lastIndexOf('}') + 1));
  const norm = path.join(tmp, 'norm.mp4');
  run(ff, ['-y', '-loglevel', 'error', '-i', outFile, '-c:v', 'copy', '-af',
    `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`,
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', norm]);
  fs.copyFileSync(norm, outFile);
  console.log(`  loudness ${(+j.input_i).toFixed(1)} → ${target} LUFS`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ ${path.relative(process.cwd(), outFile) || outFile}`);
