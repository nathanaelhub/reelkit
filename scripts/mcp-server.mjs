// reelkit's MCP server: the tools an AI app (Claude Desktop, Cursor, ChatGPT desktop, …) uses to make a reel.
// Started by scripts/mcp.mjs over stdio; see docs/mcp.md. The app's own model plans and writes the reel; these tools
// write its files (inside reels/<slug>/ and series/<name>/ only) and run reelkit's steps as jobs.
//
// Every tool call comes back within about 25 seconds, because some apps (Claude Desktop) drop a call after about 60 s:
// a long step (voice, render, …) is a job, and `wait` is called again until it ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ROOT, REELS, OUT, readJSON, writeJSON, listStyles, ffmpegPath, ffprobePath } from './lib.mjs';
import { SLUG, reelInfo, listReels, jobs, startJob, stopAllJobs, node, ACTIONS } from './jobs.mjs';
import { listVoices } from './myvoice.mjs';
import { createSeries, seriesStatus, seriesName, SERIES } from './series.mjs';
import { LANGUAGES } from './languages.mjs';
import { translateCopy } from './translate.mjs';

const VERSION = readJSON(path.join(ROOT, 'package.json')).version;
const FIRST_WAIT = +(process.env.REELKIT_MCP_FIRST_WAIT || 20) * 1000; // run: wait this long before handing back a job
const WAIT = +(process.env.REELKIT_MCP_WAIT || 25) * 1000;              // wait: at most this long per call
const IMAGE_BUDGET = 1.5 * 1024 * 1024;                                  // bytes of pictures per result
const JOB_ENV = { REELKIT_OFFLINE: '1' };                                // see offlineGuard in lib.mjs
process.env.REELKIT_JOB_FROM = 'an AI app (MCP)';
process.chdir(ROOT); // apps start this from anywhere; reelkit's scripts and createSeries resolve paths from here
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-mcp-'));

// ---------- small helpers ----------
const text = (t, extra = []) => ({ content: [{ type: 'text', text: t }, ...extra] });
const fail = t => ({ content: [{ type: 'text', text: t }], isError: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
const tool = fn => async (args, extra) => { try { return await fn(args || {}, extra); } catch (e) { return fail(e.message || String(e)); } };
const reelPath = slug => {
  if (!SLUG.test(String(slug || ''))) throw new Error(`"${slug}" isn't a reel name: lowercase letters, digits and dashes (list_reels shows them)`);
  const dir = path.join(REELS, slug);
  if (!fs.existsSync(path.join(dir, 'script.json'))) throw new Error(`there is no reel "${slug}" (new_reel makes one; list_reels shows them)`);
  return dir;
};

// ---------- paths the model may read and write ----------
const TEXT = new Set(['.json', '.html', '.js', '.css', '.md', '.txt', '.svg']);
const MAX_TEXT = 1 << 20;
// "reels/<slug>/…" or "series/<name>/…", relative to the reelkit folder, inside a reel or series that exists
function safePath(p, { text: mustBeText = true } = {}) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s) throw new Error('give a path like reels/<slug>/reel.html');
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('/') || s.startsWith('~')) throw new Error(`"${s}" is outside reelkit: paths start with reels/<slug>/ or series/<name>/`);
  const parts = s.split('/').filter(x => x && x !== '.');
  if (parts.some(x => x === '..')) throw new Error(`"${s}": ".." isn't allowed; paths start with reels/<slug>/ or series/<name>/`);
  if (parts.some(x => x.startsWith('.'))) throw new Error(`"${s}": hidden files (starting with a dot) can't be read or written`);
  const [top, name] = parts;
  if (!['reels', 'series'].includes(top) || parts.length < 3) throw new Error(`"${s}": only files inside reels/<slug>/ or series/<name>/ can be read or written`);
  const home = path.join(ROOT, top, name);
  if (top === 'reels' && (!SLUG.test(name) || !fs.existsSync(path.join(home, 'script.json')))) throw new Error(`there is no reel "${name}" (new_reel makes one)`);
  if (top === 'series' && (seriesName(name) !== name || !fs.existsSync(path.join(home, 'series.json')))) throw new Error(`there is no series "${name}" (new_series makes one)`);
  const abs = path.join(ROOT, ...parts);
  // follow symlinks: whatever exists of the path must really be inside that reel or series
  let probe = abs; while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const inside = path.relative(fs.realpathSync(home), fs.realpathSync(probe));
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`"${s}" leads outside ${top}/${name}`);
  if (mustBeText && !TEXT.has(path.extname(abs).toLowerCase())) throw new Error(`"${s}": only text files (${[...TEXT].join(' ')}) can be read or written; add pictures and sound with add_asset`);
  return { abs, path: parts.join('/') };
}

