#!/usr/bin/env node
// Add reference videos to a taste, measure them, and rebuild the taste's summary.
//   npm run ref -- <taste> <url-or-file> [more…]   download (yt-dlp) or copy, then measure
//   npm run ref -- <taste>                         re-measure everything already in refs/
//
// <taste> is a name (stored in taste/<name>/) or an absolute path to a folder elsewhere,
// e.g. a private brand folder. For each reference it writes, next to the video:
//   <ref>.metrics.json  length, aspect, fps, cut times, shot length, motion, loudness, palette
//   <ref>.sheet.jpg     12 evenly spaced frames, to look at
// then rebuilds taste.json (averages, read by `npm run check`) and the Measured block of
// taste.md. Anything written outside that block in taste.md is kept.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, parseArgs, die, which, ffmpegPath, ffprobePath, writeJSON, readJSON } from './lib.mjs';

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const CUT = 0.3;        // ffmpeg scene score above which a frame change counts as a cut
const MIN_SHOT = 0.25;  // ignore cuts closer together than this (flashes, strobes)

export function tasteDir(name) {
  if (!name) die('Usage: npm run ref -- <taste> [url-or-file …]');
  return path.isAbsolute(name) ? name : path.join(ROOT, 'taste', name);
}

function sh(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) throw r.error;
  return r;
}

