#!/usr/bin/env node
// Live preview in your browser with audio, scrubbing, and arrow-key frame stepping.
//   npm run preview -- <reel> [--style <pack>]
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, reelDir, serve, reelURL, checkStyle } from './lib.mjs';
import { ensureDepthMaps } from './depth.mjs';
import { ensureCutouts } from './cutout.mjs';
import { ensureFaceTracks } from './faces.mjs';
import { ensureTalkClips } from './footage.mjs';

const args = parseArgs();
const dir = reelDir(args._[0]);
await ensureDepthMaps(dir);
await ensureCutouts(dir);
await ensureTalkClips(dir);
await ensureFaceTracks(dir);
const server = await serve(+(args.port || 4321)).catch(() => serve(0));
const style = checkStyle(args.style || null);
const url = reelURL(server, dir, style ? `?style=${style}` : '');
console.log(`\n▸ previewing ${path.basename(dir)}\n  ${url}\n  space = play/pause, ←/→ = frame step (shift = 1s), cc = toggle captions\n  Ctrl+C to stop\n`);
if (!args['no-open']) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch {}
}
