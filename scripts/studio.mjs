#!/usr/bin/env node
// reelkit studio: the whole kit in a local web app.
//   npm start                 opens http://127.0.0.1:4242 in your browser
//   npm start -- --port 5000 --no-open
//
// Make a reel from one line (the agent does it, if Claude Code is installed), bring footage, edit what's said, give
// notes, and run voice / check / render with the log streaming in. It only listens on 127.0.0.1 and only accepts
// requests from its own page.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serve, ROOT, REELS, OUT, readJSON, writeJSON, listStyles, which, parseArgs } from './lib.mjs';

const args = parseArgs();
const PORT = +(args.port || process.env.REELKIT_PORT || 4242);
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

// ---------- reels ----------
function reelInfo(slug) {
  const dir = path.join(REELS, slug);
  const sp = path.join(dir, 'script.json'), tp = path.join(dir, 'timeline.json');
  if (!fs.existsSync(sp)) return null;
  let script = {}; try { script = readJSON(sp); } catch { script = { title: slug, broken: true }; }
  const tl = fs.existsSync(tp) ? (() => { try { return readJSON(tp); } catch { return null; } })() : null;
  const outs = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.startsWith(slug + '.') || f === slug + '.mp4') : [];
  const videos = outs.filter(f => f.endsWith('.mp4')).map(f => ({ file: f, mtime: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  const sheets = outs.filter(f => /\.check-\d+\.png$/.test(f) && f.startsWith(slug + '.check-')).sort();
  const mtime = Math.max(fs.statSync(sp).mtimeMs, ...videos.map(v => v.mtime));
  return {
    slug, title: script.title || slug, style: script.style || null, theme: script.theme || null, format: script.format || '9:16',
    scenes: (script.scenes || []).length, duration: tl?.duration ?? null, voiced: !!tl,
    hasHtml: fs.existsSync(path.join(dir, 'reel.html')), videos: videos.map(v => v.file), sheets, mtime, footage: (script.scenes || []).some(s => s.footage),
  };
}
const listReels = () => (fs.existsSync(REELS) ? fs.readdirSync(REELS) : [])
  .filter(d => SLUG.test(d) && !d.startsWith('_')).map(reelInfo).filter(Boolean).sort((a, b) => b.mtime - a.mtime);

function slugFrom(text) {
  const stop = new Set(['a', 'an', 'the', 'about', 'make', 'reel', 'on', 'of', 'why', 'how', 'what', 'is', 'are', 'for', 'to', 'and', 'in', 'my', 'me', 'video', 'short']);
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w && !stop.has(w)).slice(0, 4);
  let base = words.join('-').slice(0, 40).replace(/-+$/, '') || 'reel', slug = base, n = 2;
  while (fs.existsSync(path.join(REELS, slug))) slug = `${base}-${n++}`;
  return slug;
}

// ---------- jobs: one process each, output kept and streamed ----------
const jobs = new Map(); let jobSeq = 0;
function startJob(label, cmd, cmdArgs, { reel = null, parse = null } = {}) {
  const busy = reel && [...jobs.values()].find(j => j.reel === reel && j.running);
  if (busy) throw new Error(`"${busy.label}" is still running for ${reel}`);
  const id = String(++jobSeq);
  const job = { id, label, reel, lines: [], running: true, code: null, listeners: new Set(), started: Date.now() };
  const push = line => { job.lines.push(line); if (job.lines.length > 4000) job.lines.shift(); for (const l of job.listeners) l('line', line); };
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' }, shell: process.platform === 'win32' && cmd !== process.execPath });
  job.kill = () => { try { child.kill(); } catch {} };
  const onData = stream => { let buf = ''; stream.setEncoding('utf8'); stream.on('data', d => {
    buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop();
    for (const p of parts) { const out = parse ? parse(p) : p; if (out != null && out !== '') String(out).split('\n').forEach(push); }
  }); stream.on('end', () => { if (buf) { const out = parse ? parse(buf) : buf; if (out) push(String(out)); } }); };
  onData(child.stdout); onData(child.stderr);
  child.on('error', e => push(`✗ ${e.message}`));
  child.on('close', code => { job.running = false; job.code = code; push(code === 0 ? '✓ done' : `✗ stopped (exit ${code})`); for (const l of job.listeners) l('end', code); });
  jobs.set(id, job);
  return job;
}
const node = (script, a) => [process.execPath, [path.join('scripts', script), ...a]];
const ACTIONS = {
  voice: slug => node('voice.mjs', [slug]),
  check: slug => node('check.mjs', [slug]),
  draft: slug => node('render.mjs', [slug, '--draft']),
  render: slug => node('render.mjs', [slug]),
  score: slug => node('score.mjs', [slug]),
};

// ---------- the agent (Claude Code, headless) ----------
const claudeBin = () => which('claude');
// stream-json events → readable log lines
function agentLine(raw) {
  let ev; try { ev = JSON.parse(raw); } catch { return raw; }
  if (ev.type === 'assistant' && ev.message?.content) {
    return ev.message.content.map(c => {
      if (c.type === 'text') return c.text.trim();
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const what = i.command || i.file_path || i.pattern || i.url || i.query || i.description || '';
        return `  ▸ ${c.name}${what ? ': ' + String(what).split('\n')[0].slice(0, 160) : ''}`;
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  // a tool the agent wasn't allowed to use, or one that failed: show it, or the log hides why a step was skipped
  if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
    const errs = ev.message.content.filter(c => c.type === 'tool_result' && c.is_error)
      .map(c => (Array.isArray(c.content) ? c.content.map(x => x.text || '').join(' ') : String(c.content || '')).split('\n')[0].slice(0, 200));
    return errs.length ? errs.map(e => `  ✗ ${e}`).join('\n') : null;
  }
  if (ev.type === 'result') return ev.is_error ? `✗ agent: ${ev.result || ev.subtype}` : `agent finished${ev.total_cost_usd != null ? ` (cost $${ev.total_cost_usd.toFixed(2)})` : ''}`;
  return null;
}
function runAgent(label, prompt, reel) {
  const bin = claudeBin();
  if (!bin) throw new Error('Claude Code is not installed, so the agent can\'t build scenes. Install it from claude.com/claude-code, or open this folder in another coding agent (see AGENTS.md).');
  return startJob(label, bin, ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(npm run:*)', 'Bash(node scripts/:*)', 'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(ffmpeg:*)', 'Bash(ffprobe:*)',
    'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'ToolSearch'],
    { reel, parse: agentLine });
}

// ---------- HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); return true; };
const body = (req, limit = 1 << 20) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('request too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
const jsonBody = async req => { const b = await body(req); try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw new Error('body is not JSON'); } };

async function api(req, res, u) {
  // only this machine's own pages: the Host must be localhost (no DNS rebinding), and anything that changes something
  // needs a custom header, which a page on another site can't send here (no cross-site form posts)
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(res, 403, { error: 'wrong host' });
  if (u === '/' || u === '/studio') { res.writeHead(302, { Location: '/studio/index.html' }); res.end(); return true; }
  if (!u.startsWith('/api/')) return false;
  if (req.method !== 'GET' && req.headers['x-reelkit'] !== '1') return json(res, 403, { error: 'missing X-Reelkit header' });

  const m = u.match(/^\/api\/reels\/([^/]+)(\/[a-z]+)?$/);
  if (u === '/api/state' && req.method === 'GET') {
    return json(res, 200, { reels: listReels(), styles: listStyles().map(({ name, title, description, swatch }) => ({ name, title, description, swatch })),
      agent: !!claudeBin(), jobs: [...jobs.values()].map(j => ({ id: j.id, label: j.label, reel: j.reel, running: j.running, code: j.code })) });
  }
  if (m) {
    const slug = m[1], sub = m[2] || '';
    if (!SLUG.test(slug) || !fs.existsSync(path.join(REELS, slug, 'script.json'))) return json(res, 404, { error: `no reel "${slug}"` });
    const dir = path.join(REELS, slug);
    if (sub === '' && req.method === 'GET') return json(res, 200, { ...reelInfo(slug), script: readJSON(path.join(dir, 'script.json')) });
    if (sub === '/script' && req.method === 'PUT') {
      const { script } = await jsonBody(req);
      if (!script || !Array.isArray(script.scenes) || script.scenes.some(s => !s.id || typeof s.say !== 'string')) return json(res, 400, { error: 'script needs scenes with id and say' });
      writeJSON(path.join(dir, 'script.json'), script);
      return json(res, 200, { ok: true });
    }
    if (sub === '/run' && req.method === 'POST') {
      const { action } = await jsonBody(req);
      if (!ACTIONS[action]) return json(res, 400, { error: `unknown action "${action}"` });
      const [cmd, a] = ACTIONS[action](slug);
      const job = startJob(`${action} ${slug}`, cmd, a, { reel: slug });
      return json(res, 200, { job: job.id });
    }
    if (sub === '/notes' && req.method === 'POST') {
      const { note } = await jsonBody(req);
      if (!note || !String(note).trim()) return json(res, 400, { error: 'write a note first' });
      const job = runAgent(`notes for ${slug}`, `The user's notes on the reel in reels/${slug}: "${String(note).trim()}". Follow .claude/skills/make-reel/SKILL.md, step 7 (feedback loop): change only what the notes ask for, re-voice only changed scenes, run npm run check -- ${slug} and look at the contact sheets, then npm run render -- ${slug}. Don't ask questions; make sensible choices and say what you changed in one short paragraph.`, slug);
      return json(res, 200, { job: job.id });
    }
    if (sub === '/footage' && req.method === 'POST') {
      // raw file body; ?name=… ; then npm run footage -- <slug> <file> --talk
      const q = new URL(req.url, 'http://x').searchParams;
      const name = String(q.get('name') || 'clip.mp4').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+/, '') || 'clip.mp4';
      if (!/\.(mp4|mov|m4v|webm|mkv)$/i.test(name)) return json(res, 400, { error: 'send a video file (mp4, mov, m4v, webm or mkv)' });
      const fdir = path.join(dir, 'footage', 'in'); fs.mkdirSync(fdir, { recursive: true });
      const file = path.join(fdir, name);
      await new Promise((resolve, reject) => { const w = fs.createWriteStream(file); req.pipe(w); w.on('finish', resolve); w.on('error', reject); req.on('error', reject); });
      if (!fs.statSync(file).size) return json(res, 400, { error: 'the upload was empty' });
      const [cmd, a] = node('footage.mjs', [slug, path.relative(ROOT, file), ...(q.get('talk') === '1' ? ['--talk'] : [])]);
      const job = startJob(`footage ${slug}`, cmd, a, { reel: slug });
      return json(res, 200, { job: job.id });
    }
    return json(res, 404, { error: 'unknown reel action' });
  }
  if (u === '/api/make' && req.method === 'POST') {
    const { idea, style, format, blank } = await jsonBody(req);
    const text = String(idea || '').trim();
    if (!text) return json(res, 400, { error: 'say what the reel is about first' });
    if (style && !listStyles().some(s => s.name === style)) return json(res, 400, { error: `unknown style "${style}"` });
    const slug = slugFrom(text);
    if (blank || !claudeBin()) {
      // no agent: scaffold, so the scenes can be written here and the HTML by hand or another agent
      const [cmd, a] = node('new.mjs', [slug, text.slice(0, 80), ...(style ? ['--style', style] : [])]);
      const job = startJob(`new ${slug}`, cmd, a, { reel: slug });
      return json(res, 200, { job: job.id, slug, agent: false });
    }
    const job = runAgent(`make ${slug}`, `Make a reel: ${text}\nUse the folder name "${slug}" (npm run new -- ${slug} "<title>"${style ? ` --style ${style}` : ''}).${style ? ` Use the "${style}" style pack (read styles/${style}/rules.md).` : ''}${format && format !== '9:16' ? ` Format ${format}.` : ''} Follow .claude/skills/make-reel/SKILL.md from start to finish, including the check (look at the contact sheets) and the final render. The user is waiting in the reelkit studio and can't answer questions: make sensible choices and finish.`, slug);
    return json(res, 200, { job: job.id, slug, agent: true });
  }
  const jm = u.match(/^\/api\/jobs\/(\d+)(\/stream|\/stop)?$/);
  if (jm) {
    const job = jobs.get(jm[1]); if (!job) return json(res, 404, { error: 'no such job' });
    if (jm[2] === '/stop' && req.method === 'POST') { job.kill(); return json(res, 200, { ok: true }); }
    if (jm[2] === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      job.lines.forEach(l => send('line', l));
      if (!job.running) { send('end', job.code); res.end(); return true; }
      const l = (ev, data) => { send(ev, data); if (ev === 'end') res.end(); };
      job.listeners.add(l); req.on('close', () => job.listeners.delete(l));
      return true;
    }
    return json(res, 200, { id: job.id, label: job.label, running: job.running, code: job.code, lines: job.lines });
  }
  return json(res, 404, { error: 'unknown API route' });
}

const server = await serve(PORT, api).catch(e => { console.error(`\n✗ can't listen on port ${PORT}: ${e.code || e.message}. Try: npm start -- --port 5000\n`); process.exit(1); });
const url = server.url('studio/index.html');
console.log(`\n▸ reelkit studio: ${url}\n  agent: ${claudeBin() ? 'Claude Code found, "Make it" builds whole reels' : 'Claude Code not found; you can still voice, check and render, and edit what is said'}\n  Ctrl+C to stop\n`);
if (!args['no-open']) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(opener, process.platform === 'win32' ? ['""', url] : [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch {}
}
process.on('SIGINT', () => { for (const j of jobs.values()) if (j.running) j.kill(); process.exit(0); });