function addSource(src, refs) {
  if (fs.existsSync(src)) {
    const dest = path.join(refs, path.basename(src).replace(/[^\w.-]+/g, '-'));
    if (path.resolve(src) !== dest) fs.copyFileSync(src, dest);
    return dest;
  }
  if (!/^https?:\/\//.test(src)) die(`not a file or a URL: ${src}`);
  if (!which('yt-dlp')) die('yt-dlp is not installed (brew install yt-dlp, or pip install yt-dlp)');
  console.log(`  ▸ downloading ${src}`);
  const r = sh('yt-dlp', ['--no-playlist', '-f', 'bv*[height<=1920]+ba/b', '--merge-output-format', 'mp4',
    '-o', path.join(refs, '%(extractor)s-%(id)s.%(ext)s'), '--print', 'after_move:filepath', '--no-simulate', src]);
  const file = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (r.status !== 0 || !file || !fs.existsSync(file)) die(`yt-dlp could not download ${src}:\n${(r.stderr || '').trim().slice(-800)}\n(Instagram and TikTok sometimes need --cookies-from-browser; or download it yourself and pass the file.)`);
  return file;
}

export function measure(file) {
  const ff = ffmpegPath(), fp = ffprobePath();
  if (!ff || !fp) die('ffmpeg/ffprobe not found. Run: npm run doctor -- --fix');
  const probe = JSON.parse(sh(fp, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout || '{}');
  const v = (probe.streams || []).find(s => s.codec_type === 'video');
  if (!v) die(`no video stream in ${file}`);
  const hasAudio = (probe.streams || []).some(s => s.codec_type === 'audio');
  const duration = parseFloat(probe.format.duration);
  const [fn, fd] = (v.avg_frame_rate || '30/1').split('/').map(Number);
  // rotation metadata (phone video) swaps width and height
  const rot = Math.abs(parseInt((v.side_data_list || []).find(s => s.rotation != null)?.rotation || v.tags?.rotate || 0, 10)) % 180 === 90;
  const width = rot ? v.height : v.width, height = rot ? v.width : v.height;

  // One pass: a scene-change score for every frame. Cuts = spikes; motion = the average.
  const sc = sh(ff, ['-hide_banner', '-i', file, '-an', '-vf', "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", '-f', 'null', '-']).stderr;
  const scores = []; let t = 0;
  for (const line of sc.split('\n')) {
    const mt = line.match(/pts_time:([\d.]+)/); if (mt) t = +mt[1];
    const ms = line.match(/lavfi\.scene_score=([\d.]+)/); if (ms) scores.push([t, +ms[1]]);
  }
  const cuts = [];
  for (const [ts, s] of scores) if (s > CUT && ts > MIN_SHOT && ts < duration - MIN_SHOT && (!cuts.length || ts - cuts[cuts.length - 1] >= MIN_SHOT)) cuts.push(+ts.toFixed(2));
  const shots = cuts.length + 1;
  const bounds = [0, ...cuts, duration];
  const lens = bounds.slice(1).map((b, i) => b - bounds[i]).sort((a, b) => a - b);
  const within = scores.filter(([, s]) => s <= CUT); // movement inside shots; cuts are counted separately
  const motion = within.length ? within.reduce((a, [, s]) => a + s, 0) / within.length : 0;

  // Motion beats: animated pieces often never cut; their rhythm is bursts of movement between
  // holds. Average the in-shot motion over half-second bins; a beat starts where a bin rises
  // past a threshold (2x the median bin, at least 0.0008) after being below it.
  const BIN = 0.5, nb = Math.max(1, Math.ceil(duration / BIN)), bins = new Array(nb).fill(0), cnt = new Array(nb).fill(0);
  for (const [ts, s] of scores) { const i = Math.min(nb - 1, Math.floor(ts / BIN)); cnt[i]++; if (s <= CUT) bins[i] += s; }
  for (let i = 0; i < nb; i++) bins[i] = cnt[i] ? bins[i] / cnt[i] : 0;
  const med = [...bins].sort((a, b) => a - b)[Math.floor(nb / 2)];
  const thr = Math.max(0.0008, med * 2);
  const beats = [];
  for (let i = 0; i < nb; i++) if (bins[i] >= thr && (i === 0 || bins[i - 1] < thr) && (!beats.length || i * BIN - beats[beats.length - 1] >= 1)) beats.push(+(i * BIN).toFixed(1));
  const stillShare = bins.filter(b => b < thr).length / nb;
  const avgShot = duration / shots, avgBeat = beats.length ? duration / beats.length : duration;

  let lufs = null;
  if (hasAudio) {
    const m = sh(ff, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-']).stderr.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
    if (m) lufs = +m[1];
  }

  // Dominant colours: palettegen writes the palette first, then repeats the last entry.
  const pal = sh(ff, ['-loglevel', 'error', '-i', file, '-vf', 'fps=1,scale=160:-2,palettegen=max_colors=6:stats_mode=full:reserve_transparent=0',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
  const palette = [];
  for (let i = 0; i + 2 < pal.length && palette.length < 6; i += 3) {
    const hex = '#' + [pal[i], pal[i + 1], pal[i + 2]].map(x => x.toString(16).padStart(2, '0')).join('');
    if (!palette.includes(hex)) palette.push(hex);
  }

  const sheet = file.replace(VIDEO, '.sheet.jpg');
  const tileW = width >= height ? 360 : 240;
  sh(ff, ['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=${(12 / duration).toFixed(5)},scale=${tileW}:-2,tile=6x2:padding=6:color=0x222222`, '-frames:v', '1', '-q:v', '3', sheet]);

  return {
    file: path.basename(file), duration: +duration.toFixed(2), width, height,
    aspect: width > height * 1.2 ? '16:9-ish (horizontal)' : height > width * 1.2 ? '9:16-ish (vertical)' : 'square-ish',
    fps: +(fn / (fd || 1)).toFixed(2), cuts, shots,
    avgShot: +avgShot.toFixed(2), medianShot: +lens[Math.floor(lens.length / 2)].toFixed(2),
    cutsPerSec: +(cuts.length / duration).toFixed(2), motion: +motion.toFixed(4),
    beats, avgBeat: +avgBeat.toFixed(2), stillShare: +stillShare.toFixed(2),
    pace: +Math.min(avgShot, avgBeat).toFixed(2), // something new (a cut or a motion beat) every N seconds
    lufs, palette,
    sheet: path.basename(sheet), sheetTimes: Array.from({ length: 12 }, (_, i) => +((i + 0.5) * duration / 12).toFixed(1)),
  };
}

const START = '<!-- measured:start (rebuilt by npm run ref; edit outside this block) -->', END = '<!-- measured:end -->';
const TEMPLATE = name => `# Taste: ${name}

What these references have in common, and how reels for this taste should feel. Inspired by, never copied:
don't reuse their footage, music, wording, logos or exact layouts.

${START}
${END}

## Notes (written after looking at the contact sheets)

- **Pacing:** how often things change, how long text stays up, where the energy peaks
- **Captions and type:** fonts, weight, case, size, placement, how words appear
- **Colour:** background, accent, how photos/footage are treated
- **Motion:** what moves, how (springy, smooth, snappy), camera moves, transitions
- **Sound:** music feel, voice or not, sound effects on hits
- **Do:**
- **Don't:**
`;

export function summarize(dir) {
  const refs = path.join(dir, 'refs');
  const ms = fs.existsSync(refs) ? fs.readdirSync(refs).filter(f => f.endsWith('.metrics.json')).sort().map(f => readJSON(path.join(refs, f))) : [];
  if (!ms.length) die(`no measured references in ${refs}`);
  const avg = (k, d = 2) => { const xs = ms.map(m => m[k]).filter(x => typeof x === 'number'); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(d) : null; };
  const summary = { refs: ms.length, pace: avg('pace'), avgShot: avg('avgShot'), medianShot: avg('medianShot'), cutsPerSec: avg('cutsPerSec'),
    avgBeat: avg('avgBeat'), stillShare: avg('stillShare'), motion: avg('motion', 4), lufs: avg('lufs', 1),
    sheets: ms.map(m => path.join('refs', m.sheet)) };
  writeJSON(path.join(dir, 'taste.json'), summary);

  const rows = ms.map(m => `| ${m.file} | ${m.duration}s | ${m.width}x${m.height} | ${m.shots} | ${m.avgShot}s | ${m.beats.length} | ${m.avgBeat}s | ${Math.round(m.stillShare * 100)}% | ${m.motion} | ${m.lufs ?? 'no audio'} | ${m.palette.join(' ')} |`);
  const block = `${START}
## Measured (${ms.length} reference${ms.length > 1 ? 's' : ''})

Something new every **${summary.pace}s** on average (a hard cut every ${summary.avgShot}s, a motion beat every ${summary.avgBeat}s). Still ${Math.round((summary.stillShare ?? 0) * 100)}% of the time, motion ${summary.motion}, loudness ${summary.lufs ?? 'n/a'} LUFS.
Shots are separated by hard cuts. Beats are bursts of movement after a hold (animated pieces often never cut). Still = share of half-seconds with almost no movement. Motion is the mean frame-to-frame change inside shots (0 = still, ~0.002 = gentle animation, 0.02+ = constant movement).

| reference | length | size | shots | avg shot | beats | avg beat | still | motion | LUFS | palette |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Contact sheets (look at these): ${summary.sheets.map(s => '`' + s + '`').join(', ')}
${END}`;
  const md = path.join(dir, 'taste.md');
  let text = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : TEMPLATE(path.basename(dir));
  if (!text.includes(START)) text = text.trimEnd() + '\n\n' + START + '\n' + END + '\n';
  text = text.replace(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END), block);
  fs.writeFileSync(md, text);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const dir = tasteDir(args._[0]);
  const refs = path.join(dir, 'refs'); fs.mkdirSync(refs, { recursive: true });
  const added = args._.slice(1).map(s => addSource(s, refs));
  const todo = added.length ? added : fs.readdirSync(refs).filter(f => VIDEO.test(f)).map(f => path.join(refs, f));
  if (!todo.length) die(`no reference videos in ${refs}. Pass a URL or a file.`);
  for (const f of todo) {
    const m = measure(f);
    writeJSON(f.replace(VIDEO, '.metrics.json'), m);
    console.log(`  ✓ ${m.file}: ${m.duration}s ${m.width}x${m.height}, ${m.shots} shots (avg ${m.avgShot}s), ${m.beats.length} beats, motion ${m.motion}, ${m.lufs ?? 'no audio'}${m.lufs != null ? ' LUFS' : ''}`);
  }
  const s = summarize(dir);
  console.log(`\n▸ taste ${path.basename(dir)}: ${s.refs} refs, something new every ${s.pace}s (cuts every ${s.avgShot}s, beats every ${s.avgBeat}s), still ${Math.round((s.stillShare ?? 0) * 100)}%, ${s.lufs ?? 'n/a'} LUFS`);
  console.log(`  ${path.relative(process.cwd(), path.join(dir, 'taste.md')) || path.join(dir, 'taste.md')}`);
  console.log(`  look at: ${s.sheets.map(x => path.join(path.relative(process.cwd(), dir) || dir, x)).join(', ')}\n`);
}
