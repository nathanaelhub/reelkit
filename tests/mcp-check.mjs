// Drives reelkit's MCP server (scripts/mcp.mjs) the way an AI app does, through the SDK's own client, and prints one
// JSON line of results for tests/run.mjs. Makes a throwaway reel (zz-mcp-test-<pid>) and removes it afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = `zz-mcp-test-${process.pid}`, dir = path.join(ROOT, 'reels', slug);
const out = {};
const txt = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const images = r => r.content.filter(c => c.type === 'image').length;
const jobOf = r => (txt(r).match(/job "(\d+)"/) || [])[1];

// started from another folder, as apps do; run returns a job after 1 s so the wait path is tested too
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'scripts', 'mcp.mjs')], cwd: os.tmpdir(),
  env: { ...process.env, REELKIT_NO_OPEN: '1', REELKIT_MCP_FIRST_WAIT: '1', REELKIT_MCP_WAIT: '10' }, stderr: 'pipe' });
const client = new Client({ name: 'reelkit-test', version: '1.0.0' });
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
async function until(r, limit = 300) {
  const t0 = Date.now();
  while (/^Still working/.test(txt(r)) && Date.now() - t0 < limit * 1000) r = await call('wait', { job: jobOf(r) });
  return r;
}

try {
  await client.connect(transport);
  out.instructions = /call guide/.test(client.getInstructions() || '');
  out.tools = (await client.listTools()).tools.map(t => t.name).sort().join(',');
  out.guide = txt(await call('guide')).includes('run with that step');
  out.guideRiso = txt(await call('guide', { topic: 'style:riso' })).length > 200;
  out.guideBad = !!(await call('guide', { topic: 'nope' })).isError;

  const made = await call('new_reel', { slug, title: 'MCP test' });
  out.newReel = !made.isError && fs.existsSync(path.join(dir, 'script.json'));
  out.newAgain = !!(await call('new_reel', { slug, title: 'again' })).isError;
  out.newBadSlug = !!(await call('new_reel', { slug: '_Bad Slug', title: 'x' })).isError;

  // files
  const sp = `reels/${slug}/script.json`;
  out.edit = !(await call('edit_file', { path: sp, old_text: '"provider": "auto"', new_text: '"provider": "none"' })).isError
    && JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')).voice.provider === 'none';
  out.editBadJson = !!(await call('edit_file', { path: sp, old_text: '"captions": true', new_text: '"captions": tru' })).isError;
  await call('write_file', { path: `reels/${slug}/notes.md`, content: 'one\r\ntwo\r\n' });
  out.crlf = !(await call('edit_file', { path: `reels/${slug}/notes.md`, old_text: 'one\ntwo', new_text: 'one\nthree' })).isError
    && fs.readFileSync(path.join(dir, 'notes.md'), 'utf8') === 'one\r\nthree\r\n';
  out.read = txt(await call('read_file', { path: `reels/${slug}/notes.md` })).includes('three');
  out.del = !(await call('delete_file', { path: `reels/${slug}/notes.md` })).isError && !fs.existsSync(path.join(dir, 'notes.md'));
  const refused = [];
  for (const p of ['../package.json', `reels/${slug}/../../package.json`, '/etc/passwd', 'C:\\Windows\\win.ini', '~/x.txt', `reels/${slug}/.env`, 'scripts/x.js', 'package.json', `reels/${slug}/x.exe`, 'reels/no-such-reel/x.md'])
    if ((await call('write_file', { path: p, content: 'x' })).isError) refused.push(p);
  out.refused = refused.length;
  out.readOutside = !!(await call('read_file', { path: '../.env' })).isError;
  out.delScript = !!(await call('delete_file', { path: sp })).isError;

  // media: only real pictures/sound from this computer, never a text file
  const png = path.join(os.tmpdir(), `reelkit-mcp-${process.pid}.png`);
  spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(png)}, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))`]);
  out.assetPng = !(await call('add_asset', { reel: slug, source: png, name: 'dot' })).isError && fs.existsSync(path.join(dir, 'assets', 'dot.png'));
  out.assetText = !!(await call('add_asset', { reel: slug, source: path.join(ROOT, 'package.json') })).isError;
  out.assetEnvAsPng = !!(await call('add_asset', { reel: slug, source: path.join(ROOT, '.env.example'), name: 'x.png' })).isError;
  out.assetHttp = !!(await call('add_asset', { reel: slug, source: 'http://example.com/x.png' })).isError;
  fs.rmSync(png, { force: true });
  out.seriesPath = !!(await call('new_series', { name: `zz-mcp-${process.pid}`, source: 'package.json' })).isError
    && !!(await call('new_series', { name: `zz-mcp-${process.pid}`, source: '/etc/hosts' })).isError;

  // steps: voice (silent, fast), then check: sheets come back as pictures
  const v = await until(await call('run', { reel: slug, step: 'voice' }));
  out.voice = /voiced/.test(txt(v)) && !v.isError;
  // something off the computer: blocked in renders made from an AI app, and reported by check
  await call('edit_file', { path: `reels/${slug}/reel.html`, old_text: '<div id="stage">', new_text: '<div id="stage">\n  <img class="abs" src="https://example.com/x.png" style="left:0;top:0;width:10px">' });
  const c = await until(await call('run', { reel: slug, step: 'check' }));
  out.check = /^check /.test(txt(c));
  out.checkImages = images(c);
  out.blocked = /blocked https:\/\/example\.com/.test(txt(c));
  await call('edit_file', { path: `reels/${slug}/reel.html`, old_text: '\n  <img class="abs" src="https://example.com/x.png" style="left:0;top:0;width:10px">', new_text: '' });

  // one job per reel, also across apps (the lock file), and stop
  const d = await call('run', { reel: slug, step: 'draft' });
  const id = jobOf(d);
  out.lock = !!id && fs.existsSync(path.join(dir, '.job'));
  out.busy = id ? !!(await call('run', { reel: slug, step: 'check' })).isError : null;
  out.stop = id ? /stopped|already finished/.test(txt(await call('stop', { job: id }))) : null;
  for (let i = 0; i < 25 && fs.existsSync(path.join(dir, '.job')); i++) await new Promise(r => setTimeout(r, 200));
  out.unlocked = !fs.existsSync(path.join(dir, '.job'));
  out.list = txt(await call('list_reels')).includes(slug);
  out.options = /riso/.test(txt(await call('options')));
} catch (e) {
  out.error = e.message;
} finally {
  await client.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of fs.existsSync(path.join(ROOT, 'out')) ? fs.readdirSync(path.join(ROOT, 'out')) : []) if (f.startsWith(slug + '.') || f.startsWith(slug + '-')) fs.rmSync(path.join(ROOT, 'out', f), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'series', `zz-mcp-${process.pid}`), { recursive: true, force: true });
}

// install: merges into a config, keeps other servers, changes nothing the second time, uninstall leaves the rest
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-mcp-cfg-')), cfg = path.join(cfgDir, 'mcp.json');
fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
const inst = a => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'mcp.mjs'), ...a, '--config', cfg], { encoding: 'utf8' });
const i1 = inst(['install']), j1 = JSON.parse(fs.readFileSync(cfg, 'utf8'));
out.install = i1.status === 0 && !!j1.mcpServers.reelkit && j1.mcpServers.other?.command === 'x' && j1.theme === 'dark' && j1.mcpServers.reelkit.args[0].endsWith('mcp.mjs');
out.installAgain = /already added/.test(inst(['install']).stdout);
out.backup = fs.existsSync(cfg + '.bak');
const u = inst(['uninstall']), j2 = JSON.parse(fs.readFileSync(cfg, 'utf8'));
out.uninstall = u.status === 0 && !j2.mcpServers.reelkit && j2.mcpServers.other?.command === 'x';
fs.writeFileSync(cfg, '{ not json');
out.badJson = inst(['install']).status === 1 && fs.readFileSync(cfg, 'utf8') === '{ not json';
fs.rmSync(cfgDir, { recursive: true, force: true });

console.log(JSON.stringify(out));
