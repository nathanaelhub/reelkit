#!/usr/bin/env node
// Get a rendered reel ready to post: a cover, caption files, a draft post, and checks against each platform.
//   npm run ship -- <reel>                     after npm run render; writes out/<reel>.ship/
//   npm run ship -- <reel> --video other.mp4 --out dir   check another file / write somewhere else
//   npm run ship -- <reel> --cover 3.2         the cover frame at 3.2 s (or "@word"); default: script.json "cover", else
//                                              the moment the first scene has fully landed
//
//   cover.jpg        1080×1920 frame, captions off (platforms let you pick or upload one)
//   safe-zones.jpg   the cover with the areas the apps cover with buttons and captions shaded (approximate)
//   captions.srt     what's said, timed to the word, in short lines (.vtt too) for platforms that take caption files
//   post.txt         a draft post: the hook and the credits (script.json "credits": ["Photo: …"], else footage links); edit it
//   checks.txt       the video measured against Instagram Reels, TikTok and YouTube Shorts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, reelDir, readJSON, openReel, ffmpegPath, ffprobePath, run, die, OUT, ROOT, TOOL_TIMEOUT } from './lib.mjs';

// ---------- captions ----------
// Short lines: a new line after 7 words, 3 seconds, the end of a sentence, a comma after 4 words, or a scene change.
export function captionLines(timeline) {
  const lines = [];
  for (const sc of timeline.scenes || []) {
    let cur = [];
    const flush = () => { if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(w => w.w).join(' ') }); cur = []; };
    for (const w of sc.words || []) {
      cur.push(w);
      const dur = w.end - cur[0].start;
      if (cur.length >= 7 || dur >= 3 || /[.!?]["')\]]*$/.test(w.w) || (cur.length >= 4 && /[,;:—]$/.test(w.w))) flush();
    }
    flush();
  }
  // no overlaps, and every line on screen for at least 0.7 s when there's room
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = Math.max(lines[i].end, Math.min(lines[i].start + 0.7, next ? next.start : Infinity));
    if (next && lines[i].end > next.start) lines[i].end = next.start;
  }
  return lines;
}
const stamp = (t, sep) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
export const toSRT = lines => lines.map((l, i) => `${i + 1}\n${stamp(l.start, ',')} --> ${stamp(l.end, ',')}\n${l.text}\n`).join('\n');
export const toVTT = lines => 'WEBVTT\n\n' + lines.map(l => `${stamp(l.start, '.')} --> ${stamp(l.end, '.')}\n${l.text}\n`).join('\n');

