#!/usr/bin/env node
// Self-check before rendering:
//   1. layout lint (text off-screen, under app UI, overflowing, colliding with captions, bad word refs)
//   2. motion check (scenes that freeze, scenes where nothing changes for too long)
//   3. contact sheet PNG: 4 frames per scene, so Claude (or you) can look at the whole reel at once
//   npm run check -- <reel> [--frames 4]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, reelDir, openReel, OUT, ROOT, readJSON, checkStyle } from './lib.mjs';
import { tasteDir } from './ref.mjs';
import { ensureDepthMaps } from './depth.mjs';
import { ensureFaceTracks } from './faces.mjs';
import { ensureTalkClips } from './footage.mjs';
import { glTransitions, suggest } from './transitions.mjs';

const args = parseArgs();
const dir = reelDir(args._[0]);
const style = checkStyle(args.style || null);
const name = path.basename(dir) + (style ? `.${style}` : '');
const per = +(args.frames || 4);
const tl = readJSON(path.join(dir, 'timeline.json'));
checkStyle(tl.style);

// timeline freshness: the script changed since voicing?
const script = readJSON(path.join(dir, 'script.json'));
const stale = (script.scenes || []).some(s => { const t = tl.scenes.find(x => x.id === s.id); return !t || t.say !== s.say; }) || script.scenes.length !== tl.scenes.length;

await ensureDepthMaps(dir);
await ensureTalkClips(dir);
await ensureFaceTracks(dir);
const { page, close, errors } = await openReel(dir, { scale: 1, style });
const issues = await page.evaluate(() => window.__reel.lint());
// gl: transitions are drawn by render; check the names here (preview and the contact sheets show a fade)
for (const m of fs.readFileSync(path.join(dir, 'reel.html'), 'utf8').matchAll(/data-transition="gl:([^"]+)"/g))
  if (!glTransitions().some(t => t.name.toLowerCase() === m[1].toLowerCase()))
    issues.push({ level: 'error', scene: '*', msg: `unknown transition "gl:${m[1]}"${suggest(m[1]).length ? `. Close: ${suggest(m[1]).map(x => 'gl:' + x).join(', ')}` : ''}. All 214: node_modules/gl-transitions/README.md` });
if (stale) issues.unshift({ level: 'error', scene: '*', msg: 'script.json changed since the last voice run. Run npm run voice first.' });
errors.forEach(e => issues.unshift({ level: 'error', scene: '*', msg: 'page error: ' + e }));

// motion check: hash frames (without captions) through each scene
await page.evaluate(() => window.__reel.setCaptions(false));
const stage = await page.$('#stage');
const sceneList = await page.evaluate(() => window.__reel.scenes);
const motion = [];
for (const sc of sceneList) {
  const dur = sc.end - sc.start; const step = 0.25; let lastHash = null, frozenSince = sc.start, longest = 0, longestAt = 0;
  for (let t = sc.start + 0.05; t < sc.end - 0.02; t += step) {
    await page.evaluate(async t => { window.__reel.seek(t); await window.__reel.settle(); }, t);
    const buf = await stage.screenshot({ type: 'jpeg', quality: 40, scale: 'css' });
    const h = crypto.createHash('md5').update(buf).digest('hex');
    if (h !== lastHash) { frozenSince = t; lastHash = h; }
    const f = t - frozenSince; if (f > longest) { longest = f; longestAt = frozenSince; }
  }
  motion.push({ id: sc.id, dur, longest, at: longestAt - sc.start });
  if (longest >= 2.5) issues.push({ level: 'warn', scene: sc.id, msg: `frozen for ${longest.toFixed(1)}s (from ${(longestAt - sc.start).toFixed(1)}s). Add a word-synced beat or data-loop.` });
}

