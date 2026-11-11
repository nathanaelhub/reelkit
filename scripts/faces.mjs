#!/usr/bin/env node
// Face tracks for <video data-clip … data-reframe="face">: MediaPipe BlazeFace (Apache-2.0) finds the speaker in each
// clip, locally in headless Chromium, and writes <clip>.faces.json next to it. kit.js crops the clip to keep that face
// in frame, so a 16:9 interview becomes a 9:16 reel without a lost face.
//   npm run faces -- <reel>            clips that have no track yet (or an older one than the clip)
//   npm run faces -- <reel> --force    redo them all
// check, render and preview run this for you.
//
// The camera behaves like an operator's: a shot where the face barely moves gets one fixed crop; a moving face is
// followed smoothly; a shot with no face is centred; and the crop jumps at a cut instead of gliding across it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, reelDir, die, serve, ROOT } from './lib.mjs';
import { MODELS } from './speech.mjs';
import { findCuts } from './footage.mjs';

export const FACE_MODEL = path.join(MODELS, 'blaze_face_short_range.tflite');
export const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
export const faceModelInstalled = () => fs.existsSync(FACE_MODEL) && fs.statSync(FACE_MODEL).size > 100000;
export async function installFaceModel(log = console.log) {
  if (faceModelInstalled()) return;
  fs.mkdirSync(MODELS, { recursive: true });
  log('  downloading the face detector (BlazeFace, 230 KB) …');
  const r = await fetch(FACE_MODEL_URL);
  if (!r.ok) throw new Error(`face model download failed: ${r.status}`);
  fs.writeFileSync(FACE_MODEL, Buffer.from(await r.arrayBuffer()));
}

export function faceTargets(dir) {
  const html = path.join(dir, 'reel.html'); if (!fs.existsSync(html)) return [];
  const out = [];
  for (const m of fs.readFileSync(html, 'utf8').matchAll(/<video\b[^>]*>/g)) {
    if (!/\bdata-reframe="face"/.test(m[0]) || !/\bdata-clip\b/.test(m[0])) continue;
    const src = m[0].match(/\bsrc="([^"]+)"/)?.[1]; if (!src) continue;
    const own = m[0].match(/\bdata-faces="([^"]+)"/)?.[1];
    const clip = path.resolve(dir, src), track = path.resolve(dir, own || src.replace(/\.[a-z0-9]+$/i, '.faces.json'));
    if (!out.find(o => o.track === track)) out.push({ clip, track, generated: !own });
  }
  return out;
}

// ---------- samples → an operator's track ----------
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
// pick the speaker in each sample: the biggest confident face, preferring one near the previous pick
export function primaryFaces(samples) {
  let prev = null;
  return samples.map(([t, faces]) => {
    if (!faces.length) return [t, null];
    const score = f => f[2] * f[3] - (prev ? 0.5 * Math.abs(f[0] - prev[0]) * f[2] : 0);
    const f = faces.reduce((a, b) => (score(b) > score(a) ? b : a));
    prev = f; return [t, f];
  });
}
export function buildTrack(samples, cuts, duration, { still = 0.06, window = 1.2 } = {}) {
  const picks = primaryFaces(samples);
  const bounds = [0, ...cuts.filter(c => c > 0.05 && c < duration - 0.05), duration];
  const track = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const a = bounds[s], b = bounds[s + 1];
    const inShot = picks.filter(([t]) => t >= a && t < b);
    const seen = inShot.filter(([, f]) => f);
    let pts;
    if (seen.length < Math.max(2, inShot.length * 0.3)) pts = [[a, 0.5, 0.5], [b, 0.5, 0.5]]; // no reliable face: centre
    else {
      const xs = seen.map(([, f]) => f[0]), ys = seen.map(([, f]) => f[1]);
      if (Math.max(...xs) - Math.min(...xs) < still && Math.max(...ys) - Math.min(...ys) < still) {
        const x = median(xs), y = median(ys); pts = [[a, x, y], [b, x, y]];        // locked-off shot: one crop
      } else {
        // follow: fill gaps with the nearest seen value, then a centred moving average
        const filled = inShot.map(([t, f], i) => {
          if (f) return [t, f[0], f[1]];
          const near = seen.reduce((n, p) => (Math.abs(p[0] - t) < Math.abs(n[0] - t) ? p : n));
          return [t, near[1][0], near[1][1]];
        });
        pts = filled.map(([t], i) => {
          const w = filled.filter(([u]) => Math.abs(u - t) <= window / 2);
          return [t, w.reduce((s, p) => s + p[1], 0) / w.length, w.reduce((s, p) => s + p[2], 0) / w.length];
        });
        pts.unshift([a, pts[0][1], pts[0][2]]); pts.push([b, pts[pts.length - 1][1], pts[pts.length - 1][2]]);
      }
    }
    // the next shot starts at the same time b, so faceAt jumps there instead of gliding
    track.push(...pts.map(([t, x, y]) => [+t.toFixed(3), +x.toFixed(4), +y.toFixed(4)]));
  }
  return track;
}

let ctx = null;
async function tracker() {
  if (ctx) return ctx;
  await installFaceModel();
  const { chromium } = await import('playwright');
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // everything is local: refuse any request that leaves the machine
  await page.route(u => !/^http:\/\/127\.0\.0\.1:/.test(String(u)), r => r.abort());
  await page.goto(server.url('engine/faces.html'));
  await page.waitForFunction(() => window.facesReady);
  ctx = { page, server, browser, close: async () => { await browser.close(); server.srv.close(); ctx = null; } };
  return ctx;
}

export async function makeFaceTrack(clip, track, { fps = 6 } = {}) {
  const { page, server } = await tracker();
  const rel = path.relative(ROOT, clip).split(path.sep).join('/');
  if (rel.startsWith('..')) die(`clip must be inside the repo: ${clip}`);
  const r = await page.evaluate(([u, f]) => window.detectFaces(u, f), [server.url(rel), fps]);
  const cuts = findCuts(clip);
  const out = { clip: path.basename(clip), w: r.w, h: r.h, duration: +r.duration.toFixed(3), cuts, track: buildTrack(r.samples, cuts, r.duration) };
  const found = r.samples.filter(([, f]) => f.length).length;
  fs.writeFileSync(track, JSON.stringify(out) + '\n');
  return { found, samples: r.samples.length };
}

export async function ensureFaceTracks(dir, { force = false, log = console.log } = {}) {
  const todo = faceTargets(dir).filter(t => t.generated && (force || !fs.existsSync(t.track) || (fs.existsSync(t.clip) && fs.statSync(t.track).mtimeMs < fs.statSync(t.clip).mtimeMs)));
  try {
    for (const t of todo) {
      if (!fs.existsSync(t.clip)) die(`clip not found: ${path.relative(ROOT, t.clip)}${t.clip.endsWith('.talk.mp4') ? ' (npm run voice makes talk clips)' : ''}`);
      const t0 = Date.now();
      const { found, samples } = await makeFaceTrack(t.clip, t.track);
      log(`  face track: ${path.relative(ROOT, t.track)} (face in ${Math.round(100 * found / samples)}% of frames, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } finally { if (ctx) await ctx.close(); }
  return todo.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  const dir = reelDir(args._[0]);
  const n = await ensureFaceTracks(dir, { force: !!args.force });
  console.log(n ? `✓ ${n} face track${n > 1 ? 's' : ''}` : '✓ face tracks up to date');
}
