#!/usr/bin/env node
// reelkit in AI apps (MCP): Claude Desktop, Cursor, Claude Code and any app that runs local MCP servers.
//   npm run mcp -- install            add reelkit to the AI apps on this computer (then restart them)
//   npm run mcp -- install --app desktop|cursor|code
//   npm run mcp -- uninstall          take it out again
//   npm run mcp -- --print            the JSON to paste into any other app
// With no arguments this is the server itself, which the app starts (see docs/mcp.md).
const cmd = process.argv[2];
if (['install', 'uninstall', 'print', '--print', 'status'].includes(cmd)) {
  await import('./mcp-install.mjs').then(m => m.main(process.argv.slice(2)));
} else if (process.stdin.isTTY) {
  console.error('This is reelkit\'s MCP server: AI apps start it themselves.\nTo add reelkit to Claude Desktop, Cursor or Claude Code: npm run mcp -- install');
} else {
  // stdout carries the protocol: anything else printed goes to stderr. Static imports would load before this line,
  // so the server is imported afterwards.
  const util = await import('node:util');
  const toErr = (...a) => process.stderr.write(util.format(...a) + '\n');
  console.log = console.info = console.debug = console.warn = toErr;
  await import('./mcp-server.mjs');
}