// ---------- checks ----------
// Limits as published by each platform (checked 2026-11; they change, so the report links where to confirm).
export const PLATFORMS = {
  'Instagram Reels': { maxSeconds: null, minShortSide: 720, minFps: 30, note: 'help.instagram.com/1038071743007909: 9:16 to 1.91:1, at least 720 px and 30 fps' },
  'TikTok': { maxSeconds: 3600, phoneMB: { Android: 72, iPhone: 287 }, note: 'uploads up to 60 min; the phone apps cap file size, tiktok.com takes larger files' },
  'YouTube Shorts': { maxSeconds: 180, vertical: true, note: 'support.google.com/youtube/answer/15424877: vertical or square, up to 3 minutes' },
};
export function probeVideo(file) {
  const j = JSON.parse(run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,sample_rate', '-of', 'json', file]));
  const v = j.streams.find(s => s.codec_type === 'video') || {}, a = j.streams.find(s => s.codec_type === 'audio') || null;
  const [n, d] = String(v.avg_frame_rate || '0/1').split('/').map(Number);
  const e = spawnSync(ffmpegPath(), ['-nostdin', '-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', timeout: TOOL_TIMEOUT, killSignal: 'SIGKILL' }).stderr || '';
  const lufs = a ? +((e.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/) || [])[1] ?? NaN) : null;
  return { seconds: +j.format.duration, mb: +j.format.size / 1e6, width: v.width, height: v.height, fps: d ? n / d : 0, vcodec: v.codec_name, pix: v.pix_fmt, acodec: a?.codec_name || null, lufs };
}
export function checkVideo(p) {
  const out = []; const add = (platform, level, msg) => out.push({ platform, level, msg });
  const ratio = p.width / p.height, vertical = p.height > p.width, square = Math.abs(ratio - 1) < 0.01;
  if (p.vcodec !== 'h264') add('all', 'warn', `video is ${p.vcodec}; H.264 is the safest everywhere`);
  if (p.pix !== 'yuv420p') add('all', 'warn', `pixel format ${p.pix}; yuv420p plays everywhere`);
  if (!p.acodec) add('all', 'warn', 'no sound track'); else if (p.acodec !== 'aac') add('all', 'warn', `audio is ${p.acodec}; AAC is the safest`);
  if (p.lufs != null && Number.isFinite(p.lufs) && Math.abs(p.lufs + 14) > 2) add('all', 'warn', `loudness ${p.lufs.toFixed(1)} LUFS; about −14 matches what the apps play at`);
  const ig = PLATFORMS['Instagram Reels'];
  if (Math.min(p.width, p.height) < ig.minShortSide) add('Instagram Reels', 'fail', `${p.width}×${p.height} is under ${ig.minShortSide} px`);
  if (p.fps < ig.minFps - 0.5) add('Instagram Reels', 'fail', `${p.fps.toFixed(1)} fps is under ${ig.minFps}`);
  if (ratio < 9 / 16 - 0.01 || ratio > 1.91 + 0.01) add('Instagram Reels', 'fail', `aspect ${p.width}:${p.height} is outside 9:16 to 1.91:1`);
  else if (!vertical) add('Instagram Reels', 'warn', 'not vertical: it will show letterboxed in the Reels tab');
  if (p.seconds > 180) add('Instagram Reels', 'warn', `${Math.round(p.seconds)} s: check Instagram's current Reels length limit`);
  const tt = PLATFORMS.TikTok;
  if (p.seconds > tt.maxSeconds) add('TikTok', 'fail', `${Math.round(p.seconds)} s is over 60 minutes`);
  for (const [phone, mb] of Object.entries(tt.phoneMB)) if (p.mb > mb) add('TikTok', 'warn', `${p.mb.toFixed(0)} MB is over the ${phone} app's ${mb} MB upload cap: upload from tiktok.com instead`);
  if (!vertical) add('TikTok', 'warn', 'not vertical: TikTok is built for 9:16');
  const yt = PLATFORMS['YouTube Shorts'];
  if (p.seconds > yt.maxSeconds) add('YouTube Shorts', 'fail', `${Math.round(p.seconds)} s is over 3 minutes: it won't count as a Short`);
  if (!vertical && !square) add('YouTube Shorts', 'fail', 'a Short must be vertical or square');
  return out;
}