// ---------- media: what a file really is, from its first bytes ----------
function sniff(b) {
  const a = (i, n) => b.subarray(i, i + n).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg' };
  if (a(0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'image', ext: 'png' };
  if (a(0, 6) === 'GIF87a' || a(0, 6) === 'GIF89a') return { kind: 'image', ext: 'gif' };
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP') return { kind: 'image', ext: 'webp' };
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WAVE') return { kind: 'audio', ext: 'wav' };
  if (a(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', ext: 'mp3' };
  if (a(0, 4) === 'OggS') return { kind: 'audio', ext: 'ogg' };
  if (a(0, 4) === 'fLaC') return { kind: 'audio', ext: 'flac' };
  if (a(4, 4) === 'ftyp') {
    const brand = a(8, 4);
    if (/^(avif|avis)$/.test(brand)) return { kind: 'image', ext: 'avif' };
    if (/^(M4A |M4B )$/.test(brand)) return { kind: 'audio', ext: 'm4a' };
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return { kind: 'unsupported', why: 'HEIC photos need converting to JPEG first' };
    return { kind: 'video', ext: brand === 'qt  ' ? 'mov' : 'mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', ext: 'webm' };
  return { kind: 'unknown' };
}
const MAX_MEDIA = 50 << 20;
const isLink = s => /^https:\/\/\S+$/i.test(String(s || '').trim());
const localFile = s => {
  let f = String(s || '').trim().replace(/^file:\/\//, '');
  if (f.startsWith('~')) f = path.join(os.homedir(), f.slice(1));
  if (!path.isAbsolute(f)) throw new Error(`"${s}": give a web link (https://…) or the full path of a file on this computer (like ~/Desktop/photo.jpg)`);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`no file at ${f}`);
  return f;
};
const head = f => { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(64); fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); return b; };
async function download(url, limit) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 18000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': `reelkit/${VERSION}` } });
    if (!res.ok) throw new Error(`the link answered HTTP ${res.status}`);
    if (+res.headers.get('content-length') > limit) throw new Error(`that file is over ${limit >> 20} MB`);
    const chunks = []; let n = 0;
    for await (const c of res.body) { n += c.length; if (n > limit) throw new Error(`that file is over ${limit >> 20} MB`); chunks.push(c); }
    return Buffer.concat(chunks);
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'the download took too long (over 18 s): try a smaller file or another link' : e.message); }
  finally { clearTimeout(t); }
}

