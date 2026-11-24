// The in-chat player (scripts/mcp-player.html) in a real browser, inside a small stand-in for an AI app: the page
// below hosts the view in a sandboxed iframe the way MCP Apps hosts do, answers its handshake, hands it show's result,
// and passes its resources/read and tools/call through to the real MCP server. Prints one JSON line for tests/run.mjs.
// Runs twice: with the MCP Apps default Content-Security-Policy (blob: video blocked, so the view must use data:)
// and without one (blob:). With a path argument it also saves a screenshot there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ffmpegPath } from '../scripts/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = `zz-player-test-${process.pid}`, dir = path.join(ROOT, 'reels', slug), render = path.join(ROOT, 'out', `${slug}.mp4`);
const shot = process.argv[2] || null;
const out = {};
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none';";

const HOST = `<!doctype html><html><body style="margin:0;background:#1c1c1e;width:420px">
<iframe id="view" sandbox="allow-scripts" style="border:0;width:420px;height:200px"></iframe>
<script>
const frame = document.getElementById('view');
window.calls = []; window.heights = [];
const send = m => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*');
window.start = (html, result) => {
  window.addEventListener('message', async e => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.method === 'ui/initialize') return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion,
      hostInfo: { name: 'reelkit-test-host', version: '1' }, hostCapabilities: { serverTools: {}, serverResources: {} },
      hostContext: { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline'] } } });
    if (m.method === 'ui/notifications/initialized') return send({ method: 'ui/notifications/tool-result', params: result });
    if (m.method === 'ui/notifications/size-changed') { window.heights.push(m.params.height); frame.style.height = m.params.height + 'px'; return; }
    if (m.method === 'resources/read' || m.method === 'tools/call') {
      window.calls.push(m.method === 'tools/call' ? m.params : m.params.uri);
      try { send({ id: m.id, result: await window.mcp(m.method, m.params) }); }
      catch (err) { send({ id: m.id, error: { code: -32603, message: String(err.message || err) } }); }
      return;
    }
    if (m.id !== undefined) send({ id: m.id, result: {} });
  });
  frame.srcdoc = html;
};
</script></body></html>`;

const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'scripts', 'mcp.mjs')], cwd: os.tmpdir(),
  env: { ...process.env, REELKIT_NO_OPEN: '1', REELKIT_MCP_PART: '60000' }, stderr: 'pipe' });
const client = new Client({ name: 'reelkit-player-test', version: '1.0.0' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } });
let browser;
try {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: 'Player test', scenes: [] }));
  fs.mkdirSync(path.dirname(render), { recursive: true });
  spawnSync(ffmpegPath(), ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', render]);

  await client.connect(transport);
  const result = await client.callTool({ name: 'show', arguments: { reel: slug } }, undefined, { timeout: 60000 });
  const html = (await client.readResource({ uri: 'ui://reelkit/player.html' })).contents[0].text;
  out.parts = result.structuredContent?.parts;

  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  for (const [name, view] of [['csp', html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`)], ['open', html]]) {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('mcp', async (method, params) => method === 'tools/call'
      ? client.callTool(params, undefined, { timeout: 60000 }) : client.readResource(params));
    await page.setContent(HOST);
    await page.evaluate(([h, r]) => window.start(h, r), [view, result]);
    const f = page.frameLocator('#view');
    const r = { errors };
    try {
      await f.locator('html[data-source]').waitFor({ state: 'attached', timeout: 30000 });
      r.source = await f.locator('html').getAttribute('data-source');
      r.ready = await f.locator('video').evaluate(v => v.readyState >= 2 && Math.abs(v.duration - 2) < 0.2 && v.videoWidth === 720);
      r.parts = (await page.evaluate(() => window.calls)).filter(c => typeof c === 'string' && c.startsWith('reelkit-video://')).length;
      r.title = (await f.locator('#title').textContent()) === 'Player test';
      r.zonesHidden = await f.locator('#zones').isHidden();
      await f.locator('#zones-btn').click();
      r.zones = (await f.locator('#zones').isVisible()) && (await f.locator('.zone').count()) === 3;
      r.resized = (await page.evaluate(() => window.heights.at(-1) || 0)) > 300;
      if (name === 'csp' && shot) await page.screenshot({ path: shot });
      await f.locator('#open-btn').click();
      await f.locator('#open-btn', { hasText: 'Opened in the video player' }).waitFor({ timeout: 30000 });
      r.open = (await page.evaluate(() => window.calls)).some(c => c && c.name === 'show' && c.arguments?.open === true && c.arguments?.reel);
    } catch (e) { r.error = e.message.split('\n')[0]; }
    out[name] = r;
    await page.close();
  }
} catch (e) {
  out.error = e.message;
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of [render, path.join(ROOT, 'out', '.chat', `${slug}.mp4`)]) fs.rmSync(f, { force: true });
}
console.log(JSON.stringify(out));
