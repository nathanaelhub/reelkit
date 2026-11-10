#!/usr/bin/env node
// Depth maps for depth photos (<canvas data-depth="assets/photo.jpg">): Depth Anything V2 Small (Apache-2.0), run
// locally through transformers.js. Writes assets/photo.depth.png next to each photo (white = near, black = far).
//   npm run depth -- <reel>            every data-depth photo in reel.html that has no map yet (or a stale one)
//   npm run depth -- <reel> --force    redo them all
// check, render and preview run this for you.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, reelDir, ffmpegPath, run, die, ROOT } from './lib.mjs';
import { MODELS } from './speech.mjs';

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

export function depthTargets(dir) {
  const html = path.join(dir, 'reel.html'); if (!fs.existsSync(html)) return [];
  const src = fs.readFileSync(html, 'utf8'), out = [];
  for (const m of src.matchAll(/<canvas\b[^>]*\bdata-depth="([^"]+)"[^>]*>/g)) {
    const mapAttr = m[0].match(/\bdata-depth-map="([^"]+)"/);
    const photo = path.resolve(dir, m[1]), map = path.resolve(dir, mapAttr ? mapAttr[1] : m[1].replace(/\.[a-z0-9]+$/i, '.depth.png'));
    if (!out.find(o => o.map === map)) out.push({ photo, map, generated: !mapAttr });
  }
  return out;
}

let est = null;
export async function makeDepthMap(photo, map) {
  if (!est) {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(MODELS, 'transformers');
    est = await pipeline('depth-estimation', DEPTH_MODEL, { dtype: 'fp32' });
  }
  const { RawImage } = await import('@huggingface/transformers');
  const { depth } = await est(await RawImage.read(photo));
  const raw = map.replace(/\.png$/, '.raw.png');
  await depth.save(raw);
  // a slight blur keeps edges from tearing when the camera moves
  run(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'gblur=sigma=2,format=gray', map]);
  fs.rmSync(raw);
}

export async function ensureDepthMaps(dir, { force = false, log = console.log } = {}) {
  const todo = depthTargets(dir).filter(t => t.generated && (force || !fs.existsSync(t.map) || fs.statSync(t.map).mtimeMs < fs.statSync(t.photo).mtimeMs));
  for (const t of todo) {
    if (!fs.existsSync(t.photo)) die(`depth photo not found: ${path.relative(ROOT, t.photo)}`);
    const t0 = Date.now();
    await makeDepthMap(t.photo, t.map);
    log(`  depth map: ${path.relative(ROOT, t.map)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  return todo.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  const dir = reelDir(args._[0]);
  const n = await ensureDepthMaps(dir, { force: !!args.force });
  console.log(n ? `✓ ${n} depth map${n > 1 ? 's' : ''}` : '✓ depth maps up to date');
}
