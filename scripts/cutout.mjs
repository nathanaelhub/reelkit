#!/usr/bin/env node
// Cut-outs for <img data-cutout="assets/photo.jpg">: BiRefNet lite (MIT), run locally through transformers.js, finds
// the subject of a photo and writes assets/photo.cutout.png (the subject on transparency) next to it. Put the photo,
// then a headline, then the cut-out on top, and the words sit behind the subject.
//   npm run cutout -- <reel>            photos that have no cut-out yet (or an older one than the photo)
//   npm run cutout -- <reel> --force    redo them all
// check, render and preview run this for you.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, reelDir, die, ROOT } from './lib.mjs';
import { MODELS } from './speech.mjs';

export const CUTOUT_MODEL = 'onnx-community/BiRefNet_lite-ONNX';

export function cutoutTargets(dir) {
  const html = path.join(dir, 'reel.html'); if (!fs.existsSync(html)) return [];
  const out = [];
  for (const m of fs.readFileSync(html, 'utf8').matchAll(/<img\b[^>]*\bdata-cutout="([^"]+)"[^>]*>/g)) {
    const photo = path.resolve(dir, m[1]), cut = photo.replace(/\.[a-z0-9]+$/i, '.cutout.png');
    if (!out.find(o => o.cut === cut)) out.push({ photo, cut });
  }
  return out;
}

let seg = null;
export async function makeCutout(photo, cut) {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers');
  if (!seg) { env.cacheDir = path.join(MODELS, 'transformers'); seg = await pipeline('background-removal', CUTOUT_MODEL, { dtype: 'fp32' }); }
  let out = await seg(await RawImage.read(photo));
  if (Array.isArray(out)) out = out[0];
  await out.save(cut);
}

export async function ensureCutouts(dir, { force = false, log = console.log } = {}) {
  const todo = cutoutTargets(dir).filter(t => force || !fs.existsSync(t.cut) || fs.statSync(t.cut).mtimeMs < fs.statSync(t.photo).mtimeMs);
  for (const t of todo) {
    if (!fs.existsSync(t.photo)) die(`cut-out photo not found: ${path.relative(ROOT, t.photo)}`);
    const t0 = Date.now();
    await makeCutout(t.photo, t.cut);
    log(`  cut-out: ${path.relative(ROOT, t.cut)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  return todo.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  const dir = reelDir(args._[0]);
  const n = await ensureCutouts(dir, { force: !!args.force });
  console.log(n ? `✓ ${n} cut-out${n > 1 ? 's' : ''}` : '✓ cut-outs up to date');
}
