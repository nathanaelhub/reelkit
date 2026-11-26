#!/usr/bin/env node
// A series: several reels from one source (an article, notes, a link), in one look and one voice.
//   npm run series -- new <name> --from <file | link | "text"> [--count 5] [--style riso] [--voice me]
//   npm run series -- status <name>      which parts exist, are voiced, rendered and ready to post
//   npm run series -- ship <name>        npm run ship for every rendered part
//   npm run series -- list
// `new` only sets the series up (series/<name>/series.json + source.txt). Then ask your agent:
//   "make the series in series/<name>"   (it follows "Making a series" in .claude/skills/make-reel/SKILL.md)
// or press Make it with "A series" in reelkit studio, which does both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, die, ROOT, REELS, OUT, readJSON, writeJSON, listStyles, shown, HOME_DIR } from './lib.mjs';

export const SERIES = path.join(HOME_DIR, 'series');
export const seriesName = n => String(n || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function createSeries(name, { from, count = 5, style = null, voice = null, title = null } = {}) {
  name = seriesName(name);
  if (!name) throw new Error('give the series a name, like coffee-facts');
  if (!from || !String(from).trim()) throw new Error('give it a source: --from article.md, --from https://…, or --from "your notes"');
  count = Math.round(+count);
  if (!(count >= 2 && count <= 10)) throw new Error('a series is 2 to 10 reels');
  if (style && !listStyles().some(s => s.name === style)) throw new Error(`unknown style "${style}". npm run styles lists them`);
  if (voice && voice !== 'free' && !fs.existsSync(path.join(HOME_DIR, 'voices', `${voice}.wav`))) throw new Error(`no voice called "${voice}": npm run my-voice -- list`);
  const dir = path.join(SERIES, name);
  if (fs.existsSync(path.join(dir, 'series.json'))) throw new Error(`series/${name} already exists`);
  // the source: a file's text, a link (the agent fetches it), or the text itself
  const src = String(from).trim();
  const isLink = /^https?:\/\/\S+$/i.test(src), isFile = !isLink && src.length < 400 && fs.existsSync(path.resolve(src));
  const text = isFile ? fs.readFileSync(path.resolve(src), 'utf8') : src;
  if (text.length > 200_000) throw new Error('that source is over 200,000 characters: give a shorter excerpt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.txt'), isLink ? `Source link (fetch and read it): ${src}\n` : text.trim() + '\n');
  const series = { name, title: title || null, count, style: style || null, voice: voice && voice !== 'free' ? voice : null,
    source: isLink ? src : isFile ? path.basename(src) : 'pasted text', created: new Date().toISOString(), parts: [] };
  writeJSON(path.join(dir, 'series.json'), series);
  return { dir, series };
}

export function listSeries() {
  if (!fs.existsSync(SERIES)) return [];
  return fs.readdirSync(SERIES).filter(d => fs.existsSync(path.join(SERIES, d, 'series.json'))).sort().map(d => seriesStatus(d));
}

// The parts are the reels whose script.json says { "series": { "name": <name>, "part": n } }.
export function seriesStatus(name) {
  const s = readJSON(path.join(SERIES, name, 'series.json'));
  const parts = (fs.existsSync(REELS) ? fs.readdirSync(REELS) : []).map(slug => {
    const sp = path.join(REELS, slug, 'script.json'); if (!fs.existsSync(sp)) return null;
    let sc; try { sc = readJSON(sp); } catch { return null; }
    if (sc.series?.name !== name) return null;
    return { slug, part: sc.series.part ?? null, title: sc.title || slug, voiced: fs.existsSync(path.join(REELS, slug, 'timeline.json')),
      rendered: fs.existsSync(path.join(OUT, `${slug}.mp4`)), shipped: fs.existsSync(path.join(OUT, `${slug}.ship`, 'checks.txt')) };
  }).filter(Boolean).sort((a, b) => (a.part ?? 99) - (b.part ?? 99));
  return { ...s, parts, planned: fs.existsSync(path.join(SERIES, name, 'plan.md')) };
}

function main() {
  const args = parseArgs();
  const [cmd, name] = args._;
  try {
    if (cmd === 'new') {
      const { dir, series } = createSeries(name, { from: args.from, count: args.count ?? 5, style: args.style, voice: args.voice, title: args.title });
      console.log(`✓ ${shown(dir)}/: ${series.count} reels from ${series.source}${series.style ? `, ${series.style} style` : ''}${series.voice ? `, voice "${series.voice}"` : ''}`);
      console.log(`  next: ask your agent "make the series in ${shown(dir)}", or use A series in reelkit studio (npm start)`);
    } else if (cmd === 'status') {
      if (!name || !fs.existsSync(path.join(SERIES, seriesName(name), 'series.json'))) die(`no series "${name}". npm run series -- list`);
      const s = seriesStatus(seriesName(name));
      console.log(`${s.title || s.name}: ${s.parts.length} of ${s.count} parts${s.planned ? '' : ' (no plan.md yet)'}`);
      for (const p of s.parts) console.log(`  ${String(p.part ?? '?').padStart(2)}. ${p.slug.padEnd(34)} ${p.voiced ? 'voiced' : '·'}  ${p.rendered ? 'rendered' : '·'}  ${p.shipped ? 'ready to post' : '·'}   ${p.title}`);
    } else if (cmd === 'ship') {
      if (!name || !fs.existsSync(path.join(SERIES, seriesName(name), 'series.json'))) die(`no series "${name}". npm run series -- list`);
      const s = seriesStatus(seriesName(name)); let bad = 0;
      for (const p of s.parts.filter(p => p.rendered)) {
        const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ship.mjs'), p.slug], { stdio: 'inherit' });
        if (r.status !== 0) bad++;
      }
      if (bad) process.exitCode = 2;
    } else if (cmd === 'list' || !cmd) {
      const all = listSeries();
      if (!all.length) console.log('no series yet: npm run series -- new <name> --from <file | link | "text"> --count 5');
      for (const s of all) console.log(`  ${s.name.padEnd(24)} ${s.parts.length}/${s.count} parts  ${s.parts.filter(p => p.rendered).length} rendered  ${s.source}`);
    } else die(`unknown command "${cmd}". Use new, status, ship or list`);
  } catch (e) { die(e.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
