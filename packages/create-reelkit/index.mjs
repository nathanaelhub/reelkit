#!/usr/bin/env node
// npm create reelkit [folder] [--ref <tag|branch>] [--no-start] [--skip-setup]
// Downloads a reelkit release (no git needed), installs it, runs its setup (voice, browser, FFmpeg) and opens the studio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const REPO = 'nathanaelhub/reelkit';
const win = process.platform === 'win32';
const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ref');
const say = m => console.log(m), step = m => console.log(`\n▸ ${m}`);
const fail = (m, code = 1) => { console.error(`\n✗ ${m}\n`); process.exit(code); };

if (flag('help') || flag('h')) {
  say('npm create reelkit [folder] [-- --ref <tag|branch>] [--no-start] [--skip-setup]');
  process.exit(0);
}

// 1. Node
const major = +process.versions.node.split('.')[0];
if (major < 20) fail(`reelkit needs Node.js 20 or newer; this is ${process.versions.node}. Get the LTS version from https://nodejs.org and run this again.`);

// 2. where
const target = path.resolve(positional[0] || 'reelkit');
if (fs.existsSync(target) && fs.readdirSync(target).length) fail(`${target} already exists and isn't empty. Pick another folder: npm create reelkit another-name`);

// 3. which version
async function latestRelease() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'create-reelkit' } });
    if (r.ok) return (await r.json()).tag_name;
  } catch {}
  return 'main';
}
const ref = opt('ref') || await latestRelease();
say(`\nreelkit ${ref} → ${target}`);

// 4. download and unpack (tar ships with macOS, Linux and Windows 10+)
step('downloading');
const r = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${encodeURIComponent(ref)}`, { headers: { 'User-Agent': 'create-reelkit' } });
if (!r.ok) fail(`couldn't download reelkit ${ref} (HTTP ${r.status}). Check your connection, or try --ref main.`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-reelkit-'));
const tgz = path.join(tmp, 'reelkit.tar.gz');
fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
say(`  ${(fs.statSync(tgz).size / 1e6).toFixed(1)} MB`);
const x = spawnSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });
if (x.status !== 0) fail('couldn\'t unpack the download (is "tar" available?)');
const top = fs.readdirSync(tmp).find(d => d !== 'reelkit.tar.gz' && fs.statSync(path.join(tmp, d)).isDirectory());
if (!top || !fs.existsSync(path.join(tmp, top, 'package.json'))) fail('the download didn\'t contain reelkit');
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) fs.rmdirSync(target);
try { fs.renameSync(path.join(tmp, top), target); }
catch { fs.cpSync(path.join(tmp, top), target, { recursive: true }); } // another drive
fs.rmSync(tmp, { recursive: true, force: true });
say(`  unpacked into ${target}`);

const run = (cmd, args, label) => {
  step(label);
  const p = spawnSync(cmd, args, { cwd: target, stdio: 'inherit', shell: win });
  if (p.status !== 0) fail(`${label} failed. Fix what it says above, then run: cd "${target}" && npm run doctor -- --fix`);
};
if (flag('skip-setup')) { say(`\n✓ downloaded. Set it up with: cd "${target}" && npm run doctor -- --fix`); process.exit(0); }

// 5. install and set up (packages, headless browser, FFmpeg, the free voice)
run('npm', ['install', '--no-audit', '--no-fund'], 'installing packages');
run(process.execPath, ['scripts/doctor.mjs', '--fix'], 'setting up the voice, browser and FFmpeg');

const rel = path.relative(process.cwd(), target) || '.';
say(`\n✓ reelkit is ready in ${target}\n\n  start it any time:  cd ${rel.includes(' ') ? `"${rel}"` : rel} && npm start\n  or open the folder in Claude Code and say: make a reel about …\n`);
if (flag('no-start')) process.exit(0);

// 6. open the studio
step('opening reelkit studio (Ctrl+C to stop)');
const studio = spawn(process.execPath, ['scripts/studio.mjs'], { cwd: target, stdio: 'inherit' });
studio.on('exit', code => process.exit(code ?? 0));
