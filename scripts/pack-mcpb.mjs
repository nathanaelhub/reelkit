// Builds the Claude Desktop extension: dist/reelkit-<version>-<os>-<arch>.mcpb, for the system it runs on.
//   node scripts/pack-mcpb.mjs            build it (CI runs this on macOS and Windows for each release)
//   node scripts/pack-mcpb.mjs --keep     keep the staging folder (dist/stage) to look inside
//
// The bundle holds only what the MCP server runs (scripts, engine, styles, the make-reel skill and production
// packages, without other systems' binaries) plus an official Node: Claude Desktop's own Node runs extensions in an
// Electron utility process that can't start child node processes, and every reelkit step is one. Reels go to the
// folder chosen at install (REELKIT_HOME), never into the bundle. Chromium and voice models download on first use.
// Before packing it starts the staged server with that Node and makes a reel through the tools.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, readJSON, writeJSON, parseArgs } from './lib.mjs';

const args = parseArgs();
const pkg = readJSON(path.join(ROOT, 'package.json'));
const PLAT = process.platform, ARCH = process.arch;
const OSNAME = { darwin: 'mac', win32: 'windows', linux: 'linux' }[PLAT] || PLAT;
const DIST = path.join(ROOT, 'dist'), STAGE = path.join(DIST, 'stage');
const NODE_VERSION = process.versions.node; // the same Node the packages were installed with
const OUTFILE = path.join(DIST, `reelkit-${pkg.version}-${OSNAME}-${ARCH}.mcpb`);
const MAX_UNPACKED = 600 * 1048576; // Claude Desktop accepts up to 2 GB; this guards against bloat
const step = s => console.log(`▸ ${s}`);
const sh = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: PLAT === 'win32', ...opts });
  if (r.status !== 0) { console.error(`✗ ${cmd} ${a.join(' ')} failed (exit ${r.status})`); process.exit(1); }
};
const size = d => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? size(f) : e.isFile() ? fs.statSync(f).size : 0; } return n; };
const mb = n => `${(n / 1048576).toFixed(0)} MB`;

// ---------- 1. stage the code ----------
step(`staging reelkit ${pkg.version} for ${PLAT}-${ARCH}`);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
const COPY = ['scripts', 'engine', 'styles', path.join('.claude', 'skills', 'make-reel'), 'package.json', 'package-lock.json', 'LICENSE', 'README.md', path.join('docs', 'mcp.md')];
for (const p of COPY) fs.cpSync(path.join(ROOT, p), path.join(STAGE, p), { recursive: true, filter: s => !path.basename(s).startsWith('.') || s.includes(`${path.sep}.claude`) });
fs.copyFileSync(path.join(ROOT, 'packaging', 'mcpb', 'icon.png'), path.join(STAGE, 'icon.png'));

