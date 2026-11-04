#!/usr/bin/env node
// Trim a source video into a reel's assets as a seek-friendly clip for <video data-clip>.
//   npm run clip -- <reel> <source-file> <from> <to> [name]
// Output: reels/<reel>/assets/<name>.mp4, H.264, no audio, max 1920 wide, 30 fps, a keyframe every
// 10 frames so renders can seek to any frame quickly. Use yt-dlp first for online sources you own.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, reelDir, ffmpegPath, run, die, mediaDuration } from './lib.mjs';

const args = parseArgs();
const [reel, src, from, to, name] = args._;
if (!reel || !src || from == null || to == null) die('Usage: npm run clip -- <reel> <source-file> <from> <to> [name]');
if (!fs.existsSync(src)) die(`no such file: ${src}`);
const a = parseFloat(from), b = parseFloat(to);
if (!(b > a)) die(`<to> (${to}) must be after <from> (${from})`);
const dir = reelDir(reel), out = path.join(dir, 'assets', `${name || path.basename(src).replace(/\.[^.]+$/, '') + '-' + a}.mp4`);
fs.mkdirSync(path.dirname(out), { recursive: true });
run(ffmpegPath(), ['-y', '-loglevel', 'error', '-ss', String(a), '-to', String(b), '-i', src, '-an',
  '-vf', "scale='min(1920,iw)':-2,fps=30,format=yuv420p", '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-g', '10',
  '-movflags', '+faststart', out]);
console.log(`✓ ${path.relative(dir, out)}  (${mediaDuration(out).toFixed(2)}s)  use: <video data-clip src="${path.relative(dir, out)}" data-from="0">`);
