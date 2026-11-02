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
const need = ['playwright', 'ffmpeg-static', '@fontsource/inter', '@fontsource/anton', '@fontsource/instrument-serif'];
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
const voices = [];
if (process.env.ELEVENLABS_API_KEY) voices.push('elevenlabs');
if (process.env.OPENAI_API_KEY) voices.push('openai');
if (process.platform === 'darwin' && which('say')) voices.push('say (macOS)');
if (process.env.PIPER_MODEL && which('piper')) voices.push('piper');
if (voices.length) ok('Voice', voices.join(', ') + `  → default: ${voices[0]}`);
else bad('Voice', 'no voice provider found; reels will be silent drafts', 'add ELEVENLABS_API_KEY=... or OPENAI_API_KEY=... to .env, or install piper-tts and set PIPER_MODEL');
if (!process.env.ELEVENLABS_API_KEY) meh('ElevenLabs key', 'optional; best voice + exact word timing. Get one at elevenlabs.io → put ELEVENLABS_API_KEY=... in .env');

// .env
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  if (fix && fs.existsSync(path.join(ROOT, '.env.example'))) { fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env')); ok('.env', 'created from .env.example, add your keys there'); }
  else meh('.env', 'not created yet (cp .env.example .env)');
}

console.log('\nreelkit setup check\n');
for (const [s, n, d] of rows) console.log(`  ${s} ${n.padEnd(20)} ${d}`);
const failed = rows.filter(r => r[0] === '✗' && r[1] !== 'Voice');
console.log(failed.length ? `\n  ${failed.length} thing(s) to fix${fix ? '' : '. Run: npm run doctor -- --fix'}\n` : '\n  ready to make reels\n');
process.exit(failed.length ? 1 : 0);
