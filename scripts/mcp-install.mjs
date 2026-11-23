// Adds reelkit's MCP server to the AI apps on this computer (Claude Desktop, Cursor, Claude Code), or takes it out.
// Run through scripts/mcp.mjs: npm run mcp -- install | uninstall | --print. See docs/mcp.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, parseArgs, which } from './lib.mjs';

export const SERVER = path.join(ROOT, 'scripts', 'mcp.mjs');

// A node path that survives upgrades: Homebrew's stable link instead of the versioned Cellar path.
export function nodeBin(exec = process.execPath) {
  if (/[\\/]Cellar[\\/]node/.test(exec)) {
    for (const link of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
      try { if (fs.existsSync(link) && fs.realpathSync(link) === fs.realpathSync(exec)) return link; } catch {}
    }
  }
  return exec;
}
export const entry = () => ({ command: nodeBin(), args: [SERVER] });

// Where each app keeps its MCP servers. null: not on this computer.
export function desktopConfig() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const d = path.join(home, 'Library', 'Application Support', 'Claude');
    return fs.existsSync(d) ? path.join(d, 'claude_desktop_config.json') : null;
  }
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA && path.join(process.env.APPDATA, 'Claude');
    if (roaming && fs.existsSync(roaming)) return path.join(roaming, 'claude_desktop_config.json');
    // the Microsoft Store version keeps it inside its package folder
    const pk = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Packages');
    const store = pk && fs.existsSync(pk) ? fs.readdirSync(pk).find(d => /^Claude_/i.test(d)) : null;
    const d = store && path.join(pk, store, 'LocalCache', 'Roaming', 'Claude');
    return d && fs.existsSync(d) ? path.join(d, 'claude_desktop_config.json') : null;
  }
  return null; // no Claude Desktop on Linux
}
export const cursorConfig = () => (fs.existsSync(path.join(os.homedir(), '.cursor')) ? path.join(os.homedir(), '.cursor', 'mcp.json') : null);

// Add (or with entry null, remove) reelkit in an mcpServers JSON file, keeping everything else.
// Returns 'added' | 'updated' | 'unchanged' | 'removed' | 'absent'.
export function writeConfig(file, value) {
  let cfg = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trim()) { try { cfg = JSON.parse(raw); } catch (e) { throw new Error(`${file} isn't valid JSON (${e.message}); fix it or move it aside, then run this again`); } }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${file} doesn't hold a JSON object`);
  }
  const had = cfg.mcpServers?.reelkit;
  if (value == null) {
    if (!had) return 'absent';
    delete cfg.mcpServers.reelkit;
  } else {
    if (had && JSON.stringify(had) === JSON.stringify(value)) return 'unchanged';
    cfg.mcpServers = { ...(cfg.mcpServers || {}), reelkit: value };
  }
  // a copy of the file as it was, the first time reelkit touches it
  if (fs.existsSync(file) && !fs.existsSync(file + '.bak')) fs.copyFileSync(file, file + '.bak');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return value == null ? 'removed' : had ? 'updated' : 'added';
}
export function readEntry(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.reelkit || null; } catch { return null; }
}

// Claude Code keeps its own list: `claude mcp add` (claude is claude.cmd on Windows, which needs a shell).
const claude = (a) => spawnSync('claude', a, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000 });
function claudeCode(value) {
  if (!which('claude')) return null;
  const has = claude(['mcp', 'get', 'reelkit']).status === 0;
  if (value == null) { if (!has) return 'absent'; return claude(['mcp', 'remove', '--scope', 'user', 'reelkit']).status === 0 ? 'removed' : 'failed'; }
  if (has) claude(['mcp', 'remove', '--scope', 'user', 'reelkit']);
  const r = claude(['mcp', 'add', '--scope', 'user', 'reelkit', '--', value.command, ...value.args]);
  return r.status === 0 ? (has ? 'unchanged' : 'added') : 'failed';
}

// What doctor shows: which apps have reelkit, and whether the node they start it with still exists.
export function mcpStatus() {
  const apps = [];
  for (const [name, f] of [['Claude Desktop', desktopConfig()], ['Cursor', cursorConfig()]]) {
    const e = f && readEntry(f); if (!e) continue;
    apps.push({ name, ok: fs.existsSync(e.command) && fs.existsSync(e.args?.[0] || ''), entry: e });
  }
  return apps;
}

const SAY = { added: '✓ added', updated: '✓ updated', unchanged: '✓ already added', removed: '✓ removed', absent: '· not added', failed: '✗ failed' };

export function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || (args.print ? 'print' : 'install');
  const value = entry();
  if (cmd === 'print' || cmd === '--print') {
    console.log(JSON.stringify({ mcpServers: { reelkit: value } }, null, 2));
    console.log('\nPaste this into your app\'s MCP settings (most apps call the file mcp.json or their "MCP servers" setting), then restart the app.');
    return;
  }
  const remove = cmd === 'uninstall';
  if (!remove && cmd !== 'install' && cmd !== 'status') { console.error(`unknown command "${cmd}": use install, uninstall or --print`); process.exitCode = 1; return; }
  if (cmd === 'status') { for (const a of mcpStatus()) console.log(`${a.ok ? '✓' : '✗'} ${a.name}: ${a.entry.command} ${a.entry.args.join(' ')}`); return; }
  // --config <file>: one mcpServers file (any app, and the tests)
  const targets = args.config ? [['that file', path.resolve(String(args.config))]]
    : [['Claude Desktop', 'desktop', desktopConfig()], ['Cursor', 'cursor', cursorConfig()], ['Claude Code', 'code', 'claude']]
      .filter(([, key]) => !args.app || String(args.app).split(',').includes(key)).map(([n, , f]) => [n, f]);
  let did = 0, bad = 0;
  for (const [name, f] of targets) {
    if (!f) { console.log(`· ${name}: not found on this computer`); continue; }
    try {
      const r = f === 'claude' ? claudeCode(remove ? null : value) : writeConfig(f, remove ? null : value);
      if (r == null) { console.log(`· ${name}: not found on this computer`); continue; }
      console.log(`${SAY[r]} ${name}${f !== 'claude' ? ` (${f})` : ''}`);
      if (r === 'failed') bad++; else if (r !== 'absent') did++;
    } catch (e) { console.log(`✗ ${name}: ${e.message}`); bad++; }
  }
  if (!remove && did) console.log(`\nRestart the app (quit it fully, then open it again), then ask it: "make a reel about why octopuses have three hearts".\nOther apps: npm run mcp -- --print`);
  if (!did && !bad && !remove) console.log('\nNo AI app found. For any app that runs MCP servers, add this (npm run mcp -- --print):\n' + JSON.stringify({ mcpServers: { reelkit: value } }, null, 2));
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