// ---------- the draft post ----------
export function draftPost(script, timeline) {
  const hook = (script.scenes?.[0]?.say || '').trim();
  const credits = [...(script.credits || [])];
  if (!credits.length) for (const url of Object.values(script.sources || {})) credits.push(`Footage: ${url}`); // name it properly in "credits"
  return [
    hook || script.title || '',
    '',
    script.title && hook && !hook.toLowerCase().includes(script.title.toLowerCase()) ? script.title : null,
    credits.length ? `\nCredits:\n${credits.map(c => `· ${c}`).join('\n')}` : '\nCredits: add the source of any photo, footage or fact you used.',
  ].filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- cover and safe zones ----------
// Approximate areas the apps draw over (buttons on the right, name and caption at the bottom, header at the top),
// as fractions of a 9:16 frame; the union of Instagram, TikTok and Shorts, so inside the clear area is safe on all.
export const UI_ZONES = { top: 0.11, bottom: 0.2, right: 0.13 };
async function cover(dir, t, outDir) {
  const { page, close } = await openReel(dir, { scale: 1 });
  try {
    const at = await page.evaluate(async t => {
      const R = window.__reel; R.setCaptions(false);
      R.seek(t); await R.settle(); return t;
    }, t);
    const stage = await page.$('#stage');
    await stage.screenshot({ path: path.join(outDir, 'cover.jpg'), type: 'jpeg', quality: 92 });
    // the same frame with the UI areas shaded
    await page.evaluate(z => {
      const s = document.getElementById('stage'), W = s.offsetWidth, H = s.offsetHeight;
      const box = (css, label) => { const d = document.createElement('div'); d.className = 'ship-zone';
        d.style.cssText = `position:absolute;z-index:9999;background:rgba(214,36,110,.38);border:3px dashed #fff;font:600 26px system-ui;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;${css}`;
        d.textContent = label; s.appendChild(d); };
      box(`left:0;top:0;width:${W}px;height:${Math.round(H * z.top)}px`, 'app header');
      box(`left:0;bottom:0;width:${W}px;height:${Math.round(H * z.bottom)}px`, 'name, caption, music');
      box(`right:0;top:${Math.round(H * z.top)}px;width:${Math.round(W * z.right)}px;height:${Math.round(H * (1 - z.top - z.bottom))}px`, 'buttons');
    }, UI_ZONES);
    await stage.screenshot({ path: path.join(outDir, 'safe-zones.jpg'), type: 'jpeg', quality: 85 });
    return at;
  } finally { await close(); }
}
function coverTime(script, timeline, arg) {
  const want = arg ?? script.cover?.at ?? script.cover;
  if (want != null && want !== true) {
    if (typeof want === 'number' || /^[\d.]+$/.test(String(want))) return +want;
    const m = String(want).match(/^@(.+)$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      for (const sc of timeline.scenes) for (const w of sc.words) if (w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === key) return Math.min(sc.end - 0.05, w.end + 0.4);
      die(`cover: "${want}" is never said`);
    }
    die(`cover: use seconds (3.2) or a word ("@deep"), not "${want}"`);
  }
  // default: the end of the first scene, when everything timed to its words has landed (half a second after its last word)
  const s0 = timeline.scenes[0];
  return Math.max(s0.start, Math.min(s0.end - 0.15, Math.max(s0.start + 1.6, (s0.words.at(-1)?.end ?? s0.start) + 0.5)));
}

async function main() {
  const args = parseArgs();
  const dir = reelDir(args._[0]), name = path.basename(dir);
  const tp = path.join(dir, 'timeline.json'), video = path.resolve(args.video || path.join(OUT, `${name}.mp4`));
  if (!fs.existsSync(tp)) die(`No timeline.json: npm run voice -- ${name}`);
  if (!fs.existsSync(video)) die(`No final render at ${path.relative(ROOT, video)}: npm run render -- ${name} (not --draft)`);
  const timeline = readJSON(tp), script = readJSON(path.join(dir, 'script.json'));
  if (fs.statSync(video).mtimeMs < fs.statSync(tp).mtimeMs) console.warn(`⚠ ${path.basename(video)} is older than the voiceover: render again before posting`);
  const outDir = path.resolve(args.out || path.join(OUT, `${name}.ship`)); fs.mkdirSync(outDir, { recursive: true });

  const at = await cover(dir, coverTime(script, timeline, args.cover), outDir);
  const lines = captionLines(timeline);
  fs.writeFileSync(path.join(outDir, 'captions.srt'), toSRT(lines));
  fs.writeFileSync(path.join(outDir, 'captions.vtt'), toVTT(lines));
  fs.writeFileSync(path.join(outDir, 'post.txt'), draftPost(script, timeline));
  const p = probeVideo(video), checks = checkVideo(p);
  const report = [`${path.relative(ROOT, video)}: ${p.width}×${p.height}, ${p.fps.toFixed(0)} fps, ${p.seconds.toFixed(1)} s, ${p.mb.toFixed(1)} MB, ${p.vcodec}/${p.acodec || 'no audio'}${p.lufs != null && Number.isFinite(p.lufs) ? `, ${p.lufs.toFixed(1)} LUFS` : ''}`, ''];
  for (const plat of ['all', ...Object.keys(PLATFORMS)]) {
    const mine = checks.filter(c => c.platform === plat);
    if (plat === 'all') { mine.forEach(c => report.push(`⚠ ${c.msg}`)); continue; }
    const fail = mine.some(c => c.level === 'fail');
    report.push(`${fail ? '✗' : mine.length ? '⚠' : '✓'} ${plat}${mine.length ? '' : ': ready'}`);
    mine.forEach(c => report.push(`    ${c.level === 'fail' ? '✗' : '⚠'} ${c.msg}`));
    report.push(`    (${PLATFORMS[plat].note})`);
  }
  report.push('', 'Text inside the shaded areas of safe-zones.jpg may be covered by the app (the areas are approximate).');
  fs.writeFileSync(path.join(outDir, 'checks.txt'), report.join('\n') + '\n');

  console.log(`\n✓ ${path.relative(ROOT, outDir)}/`);
  console.log(`  cover.jpg       frame at ${at.toFixed(2)} s, captions off (change with --cover 3.2 or --cover @word)`);
  console.log(`  safe-zones.jpg  look at it: nothing important should sit in the shaded areas`);
  console.log(`  captions.srt    ${lines.length} lines (and .vtt)`);
  console.log(`  post.txt        a draft post: edit it, check the credits`);
  console.log(`  checks.txt\n\n  ${report.join('\n  ')}\n`);
  if (checks.some(c => c.level === 'fail')) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