// ---------- pictures for the model ----------
// A JPEG copy with its long edge at most `edge` px; null if ffmpeg can't read it.
function jpeg(src, edge = 1568) {
  const out = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  const r = spawnSync(ffmpegPath(), ['-nostdin', '-y', '-loglevel', 'error', '-i', src, '-vf',
    `scale=w='if(gt(iw,ih),min(${edge},iw),-2)':h='if(gt(iw,ih),-2,min(${edge},ih))'`, '-frames:v', '1', '-q:v', '4', out], { timeout: 20000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  const data = fs.readFileSync(out); fs.rmSync(out, { force: true });
  return data;
}
const image = data => ({ type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' });
// pictures up to the byte budget; the rest are named, for `wait` with more: true
function pictures(files, edge) {
  const imgs = [], left = []; let used = 0;
  for (const f of files) {
    if (used >= IMAGE_BUDGET) { left.push(f); continue; }
    const d = jpeg(f, edge); if (!d) continue;
    if (imgs.length && used + d.length > IMAGE_BUDGET) { left.push(f); continue; }
    imgs.push(image(d)); used += d.length;
  }
  return { imgs, left };
}
// six frames of a video, side by side
function strip(video, duration) {
  const out = path.join(TMP, `strip-${Date.now()}.jpg`);
  const r = spawnSync(ffmpegPath(), ['-nostdin', '-y', '-loglevel', 'error', '-i', video, '-vf',
    `fps=6/${Math.max(1, duration).toFixed(2)},scale=260:-2,tile=6x1`, '-frames:v', '1', '-q:v', '4', out], { timeout: 20000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  const d = fs.readFileSync(out); fs.rmSync(out, { force: true }); return d;
}
function frameAt(video, t) {
  const out = path.join(TMP, `frame-${Date.now()}-${t}.jpg`);
  const r = spawnSync(ffmpegPath(), ['-nostdin', '-y', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', out], { timeout: 20000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  const d = fs.readFileSync(out); fs.rmSync(out, { force: true }); return d;
}
const duration = f => { const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8', timeout: 15000 }); return parseFloat(r.stdout) || 0; };
const newest = (files, since = 0) => files.filter(f => fs.existsSync(f) && fs.statSync(f).mtimeMs >= since - 1500).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

// ---------- the guide: the make-reel skill, with what changes in an AI app ----------
const SKILL_DIR = path.join(ROOT, '.claude', 'skills', 'make-reel');
const PREAMBLE = `# Making reels with reelkit's tools

You are working through reelkit's MCP tools, not a terminal. The guide below was written for coding agents, so read it with these swaps:
- Paths are relative to the reelkit folder (${ROOT}). Write files with write_file / edit_file (reels/<slug>/script.json, reel.html, score.js); read them with read_file.
- \`npm run doctor\` → setup (setup with fix: true installs what's missing). \`npm run new\` → new_reel. \`npm run styles\`, \`npm run my-voice -- list\` and the voice lists → options.
- \`npm run voice / check / render / score / ship / depth / cutout / clip -- <slug>\` → run with that step (options: style, from, to, cover). Long steps return a job: call wait with it until it's done.
- "Open every contact sheet with the Read tool" → run check returns the sheets as pictures. Look at every one, fix, check again.
- After a render, run render returns a strip of frames; show with at: [seconds…] gives single frames from the video; show without at opens the video for the person.
- \`npm run footage\` → add_footage (its shot sheet comes back as a picture). Images, sound and the user's own music (name it music.mp3) → add_asset, from a link or a file on this computer. \`npm run translate\` → translate. \`npm run series -- new / status\` → new_series / series_status.
- \`styles/<name>/rules.md\` → guide with topic "style:<name>". \`engine/score-kit.js\` → guide "score". The gl-transitions list → guide "transitions". The guides script.md, scenes.md, style.md, feedback.md → guide "script", "scenes", "style", "feedback".
- Not available here; skip them: taste references (\`npm run ref\`, refs/, taste/), \`npm run preview\` (use show), and recording a voice (the person does that in reelkit studio: npm start). If a step says to fetch a link, use your own web tools if you have them.
- Renders started from here can't load anything from the internet: put every picture and sound in the reel with add_asset.
- Don't ask the person to run commands; do the steps yourself, and tell them where the finished video is (show).
`;
function section(md, heading) {
  const i = md.indexOf(`\n## ${heading}`); if (i < 0) return null;
  const j = md.indexOf('\n## ', i + 4);
  return md.slice(i + 1, j < 0 ? undefined : j).trim();
}
function guideText(topic = 'make-reel') {
  const t = String(topic || 'make-reel').trim().toLowerCase();
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  if (t === 'make-reel' || t === 'skill') return PREAMBLE + '\n---\n\n' + skill;
  if (['script', 'scenes', 'style', 'feedback'].includes(t)) return fs.readFileSync(path.join(SKILL_DIR, 'guides', `${t}.md`), 'utf8');
  if (t === 'languages' || t === 'language') return section(skill, 'Another language') + `\n\nLanguages: ${Object.entries(LANGUAGES).map(([c, l]) => `${c} (${l.name})`).join(', ')}.`;
  if (t === 'series') return section(skill, 'Making a series');
  if (t.startsWith('style:')) {
    const name = t.slice(6); const s = listStyles().find(x => x.name === name);
    if (!s) throw new Error(`no style pack "${name}". Packs: ${listStyles().map(x => x.name).join(', ')}`);
    const f = path.join(ROOT, 'styles', name, 'rules.md');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : `${s.title || name}: ${s.description || ''}`;
  }
  if (t === 'score') {
    const src = fs.readFileSync(path.join(ROOT, 'engine', 'score-kit.js'), 'utf8').split('\n');
    const top = []; for (const l of src) { if (!l.startsWith('//')) break; top.push(l.replace(/^\/\/ ?/, '')); }
    const moods = [...src.join('\n').matchAll(/^\s{2}(\w+):\s+\{ bpm/gm)].map(m => m[1]);
    return `${top.join('\n')}\n\nMoods for bed(): ${moods.join(', ')}.\n\n${section(skill, '3b · Score it') || ''}`;
  }
  if (t === 'transitions') {
    return import('./transitions.mjs').then(m => `gl: transitions (scenes.md explains how to use them): ${m.glTransitions().map(g => g.name).join(', ')}`);
  }
  throw new Error(`no guide "${topic}". Topics: make-reel, script, scenes, style, feedback, languages, series, score, transitions, style:<pack>`);
}

// ---------- steps (jobs) ----------
const STEPS = ['voice', 'check', 'draft', 'render', 'score', 'ship', 'depth', 'cutout', 'clip'];
function stepCommand(slug, step, o = {}) {
  const style = o.style ? (() => { if (!listStyles().some(s => s.name === o.style)) throw new Error(`no style pack "${o.style}"`); return ['--style', o.style]; })() : [];
  const range = [...(o.from != null ? ['--from', String(+o.from)] : []), ...(o.to != null ? ['--to', String(+o.to)] : [])];
  if (range.some(x => x === 'NaN')) throw new Error('from and to are seconds, like 10 and 18');
  switch (step) {
    case 'voice': case 'score': case 'depth': case 'cutout': return node(`${step}.mjs`, [slug]);
    case 'check': return node('check.mjs', [slug, ...style]);
    case 'draft': return node('render.mjs', [slug, '--draft', ...style, ...range]);
    case 'render': return node('render.mjs', [slug, ...style, ...range]);
    case 'ship': {
      if (o.cover && !/^@?[\p{L}\p{N}'’-]+$/u.test(o.cover) && !/^\d+(\.\d+)?$/.test(o.cover)) throw new Error('cover is a word that is said (like @hearts) or a time in seconds');
      return node('ship.mjs', [slug, ...(o.cover ? ['--cover', String(o.cover)] : [])]);
    }
    case 'clip': {
      if (!o.src || o.from == null || o.to == null) throw new Error('clip needs opts.src (a video in the reel, like reels/<slug>/footage/x.mp4), opts.from and opts.to (seconds)');
      const { abs } = safePath(o.src, { text: false });
      if (!abs.startsWith(path.join(REELS, slug) + path.sep)) throw new Error('clip: the source must be inside this reel (add it with add_footage first)');
      if (sniff(head(abs)).kind !== 'video') throw new Error(`${o.src} isn't a video`);
      return node('clip.mjs', [slug, abs, String(+o.from), String(+o.to), ...(o.name ? [String(o.name).replace(/[^a-zA-Z0-9-]+/g, '-')] : [])]);
    }
    default: throw new Error(`unknown step "${step}". Steps: ${STEPS.join(', ')}`);
  }
}

function begin(label, cmd, args, { reel = null, kind, meta = {} }) {
  const job = startJob(label, cmd, args, { reel, env: JOB_ENV });
  job.mcp = { kind, reel, started: job.started, ...meta };
  return job;
}

// Wait for a job up to `ms`, sending progress to apps that ask for it, then report.
async function follow(job, ms, extra) {
  const until = Date.now() + ms, token = extra?._meta?.progressToken;
  let tick = 0;
  while (job.running && Date.now() < until) {
    await sleep(400);
    if (token != null && ++tick % 5 === 0) {
      const last = job.lines.at(-1) || job.label;
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: tick, message: String(last).slice(0, 120) } }).catch(() => {});
    }
  }
  if (job.running) {
    const pct = [...job.lines].reverse().map(l => String(l).match(/(\d{1,3})%/)).find(Boolean);
    return text(`Still working: "${job.label}" (job ${job.id}, ${Math.round((Date.now() - job.started) / 1000)} s so far${pct ? `, ${pct[1]}%` : ''}). Call wait with job "${job.id}" to keep waiting.\n\nLatest output:\n${job.lines.slice(-6).join('\n')}`);
  }
  return job.result ??= finish(job);
}

const tail = (job, n = 40) => job.lines.filter(l => !/^✓ done$|^✗ stopped/.test(l)).slice(-n).join('\n');
function finish(job) {
  const { kind, reel, started } = job.mcp, code = job.code;
  const failed = msg => fail(`${msg}\n\nOutput (last lines):\n${tail(job)}`);
  if (code == null) return fail(`"${job.label}" was stopped.`);
  if (kind === 'check') {
    const name = reel + (job.mcp.style ? `.${job.mcp.style}` : '');
    const jf = path.join(OUT, `${name}.check.json`);
    if (!fs.existsSync(jf) || fs.statSync(jf).mtimeMs < started - 1500) return failed(`check couldn't run (exit ${code}).`);
    const r = readJSON(jf);
    const sheets = (r.sheets || []).map(s => path.join(ROOT, s)).filter(f => fs.existsSync(f) && fs.statSync(f).mtimeMs >= started - 1500);
    const errs = r.issues.filter(i => i.level === 'error'), warns = r.issues.filter(i => i.level !== 'error');
    const lines = r.issues.map(i => `${i.level === 'error' ? '✗' : '⚠'} [${i.scene}] ${i.el ? i.el + ': ' : ''}${i.msg}`);
    const still = (r.motion || []).filter(m => m.longest >= 1).map(m => `${m.id} still for ${m.longest.toFixed(1)} s`);
    const { imgs, left } = pictures(sheets);
    job.more = left;
    return text(`check ${reel}: ${errs.length} errors, ${warns.length} warnings.\n${lines.join('\n') || '✓ no layout or motion problems found'}${still.length ? `\nNothing moves: ${still.join(', ')}` : ''}\n\n` +
      `${sheets.length} contact sheet${sheets.length === 1 ? '' : 's'} below: each row is a scene, sampled across its time. Look at every one: overlaps, cramped or hard-to-read text, empty or dull scenes, visuals that don't match the words, captions covering things. Fix with edit_file, then run check again.` +
      (left.length ? `\n${left.length} more sheet${left.length === 1 ? '' : 's'}: call wait with job "${job.id}" and more: true.` : ''), imgs);
  }
  if (kind === 'render' || kind === 'draft') {
    const cands = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.mp4') && (f === `${reel}.mp4` || f.startsWith(`${reel}.`))).map(f => path.join(OUT, f)) : [];
    const v = newest(cands, started);
    if (code !== 0 || !v) return failed(code === 3 ? 'The render stalled (the browser stopped answering). Run it again.' : `render failed (exit ${code}).`);
    const d = duration(v), s = strip(v, d);
    return text(`✓ ${rel(v)}: ${d.toFixed(1)} s, ${mb(fs.statSync(v).size)}.${kind === 'draft' ? ' (a fast half-size draft)' : ''} Six frames across the video below; show with at: [seconds] for a closer look at transitions and word hits. Then run ship${kind === 'draft' ? ' (after a full render)' : ''}, and show to open it for the person.`, s ? [image(s)] : []);
  }
  if (kind === 'ship') {
    const d = path.join(OUT, `${reel}.ship`);
    if (!fs.existsSync(path.join(OUT, `${reel}.mp4`))) return fail('ship needs a full render first: run render (not draft), then ship.');
    if (!fs.existsSync(path.join(d, 'checks.txt')) || fs.statSync(path.join(d, 'checks.txt')).mtimeMs < started - 1500) return failed(`ship failed (exit ${code}).`);
    const read = f => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8').trim() : '');
    const { imgs } = pictures(['safe-zones.jpg', 'cover.jpg'].map(f => path.join(d, f)).filter(f => fs.existsSync(f)), 1200);
    return text(`Ready to post: ${rel(d)}/ (cover.jpg, safe-zones.jpg, captions.srt and .vtt, post.txt).\n\nChecks:\n${read('checks.txt')}\n\nDraft post:\n${read('post.txt')}\n\nPictures: the safe zones (nothing important may sit in the shaded app areas: if something does, move it in reel.html and render again), then the cover. Fix any ✗ above.`, imgs);
  }
  if (kind === 'voice') {
    const tf = path.join(REELS, reel, 'timeline.json');
    if (code !== 0 || !fs.existsSync(tf) || fs.statSync(tf).mtimeMs < started - 1500) return failed(`voice failed (exit ${code}).`);
    const tl = readJSON(tf);
    const notes = job.lines.filter(l => /⚠|estimated|doesn't know/.test(l));
    return text(`✓ voiced ${reel}: ${tl.duration.toFixed(1)} s${tl.language && tl.language !== 'en' ? `, in ${LANGUAGES[tl.language]?.name || tl.language}` : ''}, voice: ${tl.voice}.\n` +
      tl.scenes.map(s => `  ${s.id.padEnd(12)} ${s.start.toFixed(2)}–${s.end.toFixed(2)} s  ${s.words.length} words`).join('\n') +
      `\nEvery word's time is in reels/${reel}/timeline.json (read_file). Animate against it with data-at="@word".${notes.length ? `\n\n${notes.join('\n')}` : ''}`);
  }
  if (kind === 'footage') {
    if (code !== 0) return failed(`footage failed (exit ${code}).`);
    const sheet = !fs.existsSync(OUT) ? null : newest(fs.readdirSync(OUT).filter(f => f.startsWith(`${reel}-footage-`) && f.endsWith('.png')).map(f => path.join(OUT, f)), started);
    const { imgs } = pictures(sheet ? [sheet] : []);
    return text(`✓ footage added to ${reel}.\n${tail(job, 60)}\n\nThe shot sheet is below: look for burned-in text (lower thirds, subtitles, logos) a vertical crop would cut.`, imgs);
  }
  if (kind === 'setup') return text(`${tail(job, 80)}\n\n${code === 0 ? 'Everything reelkit needs is there.' : 'Something is missing (✗ above): call setup with fix: true to install it.'}`);
  if (kind === 'footage' && !fs.existsSync(OUT)) return failed(`footage failed (exit ${code}).`);
  return code === 0 ? text(`✓ ${job.label}\n${tail(job, 15)}`) : failed(`${job.label} failed (exit ${code}).`);
}

// ---------- the server ----------
const server = new McpServer({ name: 'reelkit', title: 'reelkit', version: VERSION }, {
  instructions: `reelkit makes short vertical videos (reels, TikToks, Shorts) on this computer: voiced, captioned, animated and scored, from HTML.
Before making or changing a reel, call guide (no topic) and follow it: it is how a good reel is made, step by step. Call setup once if a step complains something is missing.
Slow steps (voice, check, render, ship) return a job: call wait with it until it is done. Look at every picture a result contains: they are how you see your work.
Finished videos stay in the person's reelkit folder (${ROOT}); show opens one for them.`,
});
const reg = (name, title, description, shape, fn) => server.registerTool(name, { title, description, inputSchema: shape }, tool(fn));

reg('guide', 'How to make a reel', 'How to make a good reel with these tools: the full method (default), or one topic. Read it before making a reel.', {
  topic: z.string().optional().describe('make-reel (default), script, scenes, style, feedback, languages, series, score, transitions, or style:<pack> (e.g. style:riso)'),
}, async ({ topic }) => text(await guideText(topic)));

reg('setup', 'Check setup', 'Check that reelkit has everything it needs (browser, voice models, ffmpeg). fix: true installs what is missing (downloads can take minutes: it returns a job).', {
  fix: z.boolean().optional(),
}, async ({ fix }, extra) => {
  const [cmd, a] = node('doctor.mjs', fix ? ['--fix'] : []);
  return follow(begin(fix ? 'setup (installing what is missing)' : 'setup check', cmd, a, { kind: 'setup' }), FIRST_WAIT, extra);
});

reg('options', 'Looks, voices and languages', 'The style packs, languages, free voices (Kokoro) and the person\'s own saved voices.', {}, async () => {
  const { KOKORO_VOICES } = await import('./speech.mjs').catch(() => ({ KOKORO_VOICES: [] }));
  const en = KOKORO_VOICES.filter(v => /^[ab][fm]_/.test(v));
  const mine = listVoices();
  return text([
    `Style packs (set "style" in script.json, then read guide style:<name>):\n${listStyles().map(s => `  ${s.name}: ${s.description || s.title || ''}`).join('\n')}`,
    `Languages (set "language" in script.json): ${Object.entries(LANGUAGES).map(([c, l]) => `${c} ${l.name}${l.voices.length ? ` (voices ${l.voices.join(', ')})` : ''}`).join('; ')}`,
    `Free English voices (Kokoro; "voice": { "provider": "kokoro", "kokoro": { "voice": "am_michael" } }): ${en.join(' ')}`,
    mine.length ? `The person's own voices (English only; "voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/<name>.wav" } }): ${mine.map(v => v.name).join(', ')}`
      : 'No recorded voices of the person yet (they can record one in reelkit studio: npm start).',
  ].join('\n\n'));
});

reg('list_reels', 'List reels', 'Every reel in this reelkit folder, newest first, and how far along each one is.', {}, async () => {
  const reels = listReels();
  if (!reels.length) return text('No reels yet: new_reel makes one.');
  return text(reels.map(r => `${r.slug}: "${r.title}"${r.language !== 'en' ? ` [${r.language}]` : ''}${r.style ? ` (${r.style})` : ''}  ${r.voiced ? `voiced ${r.duration?.toFixed(1)} s` : 'not voiced'} · ${r.sheets.length ? 'checked' : 'not checked'} · ${r.videos.length ? `rendered (${r.videos[0]})` : 'not rendered'}${r.ship ? ' · ready to post' : ''}`).join('\n'));
});

reg('new_reel', 'New reel', 'Start a new reel: creates reels/<slug>/ with script.json, reel.html and score.js to fill in.', {
  slug: z.string().describe('short kebab-case name, e.g. octopus-hearts'),
  title: z.string(),
  style: z.string().optional().describe('a style pack from options'),
}, async ({ slug, title, style }) => {
  const s = String(slug).trim().toLowerCase();
  if (!SLUG.test(s)) throw new Error(`"${slug}": use lowercase letters, digits and dashes, starting with a letter or digit (up to 61 characters)`);
  if (fs.existsSync(path.join(REELS, s))) throw new Error(`reels/${s} already exists: pick another name, or work on it with read_file / edit_file`);
  if (style && !listStyles().some(x => x.name === style)) throw new Error(`no style pack "${style}". Packs: ${listStyles().map(x => x.name).join(', ')}`);
  const [cmd, a] = node('new.mjs', [s, String(title).slice(0, 120), ...(style ? ['--style', style] : [])]);
  const r = spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0 || !fs.existsSync(path.join(REELS, s, 'script.json'))) throw new Error(`couldn't create the reel: ${(r.stderr || r.stdout || '').trim()}`);
  return text(`✓ reels/${s}/ created: script.json, reel.html, score.js and assets/.\nNext: write reels/${s}/script.json (guide "script"), run voice, then write reel.html (guide "scenes"${style ? ` and "style:${style}"` : ''}).`);
});

reg('read_file', 'Read a reel file', 'Read a text file of a reel or series, e.g. reels/<slug>/script.json, reel.html, score.js, timeline.json, or series/<name>/plan.md.', {
  path: z.string(),
}, async ({ path: p }) => {
  const { abs, path: rp } = safePath(p);
  if (!fs.existsSync(abs)) throw new Error(`${rp} doesn't exist`);
  if (fs.statSync(abs).size > MAX_TEXT) throw new Error(`${rp} is over 1 MB`);
  return text(fs.readFileSync(abs, 'utf8'));
});

reg('write_file', 'Write a reel file', 'Create or replace a text file inside reels/<slug>/ or series/<name>/ (script.json, reel.html, score.js, plan.md…).', {
  path: z.string(), content: z.string(),
}, async ({ path: p, content }) => {
  const { abs, path: rp } = safePath(p);
  if (Buffer.byteLength(content) > MAX_TEXT) throw new Error('that is over 1 MB: keep reel files small and put pictures in assets with add_asset');
  if (rp.endsWith('.json')) { try { JSON.parse(content); } catch (e) { throw new Error(`${rp} isn't valid JSON: ${e.message}`); } }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const existed = fs.existsSync(abs);
  fs.writeFileSync(abs, content);
  return text(`✓ ${existed ? 'replaced' : 'wrote'} ${rp} (${Buffer.byteLength(content)} bytes)`);
});

reg('edit_file', 'Edit a reel file', 'Replace one exact piece of text in a reel or series file. old_text must appear exactly once.', {
  path: z.string(), old_text: z.string(), new_text: z.string(),
}, async ({ path: p, old_text, new_text }) => {
  const { abs, path: rp } = safePath(p);
  if (!fs.existsSync(abs)) throw new Error(`${rp} doesn't exist (write_file creates it)`);
  const raw = fs.readFileSync(abs, 'utf8'), crlf = raw.includes('\r\n');
  const body = raw.replace(/\r\n/g, '\n'), find = String(old_text).replace(/\r\n/g, '\n');
  if (!find) throw new Error('old_text is empty');
  const n = body.split(find).length - 1;
  if (n !== 1) throw new Error(n ? `old_text appears ${n} times in ${rp}: include more of the surrounding text so it appears once` : `old_text isn't in ${rp} (read_file shows what's there)`);
  let out = body.replace(find, () => String(new_text).replace(/\r\n/g, '\n'));
  if (rp.endsWith('.json')) { try { JSON.parse(out); } catch (e) { throw new Error(`that edit would make ${rp} invalid JSON: ${e.message}`); } }
  if (crlf) out = out.replace(/\n/g, '\r\n');
  fs.writeFileSync(abs, out);
  return text(`✓ edited ${rp}`);
});

reg('delete_file', 'Delete a reel file', 'Delete one file inside a reel or series (e.g. score.js when the person\'s own music.mp3 should be the only music, or an asset no longer used).', {
  path: z.string(),
}, async ({ path: p }) => {
  const { abs, path: rp } = safePath(p, { text: false });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`${rp} isn't a file`);
  if (/^reels\/[^/]+\/script\.json$|^series\/[^/]+\/series\.json$/.test(rp)) throw new Error(`${rp} holds the whole reel; it can't be deleted from here`);
  fs.rmSync(abs);
  return text(`✓ deleted ${rp}`);
});

reg('add_asset', 'Add a picture or sound', 'Copy a picture or sound into a reel, from a web link (https) or a file on this computer (e.g. ~/Desktop/beach.jpg). Name it music.mp3 for the person\'s own backing track. Videos go through add_footage.', {
  reel: z.string(), source: z.string().describe('https link, or the full path of a picture or sound file on this computer'),
  name: z.string().optional().describe('file name in assets/ (the extension is set from the file); "music" puts it in the reel as its music'),
}, async ({ reel, source, name }) => {
  const dir = reelPath(reel);
  let buf, from;
  if (isLink(source)) { buf = await download(source.trim(), MAX_MEDIA); from = source.trim(); }
  else if (/^\w+:/.test(String(source).trim()) && !/^file:\/\//.test(String(source).trim())) throw new Error('links must start with https://');
  else {
    const f = localFile(source);
    if (fs.statSync(f).size > MAX_MEDIA) throw new Error('that file is over 50 MB');
    buf = fs.readFileSync(f); from = f;
  }
  const kind = sniff(buf.subarray(0, 64));
  if (kind.kind === 'video') throw new Error('that is a video: use add_footage for videos');
  if (kind.kind === 'unsupported') throw new Error(kind.why);
  if (kind.kind !== 'image' && kind.kind !== 'audio') throw new Error(`${from} isn't a picture or a sound file (JPEG, PNG, GIF, WebP, AVIF, MP3, WAV, M4A, OGG or FLAC)`);
  let base = String(name || path.basename(from.split('?')[0]).replace(/\.[^.]+$/, '') || 'asset').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
  const music = base.toLowerCase() === 'music';
  if (music && kind.kind !== 'audio') throw new Error('music must be a sound file');
  const target = music ? path.join(dir, `music.${kind.ext === 'm4a' ? 'm4a' : kind.ext === 'wav' ? 'wav' : 'mp3'}`) : path.join(dir, 'assets', `${base}.${kind.ext}`);
  if (music && !['mp3', 'm4a', 'wav'].includes(kind.ext)) throw new Error('music has to be an MP3, M4A or WAV file');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  const r = rel(target), inReel = path.relative(dir, target).split(path.sep).join('/');
  return text(`✓ ${r} (${kind.kind}, ${mb(buf.length)})${music ? '. It plays under the voice; delete score.js (delete_file) if it should be the only music.' : `. Use it in reel.html as "${inReel}"${kind.kind === 'image' ? ' (photos move best as a depth photo: <canvas data-depth="' + inReel + '" data-move="push">)' : ''}.`}${from.startsWith('https') ? ' Credit the source in script.json "credits" if it needs one.' : ''}`);
});

reg('add_footage', 'Add footage', 'Bring a video into a reel: a talk (interview, talking head) with talk: true becomes one scene per sentence; without talk it lists the shots for clips. From an https link or a video file on this computer. Returns a job.', {
  reel: z.string(), source: z.string(), talk: z.boolean().optional(), name: z.string().optional(),
}, async ({ reel, source, talk, name }, extra) => {
  reelPath(reel);
  let src;
  if (isLink(source)) src = source.trim();
  else {
    const f = localFile(source); const k = sniff(head(f));
    if (k.kind !== 'video') throw new Error(`${f} isn't a video file (MP4, MOV, WebM)`);
    src = f;
  }
  const [cmd, a] = node('footage.mjs', [reel, src, ...(talk ? ['--talk'] : []), ...(name ? ['--name', String(name).replace(/[^a-zA-Z0-9-]+/g, '-')] : [])]);
  return follow(begin(`footage ${reel}`, cmd, a, { reel, kind: 'footage' }), FIRST_WAIT, extra);
});

reg('run', 'Run a step', `Run one of reelkit's steps on a reel: ${STEPS.join(', ')}. voice makes the narration and word timings; check lints and returns contact sheets to look at; draft/render make the MP4; score renders score.js alone; ship makes the cover, captions and draft post (needs a full render); depth/cutout prepare photos; clip trims footage. Waits up to 20 s, then returns a job to wait on.`, {
  reel: z.string(), step: z.enum(STEPS),
  opts: z.object({
    style: z.string().optional().describe('check/draft/render in another style pack'),
    from: z.number().optional(), to: z.number().optional(),
    cover: z.string().optional().describe('ship: the word (@word) or second the cover is taken from'),
    src: z.string().optional().describe('clip: the video inside the reel'), name: z.string().optional(),
  }).optional(),
}, async ({ reel, step, opts = {} }, extra) => {
  reelPath(reel);
  const [cmd, a] = stepCommand(reel, step, opts);
  return follow(begin(`${step} ${reel}`, cmd, a, { reel, kind: step, meta: { style: opts.style || null } }), FIRST_WAIT, extra);
});

reg('wait', 'Wait for a job', 'Wait (up to 25 s) for a job from run, setup, add_footage and so on. Call again while it says still working. more: true returns the remaining pictures of a finished check.', {
  job: z.string(), more: z.boolean().optional(),
}, async ({ job: id, more }, extra) => {
  const job = jobs.get(String(id));
  if (!job?.mcp) throw new Error(`no job "${id}" (jobs end when the app restarts reelkit; run the step again)`);
  if (more && !job.running) {
    if (!job.more?.length) return text('No more pictures for that job.');
    const { imgs, left } = pictures(job.more); job.more = left;
    return text(`More contact sheets${left.length ? ` (${left.length} still to come: call wait with more: true again)` : ''}:`, imgs);
  }
  return follow(job, WAIT, extra);
});

reg('stop', 'Stop a job', 'Stop a running job.', { job: z.string() }, async ({ job: id }) => {
  const job = jobs.get(String(id));
  if (!job?.mcp) throw new Error(`no job "${id}"`);
  if (!job.running) return text(`"${job.label}" had already finished.`);
  job.kill();
  for (let i = 0; i < 25 && job.running; i++) await sleep(200);
  return text(job.running ? `asked "${job.label}" to stop` : `✓ stopped "${job.label}"`);
});

reg('series_status', 'Series status', 'Which parts of a series exist and which are voiced, rendered and ready to post.', { name: z.string() }, async ({ name }) => {
  const n = seriesName(name);
  if (!n || !fs.existsSync(path.join(SERIES, n, 'series.json'))) throw new Error(`no series "${name}"`);
  const s = seriesStatus(n);
  return text(`${s.title || s.name}: ${s.parts.length} of ${s.count} parts${s.planned ? '' : ' (no plan.md yet)'}\n` + s.parts.map(p => `  ${p.part ?? '?'}. ${p.slug}  ${p.voiced ? 'voiced' : '·'}  ${p.rendered ? 'rendered' : '·'}  ${p.shipped ? 'ready to post' : '·'}  ${p.title}`).join('\n'));
});

reg('translate', 'Another language', `Copy a reel for another language (${Object.entries(LANGUAGES).map(([c, l]) => `${c} ${l.name}`).join(', ')}) with that language's free voice. Then translate it: guide "languages".`, {
  reel: z.string(), to: z.string(),
}, async ({ reel, to }) => {
  reelPath(reel);
  const r = translateCopy(reel, to);
  return text(`✓ reels/${r.name}/: a copy of ${reel} set up for ${LANGUAGES[r.lang].name}.${r.talk.length ? ` Scenes ${r.talk.join(', ')} are filmed speech and stay in ${LANGUAGES[r.from].name}.` : ''}\nNext, following guide "languages": translate every "say" in reels/${r.name}/script.json and all on-screen text and @word cues in reel.html, set "translated": true, then run voice, check, render and ship on ${r.name}.`);
});

reg('new_series', 'New series', 'Set up a series: several reels from one source, in one look and one voice. Then follow guide "series".', {
  name: z.string(), source: z.string().describe('the source as pasted text, or an https link to read'),
  count: z.number().int().min(2).max(10).optional(), style: z.string().optional(), voice: z.string().optional().describe('a saved voice name, or leave out for the free voice'),
}, async ({ name, source, count = 5, style, voice }) => {
  const src = String(source || '').trim();
  // only text or a link: createSeries would read a file at a path, and that isn't allowed from here
  const looksLikePath = !/\s/.test(src) && !isLink(src) && (/^[~/\\.]|^[a-zA-Z]:/.test(src) || fs.existsSync(path.resolve(ROOT, src)));
  if (looksLikePath || /^file:/i.test(src)) throw new Error('give the source as pasted text or an https link (files on this computer can\'t be read from here)');
  if (/^http:\/\//i.test(src)) throw new Error('links must start with https://');
  const { dir, series } = createSeries(name, { from: src, count, style: style || null, voice: voice || null });
  return text(`✓ ${rel(dir)}/: ${series.count} reels${series.style ? `, ${series.style} style` : ''}${series.voice ? `, voice "${series.voice}"` : ''}. The source is in ${rel(dir)}/source.txt (read_file).\nNext: guide "series": write ${rel(dir)}/plan.md, then make each part.`);
});

reg('show', 'Show the video', 'Open a reel\'s newest video in this computer\'s video player for the person, or, with at, return frames from it (seconds) as pictures for you to look at.', {
  reel: z.string(), at: z.array(z.number()).max(6).optional(),
}, async ({ reel, at }) => {
  reelPath(reel);
  const v = (reelInfo(reel)?.videos || [])[0];
  if (!v) throw new Error(`${reel} has no video yet: run render first`);
  const file = path.join(OUT, v);
  if (at?.length) {
    const d = duration(file);
    const imgs = at.map(t => Math.min(Math.max(0, +t), Math.max(0, d - 0.05))).map(t => frameAt(file, t)).filter(Boolean).map(image);
    return text(`Frames from out/${v} at ${at.join(', ')} s:`, imgs);
  }
  if (!process.env.REELKIT_NO_OPEN) {
    const [cmd, a] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['explorer.exe', [file]] : ['xdg-open', [file]];
    try { spawn(cmd, a, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch {}
  }
  return text(`Opened out/${v} (${duration(file).toFixed(1)} s) in the video player. It's at ${file}.`);
});

// ---------- run ----------
const transport = new StdioServerTransport();
const bye = () => { stopAllJobs(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} process.exit(0); };
process.stdin.on('end', bye); process.stdin.on('close', bye);
process.on('SIGTERM', bye); process.on('SIGINT', bye);
await server.connect(transport);
console.error(`reelkit MCP server ${VERSION} ready (${ROOT})`);
