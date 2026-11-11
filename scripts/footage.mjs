#!/usr/bin/env node
// Bring your own footage: find its shots and what is said in it, and turn speech into reel scenes.
//
//   npm run footage -- <reel> <video>            scan: copy it into reels/<reel>/footage/ as a seek-friendly MP4, find
//                                                the shot cuts (FFmpeg scene detection) and every spoken word (Whisper),
//                                                write footage/<name>.json and a contact sheet of the shots to out/
//   npm run footage -- <reel> https://…/clip.mp4  the same from a direct link; script.json "sources" remembers it, so a
//                                                fresh clone downloads it again when it voices or renders
//   npm run footage -- <reel> <video> --talk     also write script.json scenes from what is said: one scene per
//                                                sentence, with the pauses, "um"s and dead air between words cut out
//      --from 12 --to 70     only the sentences that start in this part of the video
//      --gap 0.35            cut silences longer than this (seconds) inside a sentence
//      --name talk           name the copy footage/talk.mp4
//      --keep                add the scenes after the existing ones instead of replacing them
//
// A talk scene in script.json looks like
//   { "id": "s03", "say": "what they said", "footage": { "src": "footage/talk.mp4", "cut": [[12.3, 15.8], [16.2, 18.05]] } }
// npm run voice cuts that audio as the voiceover and writes assets/s03.talk.mp4 with the same cuts for
// <video data-clip src="assets/s03.talk.mp4" data-reframe="face">. Delete or reorder scenes to edit the talk;
// fix a mis-heard word by editing "say" (it only changes the caption).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, reelDir, readJSON, writeJSON, ffmpegPath, ffprobePath, run, die, ROOT, OUT } from './lib.mjs';
import { transcribeWords } from './speech.mjs';

