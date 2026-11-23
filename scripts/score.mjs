#!/usr/bin/env node
// Render a reel's score.js (music + sound effects written with Tone.js) to score.wav, offline in headless Chromium.
//   npm run score -- <reel>
// render runs this automatically when score.js or timeline.json is newer than score.wav.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, reelDir, readJSON, serve, die, ROOT, offlineGuard } from './lib.mjs';

export async function renderScore(dir, { quiet = false } = {}) {
  const src = path.join(dir, 'score.js'), out = path.join(dir, 'score.wav');
  if (!fs.existsSync(src)) die(`No score.js in ${path.relative(ROOT, dir)}. See engine/score-kit.js for how to write one.`);
  const tlFile = path.join(dir, 'timeline.json');
  if (!fs.existsSync(tlFile)) die(`No timeline.json in ${path.relative(ROOT, dir)}. Run: npm run voice -- ${path.basename(dir)}`);
  const tl = readJSON(tlFile);
  const { chromium } = await import('playwright');
  // Scoring in headless Chromium occasionally never finishes (seen on macOS CI): sometimes the render, sometimes the
  // browser itself. Each try, from starting the browser to the finished wav, gets a time limit (REELKIT_STALL_SECONDS,
  // default 120); a stuck try is abandoned (its browser killed) and retried once in a fresh one.
  const LIMIT = +(process.env.REELKIT_STALL_SECONDS || 120) * 1000;
  const rel = path.relative(ROOT, src).split(path.sep).join('/');
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now(), st = { step: 'starting the page server', gaveUp: false, server: null, browser: null };
    let timer;
    const once = (async () => {
      st.server = await serve();
      st.step = 'starting the browser'; st.browser = await chromium.launch({ timeout: LIMIT });
      if (st.gaveUp) { await st.browser.close().catch(() => {}); return null; }
      const page = await st.browser.newPage();
      const errors = []; await offlineGuard(page, errors); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
      st.step = 'loading the score page'; await page.goto(st.server.url('engine/score.html'));
      await page.waitForFunction(() => window.scoreReady, null, { timeout: 15000 });
      st.step = 'rendering the audio';
      return page.evaluate(([u, tl]) => window.renderScore(u, tl), [st.server.url(rel) + '?v=' + fs.statSync(src).mtimeMs, tl])
        .catch(e => { if (!st.gaveUp) throw new Error(`score.js failed: ${e.message.split('\n')[0]}${errors.length ? '\n' + errors.join('\n') : ''}`); });
    })().catch(e => { if (st.gaveUp) return null; die(e.message); });
    const stuck = new Promise(res => { timer = setTimeout(() => res('stuck'), LIMIT); });
    try {
      const r = await Promise.race([once, stuck]);
      if (r === 'stuck') {
        st.gaveUp = true; // closing this browser rejects the abandoned work: not an error in score.js
        if (attempt < 2) { console.error(`  ⚠ scoring score.js stalled for ${LIMIT / 1000} s while ${st.step}; trying once more`); continue; }
        die(`scoring score.js stalled twice (${LIMIT / 1000} s each, last while ${st.step}). Run npm run score -- ${path.basename(dir)} to try again`);
      }
      fs.writeFileSync(out, Buffer.from(r.wav, 'base64'));
      const db = 20 * Math.log10(r.peak || 1e-9);
      if (!quiet) console.log(`✓ score.wav: ${tl.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s, peak ${db.toFixed(1)} dBFS${r.peak >= 1 ? '  ⚠ clipping: lower a volume in score.js' : r.peak < 0.01 ? '  ⚠ nearly silent' : ''}`);
      return out;
    } finally {
      clearTimeout(timer);
      if (st.browser) await Promise.race([st.browser.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
      st.server?.srv.close(); st.server?.srv.closeAllConnections?.();
    }
  }
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
