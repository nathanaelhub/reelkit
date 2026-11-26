// Checks a staged Claude Desktop extension (scripts/pack-mcpb.mjs runs it before packing):
//   <bundled node> tests/bundle-check.mjs <stage folder> <empty reels folder>
// Starts the staged server with the bundled Node and the extension's environment, makes a reel through the tools
// (new_reel, voice, check, a draft render), and loads the native packages the voice steps need. Prints one JSON line with the tools
// (for the manifest); exits 1 if anything fails.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [stage, home] = process.argv.slice(2, 4).map(p => path.resolve(p));
const toolsOnly = process.argv[4] === '--tools-only'; // just list the tools (for the manifest)
const node = process.execPath;
const problems = [];
const txt = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const jobOf = r => (txt(r).match(/job "(\d+)"/) || [])[1];

// native packages load with this Node, from the bundle
if (!toolsOnly) for (const m of ['sherpa-onnx-node', 'onnxruntime-node', '@huggingface/transformers', 'playwright', 'ffmpeg-static']) {
  const r = spawnSync(node, ['--input-type=module', '-e', `await import(${JSON.stringify(m)})`], { cwd: stage, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) problems.push(`${m} doesn't load: ${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
}

const transport = new StdioClientTransport({ command: node, args: [path.join(stage, 'scripts', 'mcp.mjs')], cwd: path.dirname(home),
  env: { ...process.env, REELKIT_HOME: home, REELKIT_BUNDLE: '1', REELKIT_NO_OPEN: '1', REELKIT_MCP_FIRST_WAIT: '2', REELKIT_MCP_WAIT: '20' }, stderr: 'pipe' });
const client = new Client({ name: 'reelkit-bundle-check', version: '1' });
const call = (name, a = {}) => client.callTool({ name, arguments: a }, undefined, { timeout: 90000 });
async function until(r) { for (let i = 0; i < 30 && /^Still working/.test(txt(r)); i++) r = await call('wait', { job: jobOf(r) }); return r; }
let tools = [];
try {
  await client.connect(transport);
  tools = (await client.listTools()).tools.map(t => ({ name: t.name, description: t.description || '' }));
  if (tools.length !== 18) problems.push(`${tools.length} tools`);
  if (toolsOnly) throw null;
  const setup = txt(await until(await call('setup')));
  if (/\bnpm\b|\bnpx\b/.test(setup)) problems.push(`setup mentions npm/npx:\n${setup}`);
  if (!setup.includes(home)) problems.push('setup doesn\'t name the reels folder');
  const slug = 'bundle-check';
  if ((await call('new_reel', { slug, title: 'Bundle check' })).isError) problems.push('new_reel failed');
  await call('edit_file', { path: `reels/${slug}/script.json`, old_text: '"provider": "auto"', new_text: '"provider": "none"' });
  const v = await until(await call('run', { reel: slug, step: 'voice' }));
  if (v.isError || !/voiced/.test(txt(v))) problems.push(`voice: ${txt(v).slice(0, 400)}`);
  const c = await until(await call('run', { reel: slug, step: 'check' }));
  if (!c.content.some(x => x.type === 'image')) problems.push(`check returned no contact sheets: ${txt(c).slice(0, 600)}`);
  if (!fs.existsSync(path.join(home, 'reels', slug, 'timeline.json'))) problems.push('the reel isn\'t in the reels folder');
  const d = await until(await call('run', { reel: slug, step: 'draft' }));
  if (d.isError || !fs.readdirSync(path.join(home, 'out')).some(f => f.startsWith(slug) && f.endsWith('.mp4'))) problems.push(`draft render: ${txt(d).slice(0, 600)}`);
  if (fs.existsSync(path.join(stage, 'reels')) || fs.existsSync(path.join(stage, 'out'))) problems.push('something was written into the bundle');
} catch (e) {
  if (e) problems.push(e.message);
} finally {
  await client.close().catch(() => {});
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
console.log(JSON.stringify({ tools, problems }));