// ---------- 2. production packages ----------
step('npm ci --omit=dev');
sh('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: STAGE, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });

// ---------- 3. drop other systems' binaries ----------
step('removing other systems\' binaries');
const before = size(STAGE);
const ort = path.join(STAGE, 'node_modules', 'onnxruntime-node', 'bin');
if (fs.existsSync(ort)) for (const napi of fs.readdirSync(ort)) {
  for (const p of fs.readdirSync(path.join(ort, napi))) {
    const pd = path.join(ort, napi, p);
    if (p !== PLAT) { fs.rmSync(pd, { recursive: true, force: true }); continue; }
    for (const a of fs.readdirSync(pd)) if (a !== ARCH) fs.rmSync(path.join(pd, a), { recursive: true, force: true });
  }
}
// onnxruntime-web is only for browsers' WebGPU/WASM builds of transformers; the extension runs models in Node
const ortWeb = path.join(STAGE, 'node_modules', 'onnxruntime-web', 'dist');
if (fs.existsSync(ortWeb)) for (const f of fs.readdirSync(ortWeb)) if (/\.(wasm|map)$/.test(f) || /\.jsep\.|\.jspi\.|\.webgpu\.|\.webgl\./.test(f)) fs.rmSync(path.join(ortWeb, f), { force: true });
for (const f of ['.package-lock.json']) fs.rmSync(path.join(STAGE, 'node_modules', f), { force: true });
console.log(`  ${mb(before)} → ${mb(size(STAGE))}`);

// ---------- 4. an official Node, checked against nodejs.org's SHASUMS256 ----------
step(`adding Node ${NODE_VERSION}`);
const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
const archive = PLAT === 'win32' ? `node-v${NODE_VERSION}-win-${ARCH}.zip` : `node-v${NODE_VERSION}-${PLAT}-${ARCH}.tar.gz`;
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const sums = (await get(`${base}/SHASUMS256.txt`)).toString();
const want = sums.split('\n').find(l => l.endsWith(`  ${archive}`))?.split(/\s+/)[0];
if (!want) { console.error(`✗ ${archive} isn't listed in ${base}/SHASUMS256.txt`); process.exit(1); }
const buf = await get(`${base}/${archive}`);
if (crypto.createHash('sha256').update(buf).digest('hex') !== want) { console.error(`✗ ${archive} doesn't match its SHA-256`); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-node-'));
fs.writeFileSync(path.join(tmp, archive), buf);
sh('tar', ['-xf', archive], { cwd: tmp, shell: false });
const top = path.join(tmp, archive.replace(/\.(zip|tar\.gz)$/, ''));
const RUNTIME = path.join(STAGE, 'runtime');
fs.mkdirSync(RUNTIME, { recursive: true });
const NODE_BIN = path.join(RUNTIME, PLAT === 'win32' ? 'node.exe' : 'node');
fs.copyFileSync(path.join(top, PLAT === 'win32' ? 'node.exe' : path.join('bin', 'node')), NODE_BIN);
fs.chmodSync(NODE_BIN, 0o755);
fs.copyFileSync(path.join(top, 'LICENSE'), path.join(RUNTIME, 'NODE-LICENSE'));
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- 5. the tools, from the staged server run with that Node ----------
const listed = spawnSync(NODE_BIN, [path.join(ROOT, 'tests', 'bundle-check.mjs'), STAGE, fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-tools-')), '--tools-only'], { encoding: 'utf8', timeout: 120000, cwd: os.tmpdir() });
let tools;
try { ({ tools } = JSON.parse(listed.stdout.trim().split('\n').pop())); } catch {}
if (listed.status !== 0 || !tools?.length) { console.error(`✗ the staged server didn't start:\n${listed.stdout}\n${listed.stderr}`); process.exit(1); }

// ---------- 6. manifest ----------
const node = `\${__dirname}/runtime/${PLAT === 'win32' ? 'node.exe' : 'node'}`;
writeJSON(path.join(STAGE, 'manifest.json'), {
  manifest_version: '0.3',
  name: 'reelkit',
  display_name: 'reelkit',
  version: pkg.version,
  description: 'Make short vertical videos (reels, TikToks, Shorts) from a sentence: voiced, captioned, animated and scored, on your computer.',
  long_description: 'reelkit gives Claude the tools to make a reel: it writes the script and the scenes, voices it, looks at contact sheets of its own work, renders, and plays the result in the chat. Everything runs on your computer; reels are saved in the folder you choose. The first reel downloads a headless browser and a free voice (about 300 MB, once).',
  author: { name: 'reelkit contributors', url: 'https://github.com/nathanaelhub/reelkit' },
  homepage: 'https://github.com/nathanaelhub/reelkit',
  documentation: 'https://github.com/nathanaelhub/reelkit/blob/main/docs/mcp.md',
  support: 'https://github.com/nathanaelhub/reelkit/issues',
  repository: { type: 'git', url: 'https://github.com/nathanaelhub/reelkit' },
  license: pkg.license || 'MIT',
  icon: 'icon.png',
  keywords: ['video', 'reels', 'tiktok', 'shorts', 'captions', 'animation'],
  server: {
    type: 'binary',
    entry_point: `runtime/${path.basename(NODE_BIN)}`,
    mcp_config: {
      command: node,
      args: ['${__dirname}/scripts/mcp.mjs'],
      env: {
        REELKIT_HOME: '${user_config.folder}',
        REELKIT_BUNDLE: '1',
        ELEVENLABS_API_KEY: '${user_config.elevenlabs_key}',
        OPENAI_API_KEY: '${user_config.openai_key}',
      },
    },
  },
  tools: tools.map(t => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0] })),
  compatibility: { platforms: [PLAT] },
  user_config: {
    folder: { type: 'directory', title: 'Reels folder', description: 'Where your reels, renders and voices are saved. Updating or removing the extension never touches it.', default: '${DOCUMENTS}/reelkit', required: true },
    elevenlabs_key: { type: 'string', title: 'ElevenLabs API key (optional)', description: 'Only if you want ElevenLabs voices; the free voice needs no key.', sensitive: true, required: false },
    openai_key: { type: 'string', title: 'OpenAI API key (optional)', description: 'Only if you want OpenAI voices; the free voice needs no key.', sensitive: true, required: false },
  },
});

// ---------- 7. pack ----------
const unpacked = size(STAGE);
if (unpacked > MAX_UNPACKED) { console.error(`✗ the bundle is ${mb(unpacked)} unpacked, over the ${mb(MAX_UNPACKED)} budget`); process.exit(1); }
step('mcpb validate + pack');
const MCPB = ['-y', '@anthropic-ai/mcpb@2.1.2'];
sh('npx', [...MCPB, 'validate', path.join(STAGE, 'manifest.json')]);
fs.rmSync(OUTFILE, { force: true });
sh('npx', [...MCPB, 'pack', STAGE, OUTFILE]);

// ---------- 8. unpack what will ship and make a reel with it, as Claude Desktop will run it ----------
step('making a reel with the packed extension (new_reel, voice, check, draft render)');
const UNPACKED = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-mcpb-')), home = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-bundle-home-'));
sh('tar', ['-xf', OUTFILE, '-C', UNPACKED], { shell: false });
const smoke = spawnSync(path.join(UNPACKED, 'runtime', path.basename(NODE_BIN)), [path.join(ROOT, 'tests', 'bundle-check.mjs'), UNPACKED, home], { encoding: 'utf8', timeout: 10 * 60e3, cwd: os.tmpdir() });
for (const d of [UNPACKED, home]) fs.rmSync(d, { recursive: true, force: true });
if (smoke.status !== 0) { console.error(`✗ the packed extension didn't work:\n${smoke.stderr}\n${smoke.stdout.slice(-2000)}`); process.exit(1); }
console.log('  ✓ it works from a separate reels folder with its own Node');
console.log(`\n✓ ${path.relative(ROOT, OUTFILE)}: ${mb(fs.statSync(OUTFILE).size)} (${mb(unpacked)} unpacked)`);
if (!args.keep) fs.rmSync(STAGE, { recursive: true, force: true });
