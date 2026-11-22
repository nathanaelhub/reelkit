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
import { SLUG, reelInfo, listReels, jobs, startJob, stopAllJobs, node, ACTIONS } from './jobs.mjs';
import { serve, ROOT, REELS, OUT, readJSON, writeJSON, listStyles, which, parseArgs } from './lib.mjs';
import { listVoices, voiceName, PARAGRAPH, VOICES } from './myvoice.mjs';
import { createSeries, listSeries, seriesName, SERIES } from './series.mjs';
import { LANGUAGES, languageOf } from './languages.mjs';
import { translateCopy } from './translate.mjs';

const args = parseArgs();
const PORT = +(args.port || process.env.REELKIT_PORT || 4242);
process.env.REELKIT_JOB_FROM = 'reelkit studio';

// ---------- reels ----------
function slugFrom(text) {
  const stop = new Set(['a', 'an', 'the', 'about', 'make', 'reel', 'on', 'of', 'why', 'how', 'what', 'is', 'are', 'for', 'to', 'and', 'in', 'my', 'me', 'video', 'short']);
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w && !stop.has(w)).slice(0, 4);
  let base = words.join('-').slice(0, 40).replace(/-+$/, '') || 'reel', slug = base, n = 2;
  while (fs.existsSync(path.join(REELS, slug))) slug = `${base}-${n++}`;
  return slug;
}

// A reel's voice settings, switched between the free voice and a recorded one, keeping speed and the other settings.
function setVoice(v = {}, { provider, voice, exaggeration } = {}) {
  v = { ...(v || {}) };
  if (provider === 'chatterbox') {
    const name = voiceName(voice);
    if (!fs.existsSync(path.join(VOICES, `${name}.wav`))) throw new Error(`no voice called "${name}": record it first`);
    const ex = exaggeration == null ? (v.chatterbox?.exaggeration ?? 0.5) : Math.min(1, Math.max(0.25, +exaggeration));
    return { ...v, provider: 'chatterbox', chatterbox: { ...(v.chatterbox || {}), reference: `voices/${name}.wav`, exaggeration: ex } };
  }
  if (provider === 'kokoro') return { ...v, provider: 'kokoro', kokoro: v.kokoro || { voice: 'am_michael' } };
  throw new Error('provider must be "kokoro" or "chatterbox"');
}

