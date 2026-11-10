#!/usr/bin/env node
// Render a reel's score.js (music + sound effects written with Tone.js) to score.wav, offline in headless Chromium.
//   npm run score -- <reel>
// render runs this automatically when score.js or timeline.json is newer than score.wav.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, reelDir, readJSON, serve, die, ROOT } from './lib.mjs';

export async function renderScore(dir, { quiet = false } = {}) {
  const src = path.join(dir, 'score.js'), out = path.join(dir, 'score.wav');
  if (!fs.existsSync(src)) die(`No score.js in ${path.relative(ROOT, dir)}. See engine/score-kit.js for how to write one.`);
  const tlFile = path.join(dir, 'timeline.json');
  if (!fs.existsSync(tlFile)) die(`No timeline.json in ${path.relative(ROOT, dir)}. Run: npm run voice -- ${path.basename(dir)}`);
  const tl = readJSON(tlFile);
  const { chromium } = await import('playwright');
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await page.goto(server.url('engine/score.html'));
    await page.waitForFunction(() => window.scoreReady, null, { timeout: 15000 });
    const rel = path.relative(ROOT, src).split(path.sep).join('/');
    const t0 = Date.now();
    const r = await page.evaluate(([u, tl]) => window.renderScore(u, tl), [server.url(rel) + '?v=' + fs.statSync(src).mtimeMs, tl])
      .catch(e => die(`score.js failed: ${e.message.split('\n')[0]}${errors.length ? '\n' + errors.join('\n') : ''}`));
    fs.writeFileSync(out, Buffer.from(r.wav, 'base64'));
    const db = 20 * Math.log10(r.peak || 1e-9);
    if (!quiet) console.log(`✓ score.wav: ${tl.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s, peak ${db.toFixed(1)} dBFS${r.peak >= 1 ? '  ⚠ clipping: lower a volume in score.js' : r.peak < 0.01 ? '  ⚠ nearly silent' : ''}`);
    return out;
  } finally { await browser.close(); server.srv.close(); }
}

export function scoreIsStale(dir) {
  const src = path.join(dir, 'score.js'), out = path.join(dir, 'score.wav');
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(out)) return true;
  const t = fs.statSync(out).mtimeMs;
  return [src, path.join(dir, 'timeline.json'), path.join(ROOT, 'engine', 'score-kit.js')].some(f => fs.existsSync(f) && fs.statSync(f).mtimeMs > t);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  await renderScore(reelDir(args._[0]));
}
