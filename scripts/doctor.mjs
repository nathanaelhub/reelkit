#!/usr/bin/env node
// Check (and with --fix, install) everything reelkit needs.
//   npm run doctor            report
//   npm run doctor -- --fix   install what's missing (npm deps, Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, parseArgs, which } from './lib.mjs';

const args = parseArgs();
const fix = !!args.fix;
const rows = [];
const ok = (name, detail) => rows.push(['✓', name, detail]);
const bad = (name, detail, how) => rows.push(['✗', name, detail + (how ? `\n      fix: ${how}` : '')]);
const meh = (name, detail) => rows.push(['·', name, detail]);
const sh = (cmd, a) => spawnSync(cmd, a, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

// node
const major = +process.versions.node.split('.')[0];
major >= 18 ? ok('Node.js', 'v' + process.versions.node) : bad('Node.js', `v${process.versions.node} is too old`, 'install Node 20+ from nodejs.org');

// npm deps
const need = ['playwright', 'ffmpeg-static', 'sherpa-onnx-node', '@huggingface/transformers', '@fontsource/inter', '@fontsource/anton', '@fontsource/instrument-serif'];
let missing = need.filter(d => !fs.existsSync(path.join(ROOT, 'node_modules', d)));
if (missing.length && fix) { console.log('▸ npm install'); sh('npm', ['install', '--no-audit', '--no-fund']); missing = need.filter(d => !fs.existsSync(path.join(ROOT, 'node_modules', d))); }
missing.length ? bad('npm packages', 'missing ' + missing.join(', '), 'npm install') : ok('npm packages', need.length + ' installed');

// chromium
let chromiumOK = false;
if (!missing.includes('playwright')) {
  const tryLaunch = async () => { const { chromium } = await import('playwright'); const b = await chromium.launch(); await b.close(); };
  try { await tryLaunch(); chromiumOK = true; }
  catch (e) {
    if (fix) { console.log('▸ npx playwright install chromium'); sh('npx', ['playwright', 'install', 'chromium']); try { await tryLaunch(); chromiumOK = true; } catch {} }
  }
  chromiumOK ? ok('Chromium (animate)', 'headless browser launches') : bad('Chromium (animate)', 'Playwright browser not installed', 'npx playwright install chromium');
}

// ffmpeg
const { ffmpegPath, ffprobePath } = await import('./lib.mjs');
const ff = ffmpegPath(), fp = ffprobePath();
if (ff && fp) {
  const v = spawnSync(ff, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0].split(' ')[2];
  ok('ffmpeg (render)', `${v}${ff.includes('node_modules') ? ' (bundled)' : ''}`);
} else bad('ffmpeg (render)', `${ff ? '' : 'ffmpeg '}${fp ? '' : 'ffprobe '}not found`, process.platform === 'darwin' ? 'brew install ffmpeg   (or npm install for the bundled one)' : 'install ffmpeg, or npm install for the bundled one');

// voice
const speech = await import('./speech.mjs');
if (!speech.kokoroInstalled() && fix && speech.sherpaInstalled()) {
  try { await speech.installKokoro(); } catch (e) { console.log(`  Kokoro download failed: ${e.message}`); }
}
const voices = [];
if (process.env.ELEVENLABS_API_KEY) voices.push('elevenlabs');
if (process.env.OPENAI_API_KEY) voices.push('openai');
if (speech.sherpaInstalled() && speech.kokoroInstalled()) voices.push('kokoro');
if (process.env.PIPER_MODEL && which('piper')) voices.push('piper');
if (process.platform === 'darwin' && which('say')) voices.push('say (macOS)');
if (voices.length) ok('Voice', voices.join(', ') + `  → default: ${voices[0]}`);
else bad('Voice', 'no voice provider found; reels will be silent drafts', 'npm run doctor -- --fix downloads the free Kokoro voice, or add ELEVENLABS_API_KEY / OPENAI_API_KEY to .env');
if (speech.kokoroInstalled()) ok('Kokoro (free voice)', 'local, Apache-2.0, safe for published reels');
else meh('Kokoro (free voice)', 'not downloaded; npm run doctor -- --fix gets it (~130 MB)');
if (voices[0] === 'say (macOS)') meh('Voice licence', "Apple licenses the macOS voices for personal, non-commercial use: don't publish or sell reels voiced with say");
if (voices.includes('piper')) meh('Voice licence', "many Piper voices (all Lessac-based ones) are non-commercial: check your voice's MODEL_CARD before publishing");
let whisper = false; try { await import('@huggingface/transformers'); whisper = true; } catch {}
whisper ? ok('Word timing (Whisper)', 'local; aligns captions for every voice (model downloads on first use)') : meh('Word timing (Whisper)', 'not installed: npm install; timings will be estimated');

// footage: face tracking for reframing interviews (data-reframe="face")
const faces = await import('./faces.mjs');
if (!faces.faceModelInstalled() && fix) { try { await faces.installFaceModel(); } catch (e) { console.log(`  face model download failed: ${e.message}`); } }
let mediapipe = false; try { await import('@mediapipe/tasks-vision'); mediapipe = true; } catch {}
if (mediapipe && faces.faceModelInstalled()) ok('Face reframing', 'MediaPipe BlazeFace, local, Apache-2.0');
else meh('Face reframing', mediapipe ? 'face model not downloaded yet (npm run doctor -- --fix, 230 KB; or it downloads on first use)' : 'not installed: npm install');
if (!process.env.ELEVENLABS_API_KEY) meh('ElevenLabs key', 'optional; most expressive voice. Get one at elevenlabs.io → put ELEVENLABS_API_KEY=... in .env');

// yt-dlp (optional: downloads reference videos for npm run ref)
which('yt-dlp') ? ok('yt-dlp (references)', 'installed') : meh('yt-dlp (references)', 'optional; needed to download reference links: brew install yt-dlp (or pip install yt-dlp)');

// .env
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  if (fix && fs.existsSync(path.join(ROOT, '.env.example'))) { fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env')); ok('.env', 'created from .env.example, add your keys there'); }
  else meh('.env', 'not created yet (cp .env.example .env)');
}

console.log('\nreelkit setup check\n');
for (const [s, n, d] of rows) console.log(`  ${s} ${n.padEnd(22)} ${d}`);
const failed = rows.filter(r => r[0] === '✗' && r[1] !== 'Voice');
console.log(failed.length ? `\n  ${failed.length} thing(s) to fix${fix ? '' : '. Run: npm run doctor -- --fix'}\n` : '\n  ready to make reels\n');
process.exit(failed.length ? 1 : 0);
