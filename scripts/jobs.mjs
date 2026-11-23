// Jobs and reel status, shared by reelkit studio (scripts/studio.mjs) and the MCP server (scripts/mcp-server.mjs).
// A job is one process (voice, check, render, …) whose output is kept and can be streamed. Only one job runs per reel
// at a time, across every studio and AI app on this computer: a running job leaves reels/<slug>/.job.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, REELS, OUT, readJSON } from './lib.mjs';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

// ---------- reels ----------
export function reelInfo(slug) {
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
    ship: shipInfo(slug), series: script.series || null, language: script.language || 'en', translated: script.translated ?? null,
  };
}
export const listReels = () => (fs.existsSync(REELS) ? fs.readdirSync(REELS) : [])
  .filter(d => SLUG.test(d) && !d.startsWith('_')).map(reelInfo).filter(Boolean).sort((a, b) => b.mtime - a.mtime);

// what npm run ship made for this reel (out/<slug>.ship/)
export function shipInfo(slug) {
  const d = path.join(OUT, `${slug}.ship`);
  if (!fs.existsSync(path.join(d, 'checks.txt'))) return null;
  const read = f => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : '');
  return { dir: `out/${slug}.ship`, post: read('post.txt'), checks: read('checks.txt'), at: fs.statSync(path.join(d, 'checks.txt')).mtimeMs };
}

// ---------- the lock: reels/<slug>/.job while a job runs on that reel ----------
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lockFile = reel => (reel && SLUG.test(reel) && fs.existsSync(path.join(REELS, reel)) ? path.join(REELS, reel, '.job') : null);
export function reelLock(reel) {
  const f = lockFile(reel); if (!f || !fs.existsSync(f)) return null;
  let l; try { l = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  if (!l.pid || !alive(l.pid)) { fs.rmSync(f, { force: true }); return null; } // left behind by a crash: free
  return l;
}

// ---------- jobs: one process each, output kept and streamed ----------
export const jobs = new Map(); let jobSeq = 0;

// Stop a process and everything it started (Chromium, ffmpeg): its process group, or taskkill /T on Windows.
function killTree(child) {
  if (!child.pid || child.exitCode != null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} } }
}

export function startJob(label, cmd, cmdArgs, { reel = null, parse = null, onEnd = null, env = {} } = {}) {
  const busy = reel && [...jobs.values()].find(j => j.reel === reel && j.running);
  if (busy) throw new Error(`"${busy.label}" is still running for ${reel}`);
  const other = reelLock(reel);
  if (other) throw new Error(`"${other.label}" is still running for ${reel} (started from ${other.from || 'another window'})`);
  const id = String(++jobSeq);
  const job = { id, label, reel, lines: [], running: true, code: null, listeners: new Set(), started: Date.now() };
  const push = line => { job.lines.push(line); if (job.lines.length > 4000) job.lines.shift(); for (const l of job.listeners) l('line', line); };
  // its own process group (not on Windows), so stopping it also stops what it started
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', ...env }, shell: process.platform === 'win32' && cmd !== process.execPath,
    detached: process.platform !== 'win32', windowsHide: true });
  job.kill = () => killTree(child);
  const lock = lockFile(reel);
  if (lock && child.pid) fs.writeFileSync(lock, JSON.stringify({ pid: child.pid, label, from: process.env.REELKIT_JOB_FROM || path.basename(process.argv[1] || 'reelkit'), started: job.started }));
  const onData = stream => { let buf = ''; stream.setEncoding('utf8'); stream.on('data', d => {
    buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop();
    for (const p of parts) { const out = parse ? parse(p) : p; if (out != null && out !== '') String(out).split('\n').forEach(push); }
  }); stream.on('end', () => { if (buf) { const out = parse ? parse(buf) : buf; if (out) push(String(out)); } }); };
  onData(child.stdout); onData(child.stderr);
  child.on('error', e => push(`✗ ${e.message}`));
  child.on('close', code => {
    if (lock) { try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === child.pid) fs.rmSync(lock, { force: true }); } catch {} }
    try { onEnd?.(code); } catch (e) { job.lines.push(`✗ ${e.message}`); }
    job.running = false; job.code = code; push(code === 0 ? '✓ done' : `✗ stopped (exit ${code})`); for (const l of job.listeners) l('end', code);
  });
  jobs.set(id, job);
  return job;
}
export const stopAllJobs = () => { for (const j of jobs.values()) if (j.running) j.kill(); };

export const node = (script, a) => [process.execPath, [path.join('scripts', script), ...a]];
export const ACTIONS = {
  voice: slug => node('voice.mjs', [slug]),
  check: slug => node('check.mjs', [slug]),
  draft: slug => node('render.mjs', [slug, '--draft']),
  render: slug => node('render.mjs', [slug]),
  score: slug => node('score.mjs', [slug]),
  ship: slug => node('ship.mjs', [slug]),
};
