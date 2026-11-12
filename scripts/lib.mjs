// Shared helpers for reelkit scripts.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REELS = path.join(ROOT, 'reels');
export const OUT = path.join(ROOT, 'out');

// ---- .env (no dependency) ----
export function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// ---- args ----
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function reelDir(name) {
  if (!name) {
    const all = fs.existsSync(REELS) ? fs.readdirSync(REELS).filter(d => fs.existsSync(path.join(REELS, d, 'script.json'))) : [];
    if (all.length === 1) return path.join(REELS, all[0]);
    die(`Which reel? Pass its folder name. Available: ${all.join(', ') || '(none — run npm run new -- <name>)'}`);
  }
  const d = path.isAbsolute(name) ? name : path.join(REELS, name.replace(/^reels[\\/]/, ''));
  if (!fs.existsSync(d)) die(`No reel folder at ${path.relative(ROOT, d)}`);
  return d;
}

// style packs: styles/<name>/style.json + style.css (+ style.js, rules.md)
export const STYLES = path.join(ROOT, 'styles');
export function listStyles() {
  if (!fs.existsSync(STYLES)) return [];
  return fs.readdirSync(STYLES).filter(d => fs.existsSync(path.join(STYLES, d, 'style.css'))).sort()
    .map(name => ({ name, ...(fs.existsSync(path.join(STYLES, name, 'style.json')) ? JSON.parse(fs.readFileSync(path.join(STYLES, name, 'style.json'), 'utf8')) : {}) }));
}
export function checkStyle(name) {
  if (!name) return null;
  const all = listStyles().map(s => s.name);
  if (!all.includes(name)) die(`unknown style "${name}". Style packs: ${all.join(', ') || '(none)'}`);
  return name;
}

export function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }
export const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJSON = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

// ---- ffmpeg: prefer system, fall back to the npm static build ----
function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
// A bundled binary is only returned if it actually runs: a wrong-architecture build (an x86 binary on an Apple
// Silicon Mac without Rosetta) exists on disk but fails with "bad CPU type".
const runs = new Map();
function works(bin) {
  if (!runs.has(bin)) runs.set(bin, spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0);
  return runs.get(bin);
}
export function ffmpegPath() {
  const sys = which('ffmpeg'); if (sys) return sys;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p) && works(p)) return p; } catch {}
  return null;
}
export function ffprobePath() {
  const sys = which('ffprobe'); if (sys) return sys;
  try { const p = require('@ffprobe-installer/ffprobe').path; if (p && fs.existsSync(p) && works(p)) return p; } catch {}
  return null;
}
export { which };

// Every tool call gets a time limit (REELKIT_TOOL_TIMEOUT seconds, default 600) and FFmpeg never reads stdin, so a
// stuck call fails with its command line instead of hanging the whole run.
export const TOOL_TIMEOUT = +(process.env.REELKIT_TOOL_TIMEOUT || 600) * 1000;
export function run(bin, args, opts = {}) {
  if (/^ffmpeg/i.test(path.basename(bin)) && !args.includes('-nostdin')) args = ['-nostdin', ...args];
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: TOOL_TIMEOUT, killSignal: 'SIGKILL', ...opts });
  if (r.error && r.error.code === 'ETIMEDOUT') throw new Error(`${path.basename(bin)} took longer than ${TOOL_TIMEOUT / 1000} s and was stopped: ${path.basename(bin)} ${args.join(' ').slice(0, 600)}`);
  if (r.status !== 0) throw new Error(`${path.basename(bin)} ${args.slice(0, 6).join(' ')} … failed:\n${(r.stderr || '').slice(-1500)}`);
  return r.stdout;
}

export function mediaDuration(file) {
  const out = run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return parseFloat(out.trim());
}

// ---- tiny static server rooted at the repo, so reel.html can load ../../engine and node_modules ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };
// `handler(req, res, pathname)` (optional) answers first and returns true if it handled the request (the studio's API).
// Dotfiles and dot-folders (.env, .git, .voice-cache) are never served.
export function serve(port = 0, handler = null) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      let u;
      try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end('bad url'); return; }
      if (handler) { try { if (await handler(req, res, u)) return; } catch (e) { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); return; } }
      const f = path.normalize(path.join(ROOT, u));
      if (!f.startsWith(ROOT) || path.relative(ROOT, f).split(path.sep).some(seg => seg.startsWith('.')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      const stat = fs.statSync(f);
      const type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) { // audio seeking in preview
        const [a, b] = range.replace('bytes=', '').split('-'); const start = +a, end = b ? +b : stat.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
        fs.createReadStream(f, { start, end }).pipe(res); return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, url: p => `http://127.0.0.1:${srv.address().port}/${p}` }));
  });
}

export function reelURL(server, dir, query = '') {
  const rel = path.relative(ROOT, path.join(dir, 'reel.html')).split(path.sep).join('/');
  return server.url(rel) + query;
}

// Open the reel page in headless Chromium, wait for kit.js to be ready.
export async function openReel(dir, { scale = 1, style = null } = {}) {
  if (!fs.existsSync(path.join(dir, 'timeline.json'))) die(`No timeline.json in ${path.relative(ROOT, dir)}. Run: npm run voice -- ${path.basename(dir)}`);
  if (!fs.existsSync(path.join(dir, 'reel.html'))) die(`No reel.html in ${path.relative(ROOT, dir)}.`);
  const { chromium } = await import('playwright');
  const server = await serve();
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { server.srv.close(); die(`Chromium is not installed for Playwright. Run: npx playwright install chromium\n${e.message.split('\n')[0]}`); }
  const { width = 1080, height = 1920 } = readJSON(path.join(dir, 'timeline.json'));
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => {
    // Chromium cancels its first request for a <video> and re-requests it in byte ranges; that cancel is normal.
    // A missing clip is a 404 response instead, reported by kit.js through the video's error event.
    if (r.resourceType() === 'media' && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`failed to load ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\//, '')}`);
  });
  await page.goto(reelURL(server, dir, '?render=1' + (style ? `&style=${encodeURIComponent(style)}` : '')), { waitUntil: 'load' });
  const ok = await page.waitForFunction(() => window.__reel && (window.__reel.error || window.__reel.ready), null, { timeout: 30000 }).then(() => page.evaluate(async () => { if (window.__reel.error) return window.__reel.error; await window.__reel.ready; return window.__reel.error || true; })).catch(e => e.message);
  if (ok !== true) { await browser.close(); server.srv.close(); die(`reel.html failed to start: ${ok}\n${errors.join('\n')}`); }
  const close = async () => { await browser.close(); server.srv.close(); };
  return { page, browser, server, close, errors };
}