// ---------- probing ----------
export function probe(file) {
  const j = JSON.parse(run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate,duration', '-of', 'json', file]));
  const v = (j.streams || []).find(s => s.codec_type === 'video'), a = (j.streams || []).find(s => s.codec_type === 'audio');
  const [n, d] = (v?.avg_frame_rate || '30/1').split('/').map(Number);
  // the picture can end before the sound: cuts must stay inside the picture
  const duration = Math.min(+j.format.duration, +(v?.duration || Infinity));
  return { duration, width: v?.width || 0, height: v?.height || 0, fps: d ? n / d : 30, audio: !!a, video: !!v };
}

// Shot cuts: FFmpeg's scene score (showinfo logs each detected cut), with cuts closer than minShot merged
// (flashes and dissolves fire twice).
export function findCuts(file, { threshold = 0.3, minShot = 0.5 } = {}) {
  const log = spawnSync(ffmpegPath(), ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
  return parseCuts(log, minShot);
}
export function parseCuts(log, minShot = 0.5) {
  const cuts = [];
  for (const m of String(log).matchAll(/pts_time:([\d.]+)/g)) {
    const t = +m[1];
    if (!cuts.length || t - cuts[cuts.length - 1] >= minShot) cuts.push(+t.toFixed(3));
  }
  return cuts;
}
// Silences in the sound (FFmpeg silencedetect). Whisper's word times stretch across pauses, so the pauses come from
// the audio itself. Music under the speech fills them, which is right: cutting there would chop the music.
export function findSilences(file, { noise = -35, min = 0.3 } = {}) {
  const log = spawnSync(ffmpegPath(), ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
  const out = []; let start = null;
  for (const m of String(log).matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, +m[2]); else if (start != null) { out.push([+start.toFixed(3), +(+m[2]).toFixed(3)]); start = null; }
  }
  return out;
}

// ---------- speech → scenes ----------
// Sentences from Whisper words: split after . ? ! and merge any shorter than minLen into the next one.
export function sentences(words, { minLen = 1.4 } = {}) {
  const out = []; let cur = [];
  for (const w of words) {
    cur.push(w);
    if (/[.?!]["')\]]*$/.test(w.w)) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  const merged = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev[prev.length - 1].end - prev[0].start < minLen) prev.push(...s);
    else merged.push(s);
  }
  // a short tail joins the sentence before it
  if (merged.length > 1) { const last = merged[merged.length - 1]; if (last[last.length - 1].end - last[0].start < minLen) merged[merged.length - 2].push(...merged.pop()); }
  return merged;
}

// The parts of a sentence to keep: word spans, joined across gaps shorter than `gap`, padded so consonants aren't
// clipped. Longer gaps (pauses, "um"s Whisper leaves out) are cut.
export function keepRanges(words, { gap = 0.35, pad = 0.08, duration = Infinity, silences = [] } = {}) {
  let r = [];
  for (const w of words) {
    const a = Math.max(0, w.start - pad), b = Math.min(duration, w.end + pad);
    const last = r[r.length - 1];
    if (last && a - last[1] < gap - 2 * pad) last[1] = Math.max(last[1], b);
    else if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else r.push([a, b]);
  }
  // then take out every silence longer than `gap`, keeping `pad` of it on each side so words aren't clipped. A
  // "silence" that a word starts inside is the detector being wrong (quiet speech), not Whisper, so it stays.
  const words0 = r;
  for (const [s0, s1] of silences) {
    if (s1 - s0 < gap) continue;
    const a = s0 + pad, b = s1 - pad;
    if (words.some(w => w.start > a && w.start < b)) continue;
    r = r.flatMap(([x, y]) => (b <= x || a >= y) ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([p, q]) => q - p >= 0.1));
  }
  if (!r.length) r = words0; // never cut a sentence down to nothing
  return r.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]);
}

export const cutLength = cut => cut.reduce((s, [a, b]) => s + b - a, 0);

// ---------- getting footage in ----------
// Every source becomes H.264 at 30 fps, at most 1920 wide, a keyframe every 10 frames (fast exact seeks), AAC sound.
export function normalize(input, out) {
  const info = probe(input);
  if (!info.video) die(`${input} has no video stream`);
  process.stdout.write(`▸ copying into ${path.relative(ROOT, out)} (H.264, keyframe every 10 frames) …`);
  run(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', input, '-vf', "scale='min(1920,iw)':-2,fps=30,format=yuv420p", '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-g', '10',
    ...(info.audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']), '-movflags', '+faststart', out]);
  console.log(' done');
}
// A direct link to a video file (for a page like YouTube, download it with yt-dlp first — only footage you may use).
export async function fetchFootage(url, out) {
  process.stdout.write(`▸ downloading ${url.length > 90 ? url.slice(0, 87) + '…' : url} …`);
  const r = await fetch(url, { headers: { 'User-Agent': 'reelkit (https://github.com/nathanaelhub/reelkit)' }, redirect: 'follow' });
  if (!r.ok) die(`download failed: HTTP ${r.status}`);
  if (/^text\/html/.test(r.headers.get('content-type') || '')) die('that link is a web page, not a video file. For YouTube and similar sites use yt-dlp first, then pass the file.');
  const tmp = path.join(path.dirname(out), `.download-${path.basename(out)}`);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  console.log(` ${(fs.statSync(tmp).size / 1e6).toFixed(1)} MB`);
  try { normalize(tmp, out); } finally { fs.rmSync(tmp, { force: true }); }
}
// Footage that script.json lists under "sources" but isn't on disk (a fresh clone): download it again.
export async function ensureFootage(dir) {
  const sp = path.join(dir, 'script.json'); if (!fs.existsSync(sp)) return 0;
  const { sources = {} } = readJSON(sp); let n = 0;
  for (const [rel, url] of Object.entries(sources)) {
    const f = path.resolve(dir, rel);
    if (fs.existsSync(f)) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await fetchFootage(url, f); n++;
  }
  return n;
}

// ---------- talk scenes: cut a scene's speech (audio) and picture (assets/<id>.talk.mp4) out of its footage ----------
// Cut points snap to the 30 fps frame grid so picture and sound stay in sync however many cuts a scene has.
const FOOT_FPS = 30;
export function talkSource(dir, s) {
  const src = path.resolve(dir, s.footage?.src || '');
  if (!s.footage?.src || !fs.existsSync(src)) die(`scene "${s.id}": footage "${s.footage?.src}" not found (paths are relative to the reel folder)`);
  if (!Array.isArray(s.footage.cut) || !s.footage.cut.length) die(`scene "${s.id}": footage needs "cut": [[from, to], …]`);
  return src;
}
export const talkClipPath = (dir, s) => path.join(dir, 'assets', `${s.id}.talk.mp4`);
export function cutTalk(dir, s, wav = null) {
  const src = talkSource(dir, s), video = talkClipPath(dir, s), fade = 0.012;
  const cut = s.footage.cut.map(([a, b]) => [Math.round(a * FOOT_FPS) / FOOT_FPS, Math.round(b * FOOT_FPS) / FOOT_FPS]).filter(([a, b]) => b - a >= 2 / FOOT_FPS);
  if (!cut.length) die(`scene "${s.id}": every cut is shorter than two frames`);
  const hasAudio = wav && probe(src).audio;
  if (wav && !hasAudio) die(`scene "${s.id}": ${s.footage.src} has no sound to use as the voice`);
  const f = cut.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(4)}:end=${b.toFixed(4)},setpts=PTS-STARTPTS[v${i}]` + (hasAudio ? ';' +
    `[0:a]atrim=start=${a.toFixed(4)}:end=${b.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${(b - a - fade).toFixed(4)}:d=${fade}[a${i}]` : '')).join(';') +
    `;${cut.map((_, i) => `[v${i}]` + (hasAudio ? `[a${i}]` : '')).join('')}concat=n=${cut.length}:v=1:a=${hasAudio ? 1 : 0}[vc]${hasAudio ? '[a]' : ''};[vc]fps=${FOOT_FPS},scale='min(1920,iw)':-2,format=yuv420p[v]`;
  fs.mkdirSync(path.dirname(video), { recursive: true });
  run(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', f,
    ...(hasAudio ? ['-map', '[a]', '-ar', '44100', '-ac', '1', wav] : []),
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-g', '10', '-movflags', '+faststart', video]);
  return video;
}
// check / render / preview: recut any talk clip that is missing (they are build products, not committed)
export async function ensureTalkClips(dir, { log = console.log } = {}) {
  const sp = path.join(dir, 'script.json'); if (!fs.existsSync(sp)) return 0;
  await ensureFootage(dir);
  let n = 0;
  for (const s of readJSON(sp).scenes || []) {
    if (!s.footage || fs.existsSync(talkClipPath(dir, s))) continue;
    cutTalk(dir, s); n++;
    log(`  talk clip: ${path.relative(ROOT, talkClipPath(dir, s))}`);
  }
  return n;
}

// ---------- contact sheet: the middle frame of every shot, labelled with its time ----------
async function shotSheet(src, shots, out) {
  const tmp = fs.mkdtempSync(path.join(OUT, '.shots-'));
  try {
    const imgs = shots.map(([a, b], i) => {
      const f = path.join(tmp, `${i}.jpg`);
      run(ffmpegPath(), ['-y', '-loglevel', 'error', '-ss', String((a + b) / 2), '-i', src, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', f]);
      return `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
    });
    const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    const cells = shots.map(([a, b], i) => `<figure><img src="${imgs[i]}"><figcaption><b>${i + 1}</b> ${fmt(a)} – ${fmt(b)}</figcaption></figure>`).join('');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1520, height: 400 } });
    await page.setContent(`<style>body{margin:0;background:#111;color:#eee;font:15px system-ui;display:grid;grid-template-columns:repeat(4,370px);gap:10px;padding:10px}
      figure{margin:0}img{width:370px;display:block;border-radius:4px}figcaption{padding:4px 2px}b{color:#ffcc33}</style>${cells}`);
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- main ----------
async function main() {
  const args = parseArgs();
  const [reel, srcArg] = args._;
  if (!reel || !srcArg) die('Usage: npm run footage -- <reel> <video file or link> [--name n] [--talk] [--from s] [--to s] [--gap 0.35] [--keep]');
  const dir = reelDir(reel);
  const ff = ffmpegPath(); if (!ff) die('ffmpeg not found. Run: npm run doctor -- --fix');

  // 1. a seek-friendly copy inside the reel (skipped if the source already is one); a link is downloaded first and
  //    remembered in script.json "sources", so a fresh clone can fetch it again (see ensureFootage)
  const isURL = /^https?:\/\//i.test(srcArg);
  const local = isURL ? null : [path.resolve(srcArg), path.resolve(dir, srcArg)].find(f => fs.existsSync(f));
  if (!isURL && !local) die(`no such file: ${srcArg}`);
  const fdir = path.join(dir, 'footage'); fs.mkdirSync(fdir, { recursive: true });
  const base = isURL ? decodeURIComponent(new URL(srcArg).pathname.split('/').pop() || '') : path.basename(local);
  const name = String(args.name || base.replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'footage';
  let src = local;
  if (isURL || path.dirname(local) !== fdir) {
    src = path.join(fdir, `${name}.mp4`);
    if (isURL) {
      await fetchFootage(srcArg, src);
      const sp = path.join(dir, 'script.json'), script = fs.existsSync(sp) ? readJSON(sp) : {};
      script.sources = { ...(script.sources || {}), [`footage/${name}.mp4`]: srcArg };
      writeJSON(sp, script);
    } else if (!fs.existsSync(src) || fs.statSync(src).mtimeMs < fs.statSync(local).mtimeMs) normalize(local, src);
  }
  const info = probe(src);
  const rel = path.relative(dir, src).split(path.sep).join('/');

  // 2. shots
  const cuts = findCuts(src, { threshold: args.threshold || 0.3 });
  const bounds = [0, ...cuts, info.duration];
  const shots = bounds.slice(1).map((b, i) => [bounds[i], b]).filter(([a, b]) => b - a > 0.05);

  // 3. speech
  let words = [];
  if (info.audio) {
    process.stdout.write('▸ listening (Whisper) …');
    const raw = path.join(fdir, `.${name}.16k.f32`);
    run(ff, ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ar', '16000', '-ac', '1', '-f', 'f32le', raw]);
    const buf = fs.readFileSync(raw); fs.rmSync(raw);
    // Whisper invents words in silence and can place them past the end; keep only words inside the video
    words = (await transcribeWords(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)))
      .filter(w => w.start < info.duration - 0.05).map(w => ({ w: w.w, start: +w.start.toFixed(3), end: +Math.min(w.end, info.duration).toFixed(3) }));
    console.log(` ${words.length} words`);
  }
  const silences = info.audio ? findSilences(src) : [];
  const meta = { src: rel, ...info, cuts, shots, silences, words };
  writeJSON(path.join(fdir, `${name}.json`), meta);

  fs.mkdirSync(OUT, { recursive: true });
  const sheet = path.join(OUT, `${path.basename(dir)}-footage-${name}.png`);
  await shotSheet(src, shots, sheet);

  const fmt = t => t.toFixed(1).padStart(6);
  console.log(`\n✓ ${rel}: ${info.duration.toFixed(1)}s, ${info.width}×${info.height}, ${shots.length} shots, ${words.length} words`);
  console.log(`  shots: ${shots.map(([a, b], i) => `${i + 1} ${a.toFixed(1)}–${b.toFixed(1)}`).join(' · ')}`);
  console.log(`  contact sheet (look at it): ${path.relative(ROOT, sheet)}`);
  console.log(`  details: ${path.relative(ROOT, path.join(fdir, name + '.json'))}`);

  if (!args.talk) {
    if (words.length) console.log(`\n  said: ${sentences(words).map(s => `[${s[0].start.toFixed(1)}] ${s.map(w => w.w).join(' ')}`).join('\n        ')}`);
    console.log(`\n  next: npm run footage -- ${path.basename(dir)} ${rel} --talk   (scenes from the speech)\n        or npm run clip -- ${path.basename(dir)} ${rel} <from> <to>   (a silent clip of one shot)`);
    return;
  }

  // 4. talk → scenes
  if (!words.length) die('no speech found, so there is nothing to make talk scenes from');
  const from = args.from != null ? +args.from : 0, to = args.to != null ? +args.to : Infinity;
  // whole sentences that start inside the range, so a sentence is never cut off mid-way
  const picked = sentences(words).filter(s => s[0].start >= from - 0.05 && s[0].start < to);
  const used = picked.flat();
  const gap = args.gap != null ? +args.gap : 0.35;
  const sp = path.join(dir, 'script.json');
  const script = fs.existsSync(sp) ? readJSON(sp) : { title: path.basename(dir) };
  const existing = args.keep ? (script.scenes || []) : [];
  const taken = new Set(existing.map(s => s.id));
  let n = 1; const nextId = () => { while (taken.has(`s${String(n).padStart(2, '0')}`)) n++; const id = `s${String(n).padStart(2, '0')}`; taken.add(id); return id; };
  const scenes = picked.map(s => {
    const cut = keepRanges(s, { gap, duration: info.duration, silences });
    return { id: nextId(), say: s.map(w => w.w).join(' '), footage: { src: rel, cut } };
  });
  script.scenes = [...existing, ...scenes];
  script.voice = { ...(script.voice || {}) };
  writeJSON(sp, script);
  const before = (used.at(-1)?.end ?? 0) - (used[0]?.start ?? 0), after = scenes.reduce((s, x) => s + cutLength(x.footage.cut), 0);
  console.log(`\n✓ script.json: ${scenes.length} talk scenes, ${before.toFixed(1)}s of speech cut to ${after.toFixed(1)}s`);
  scenes.forEach(s => console.log(`  ${s.id}  ${cutLength(s.footage.cut).toFixed(1).padStart(5)}s  ${s.footage.cut.length > 1 ? `(${s.footage.cut.length - 1} cut${s.footage.cut.length > 2 ? 's' : ''}) ` : ''}${s.say}`));
  console.log(`\n  next: delete the scenes you don't want, then npm run voice -- ${path.basename(dir)}\n  each scene gets assets/<id>.talk.mp4: <video data-clip src="assets/<id>.talk.mp4" data-reframe="face">`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