// ---------- the agent (Claude Code, headless) ----------
const claudeBin = () => (process.env.REELKIT_NO_AGENT ? null : which('claude')); // REELKIT_NO_AGENT=1: tests
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
      agent: !!claudeBin(), languages: Object.entries(LANGUAGES).map(([code, l]) => ({ code, name: l.name })), voices: listVoices(), series: listSeries().map(({ name, title, count, parts }) => ({ name, title, count, parts: parts.length })), paragraph: PARAGRAPH,
      chatterbox: fs.existsSync(path.join(ROOT, 'models/transformers/onnx-community/chatterbox-ONNX/onnx/language_model_q4.onnx_data')), jobs: [...jobs.values()].map(j => ({ id: j.id, label: j.label, reel: j.reel, running: j.running, code: j.code })) });
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
    if (sub === '/translate' && req.method === 'POST') {
      // a copy in another language; the agent translates the lines, the on-screen text and the word cues, then renders
      const { to } = await jsonBody(req);
      if (!claudeBin()) return json(res, 400, { error: 'Translating needs the agent (Claude Code). Without it: npm run translate -- ' + slug + ' --to <language>, then ask another coding agent to "translate" the copy.' });
      let r; try { r = translateCopy(slug, to); } catch (e) { return json(res, 400, { error: e.message }); }
      const name = LANGUAGES[r.lang].name;
      const job = runAgent(`translate ${r.name}`, `Translate reels/${r.name} into ${name}. It is a copy of reels/${slug} (${LANGUAGES[r.from].name}), already set up with "language": "${r.lang}" and a ${name} voice. Follow "Another language" in .claude/skills/make-reel/SKILL.md: translate every "say", all on-screen text in reel.html and every @word cue, set "translated": true, then voice, check (look at the contact sheets), score if the reel has a score.js, and render.${r.talk.length ? ` Scenes ${r.talk.join(', ')} are filmed speech: leave their "say" as it is.` : ''} The user is waiting in the reelkit studio and can't answer questions: make sensible choices and finish.`, r.name);
      return json(res, 200, { job: job.id, slug: r.name, agent: true });
    }
    if (sub === '/voice' && req.method === 'PUT') {
      const { provider, voice, exaggeration } = await jsonBody(req);
      const script = readJSON(path.join(dir, 'script.json'));
      try { script.voice = setVoice(script.voice, { provider, voice, exaggeration }); } catch (e) { return json(res, 400, { error: e.message }); }
      writeJSON(path.join(dir, 'script.json'), script);
      return json(res, 200, { ok: true, voice: script.voice });
    }
    return json(res, 404, { error: 'unknown reel action' });
  }
  // ---------- voices ----------
  if (u === '/api/voices' && req.method === 'POST') {
    // a take from the studio's recorder: raw audio body, ?name=… ; checked and cleaned by myvoice.mjs (the paragraph must be heard)
    const q = new URL(req.url, 'http://x').searchParams, name = voiceName(q.get('name'));
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3' }[type];
    if (!ext) return json(res, 400, { error: `send a recording (audio/webm, ogg, mp4, wav or mpeg), not ${type || 'nothing'}` });
    const incoming = path.join(VOICES, '.incoming'); fs.mkdirSync(incoming, { recursive: true });
    const file = path.join(incoming, `${name}-${Date.now()}.${ext}`);
    const LIMIT = 20 << 20; let n = 0, tooBig = false;
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(file);
      w.on('error', reject); req.on('error', reject);
      req.on('data', c => {
        n += c.length;
        if (n > LIMIT) { if (!tooBig) { tooBig = true; w.destroy(); } return; } // keep reading, stop writing
        if (!w.write(c)) { req.pause(); w.once('drain', () => req.resume()); }
      });
      req.on('end', () => { if (tooBig) resolve(); else w.end(resolve); });
    });
    if (tooBig || !n) { fs.rmSync(file, { force: true }); return json(res, tooBig ? 413 : 400, { error: tooBig ? 'that recording is over 20 MB: keep it under 30 seconds' : 'the recording was empty' }); }
    const [cmd, a] = node('myvoice.mjs', ['add', file, '--studio', '--name', name]);
    const job = startJob(`save voice "${name}"`, cmd, a, { reel: `voice:${name}`, onEnd: () => fs.rmSync(file, { force: true }) });
    return json(res, 200, { job: job.id, name });
  }
  const vm = u.match(/^\/api\/voices\/([a-z0-9-]{1,30})(\/sample)?$/);
  if (vm) {
    const name = vm[1];
    if (!fs.existsSync(path.join(VOICES, `${name}.wav`))) return json(res, 404, { error: `no voice called "${name}"` });
    if (vm[2] && req.method === 'POST') {
      const [cmd, a] = node('myvoice.mjs', ['sample', name]);
      const job = startJob(`sample of "${name}"`, cmd, a, { reel: `voice:${name}` });
      return json(res, 200, { job: job.id });
    }
    if (!vm[2] && req.method === 'DELETE') {
      for (const ext of ['wav', 'json', 'sample.wav']) fs.rmSync(path.join(VOICES, `${name}.${ext}`), { force: true });
      const users = listReels().filter(r => { try { return (readJSON(path.join(REELS, r.slug, 'script.json')).voice?.chatterbox?.reference || '').endsWith(`voices/${name}.wav`); } catch { return false; } }).map(r => r.slug);
      return json(res, 200, { ok: true, stillUsedBy: users });
    }
    return json(res, 404, { error: 'unknown voice action' });
  }

  if (u === '/api/series' && req.method === 'POST') {
    // several reels from one source: set the series up, then the agent plans and makes every part
    const { source, count, style, voice } = await jsonBody(req);
    const src = String(source || '').trim();
    if (!src) return json(res, 400, { error: 'paste the source first: an article, notes, or a link' });
    if (!claudeBin()) return json(res, 400, { error: 'A series needs the agent (Claude Code) to plan and write the parts. Install it, or set one up with npm run series -- new and ask another coding agent to make it.' });
    const link = src.match(/^https?:\/\/\S+$/i);
    let base = seriesName(link ? new URL(src).pathname.split('/').filter(Boolean).pop() || new URL(src).hostname : src.split(/\s+/).slice(0, 4).join(' ')) || 'series';
    let name = base, n = 2; while (fs.existsSync(path.join(SERIES, name))) name = `${base}-${n++}`;
    const mine = voice && voice !== 'free' ? voiceName(String(voice).replace(/^mine:/, '')) : null;
    try { createSeries(name, { from: src, count: count ?? 5, style: style || null, voice: mine }); }
    catch (e) { return json(res, 400, { error: e.message }); }
    const job = runAgent(`series ${name}`, `Make the series in series/${name}: series.json has the count, style and voice; source.txt has the source. Follow "Making a series" in .claude/skills/make-reel/SKILL.md, taking every part through the check (look at the contact sheets), the final render and npm run ship. The user is waiting in the reelkit studio and can't answer questions: make sensible choices and finish every part.`, `series:${name}`);
    return json(res, 200, { job: job.id, name, agent: true });
  }

  if (u === '/api/make' && req.method === 'POST') {
    const { idea, style, format, blank, voice, language: lang } = await jsonBody(req);
    let language; try { language = languageOf(lang); } catch (e) { return json(res, 400, { error: e.message }); }
    const text = String(idea || '').trim();
    if (!text) return json(res, 400, { error: 'say what the reel is about first' });
    if (style && !listStyles().some(s => s.name === style)) return json(res, 400, { error: `unknown style "${style}"` });
    const mine = voice && voice !== 'free' ? voiceName(String(voice).replace(/^mine:/, '')) : null;
    if (mine && !fs.existsSync(path.join(VOICES, `${mine}.wav`))) return json(res, 400, { error: `no voice called "${mine}": record it first` });
    if (mine && language !== 'en') return json(res, 400, { error: `your own voice speaks English only for now: pick the free voice for a reel in ${LANGUAGES[language].name}` });
    const slug = slugFrom(text);
    // the scaffold gets the chosen voice as soon as it exists
    const giveVoice = () => {
      const sp = path.join(REELS, slug, 'script.json'); if (!fs.existsSync(sp) || (!mine && language === 'en')) return;
      const sc = readJSON(sp);
      if (mine) sc.voice = setVoice(sc.voice, { provider: 'chatterbox', voice: mine });
      if (language !== 'en') { sc.language = language; sc.voice = { ...sc.voice, provider: 'kokoro', kokoro: { voice: LANGUAGES[language].voices[0] } }; }
      writeJSON(sp, sc);
    };
    if (blank || !claudeBin()) {
      // no agent: scaffold, so the scenes can be written here and the HTML by hand or another agent
      const [cmd, a] = node('new.mjs', [slug, text.slice(0, 80), ...(style ? ['--style', style] : [])]);
      const job = startJob(`new ${slug}`, cmd, a, { reel: slug, onEnd: giveVoice });
      return json(res, 200, { job: job.id, slug, agent: false });
    }
    const job = runAgent(`make ${slug}`, `Make a reel: ${text}\nUse the folder name "${slug}" (npm run new -- ${slug} "<title>"${style ? ` --style ${style}` : ''}).${style ? ` Use the "${style}" style pack (read styles/${style}/rules.md).` : ''}${format && format !== '9:16' ? ` Format ${format}.` : ''} Follow .claude/skills/make-reel/SKILL.md from start to finish, including the check (look at the contact sheets) and the final render. ${mine ? ` Voice it in the user's own recorded voice: set "voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/${mine}.wav", "exaggeration": 0.5 } } in script.json (it's their voice, recorded with consent in the studio).` : ''}${language !== 'en' ? ` Write and voice it in ${LANGUAGES[language].name}: set "language": "${language}" in script.json and use the free voice ("voice": { "provider": "kokoro" }); every "say", the on-screen text and the @word cues are in ${LANGUAGES[language].name}.` : ''} The user is waiting in the reelkit studio and can't answer questions: make sensible choices and finish.`, slug);
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
process.on('SIGINT', () => { stopAllJobs(); process.exit(0); });