// taste: compare pacing with the reference videos (script.json "taste", or --taste <name|path>)
const tasteName = args.taste || script.taste;
let taste = null;
if (tasteName) {
  const td = tasteDir(tasteName), tj = path.join(td, 'taste.json');
  if (!fs.existsSync(tj)) issues.push({ level: 'warn', scene: '*', msg: `taste "${tasteName}" has no measured references. Run: npm run ref -- ${tasteName} <links or files>` });
  else {
    const T = readJSON(tj);
    const perScene = tl.duration / sceneList.length;
    const pace = T.pace ?? T.avgShot;
    if (pace && perScene > pace * 2)
      issues.push({ level: 'warn', scene: '*', msg: `slower than the "${tasteName}" references: a new scene every ${perScene.toFixed(1)}s, they show something new every ${pace}s. Split scenes, or make sure each scene has word-synced beats that change the picture.` });
    taste = { name: tasteName, md: path.join(td, 'taste.md'), sheets: (T.sheets || []).map(s => path.join(td, s)), T, perScene };
  }
}

// contact sheet: frames at evenly spaced points, captions on
await page.evaluate(on => window.__reel.setCaptions(on), tl.captions !== false); // match what the render will show
const shots = [];
for (const sc of sceneList) {
  const dur = sc.end - sc.start;
  for (let i = 0; i < per; i++) {
    const t = sc.start + Math.min(dur - 0.05, (dur * (i + 0.6)) / per);
    await page.evaluate(async t => { window.__reel.seek(t); await window.__reel.settle(); }, t);
    const b = await stage.screenshot({ type: 'jpeg', quality: 70 });
    shots.push({ scene: sc.id, t, src: 'data:image/jpeg;base64,' + b.toString('base64') });
  }
}
await page.setViewportSize({ width: 1800, height: 1000 });
const cols = per;
const html = `<html><body style="margin:0;background:#222;font:20px monospace;color:#eee">
<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:10px">
${shots.map(s => `<div><div style="padding:4px 2px">${s.scene} · ${s.t.toFixed(1)}s</div><img src="${s.src}" style="width:100%;display:block"></div>`).join('')}
</div></body></html>`;
await page.setContent(html);
fs.mkdirSync(OUT, { recursive: true });
// one sheet per ~3 scenes so each image stays legible
const sheets = [];
const rows = await page.$$('body > div > div');
const perSheet = cols * 3;
for (let i = 0; i < rows.length; i += perSheet) {
  const f = path.join(OUT, `${name}.check-${Math.floor(i / perSheet) + 1}.png`);
  const first = await rows[i].boundingBox(); const lastEl = rows[Math.min(rows.length, i + perSheet) - 1]; const last = await lastEl.boundingBox();
  await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y: first.y - 6, width: 1800, height: last.y + last.height - first.y + 12 } });
  sheets.push(f);
}
await close();

// report
const errs = issues.filter(i => i.level === 'error'), warns = issues.filter(i => i.level === 'warn');
console.log(`\n▸ check ${name}  (${tl.duration.toFixed(1)}s, ${sceneList.length} scenes, voice: ${tl.voice})`);
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} [${i.scene}] ${i.el ? i.el + ': ' : ''}${i.msg}`);
if (!issues.length) console.log('  ✓ no layout or motion problems found');
console.log(`\n  motion: ${motion.map(m => `${m.id} ${m.longest < 1 ? 'ok' : 'still ' + m.longest.toFixed(1) + 's'}`).join(' · ')}`);
console.log(`\n  contact sheets (look at these):\n${sheets.map(s => '    ' + path.relative(ROOT, s)).join('\n')}`);
if (taste) console.log(`\n  taste "${taste.name}": references show something new every ${taste.T.pace ?? taste.T.avgShot}s (still ${Math.round((taste.T.stillShare ?? 0) * 100)}% of the time); this reel changes scene every ${taste.perScene.toFixed(1)}s.\n  Read ${path.relative(ROOT, taste.md) || taste.md} and compare the sheets above with:\n${taste.sheets.map(s => '    ' + (path.relative(ROOT, s).startsWith('..') ? s : path.relative(ROOT, s))).join('\n')}`);
console.log(`\n  ${errs.length} errors, ${warns.length} warnings\n`);
fs.writeFileSync(path.join(OUT, `${name}.check.json`), JSON.stringify({ issues, motion, sheets: sheets.map(s => path.relative(ROOT, s)) }, null, 2));
process.exit(errs.length ? 2 : 0);
