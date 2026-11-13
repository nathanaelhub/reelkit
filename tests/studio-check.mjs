// Used by tests/run.mjs: starts the studio on a free port, probes its API and guards, prints a JSON report.
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['scripts/studio.mjs', '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
const url = await new Promise((res, rej) => {
  let out = ''; const t = setTimeout(() => rej(new Error('studio did not start: ' + out)), 20000);
  child.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(`http://127.0.0.1:${m[1]}`); } });
  child.stderr.on('data', d => { out += d; });
});
const r = {};
try {
  const st = await fetch(url + '/api/state').then(x => x.json());
  r.reels = st.reels.map(x => x.slug); r.styles = st.styles.map(x => x.name);
  r.page = (await fetch(url + '/studio/index.html')).status;
  r.env = (await fetch(url + '/.env')).status;
  r.git = (await fetch(url + '/.git/config')).status;
  r.noHeader = (await fetch(url + '/api/make', { method: 'POST', body: '{}' })).status;
  r.badAction = (await fetch(url + '/api/reels/sky-blue/run', { method: 'POST', headers: { 'X-Reelkit': '1' }, body: JSON.stringify({ action: 'rm' }) })).status;
  r.badReel = (await fetch(url + '/api/reels/nope-nope/run', { method: 'POST', headers: { 'X-Reelkit': '1' }, body: '{"action":"voice"}' })).status;
  r.voices = Array.isArray(st.voices) && typeof st.paragraph === 'string' && st.paragraph.startsWith('This is my own voice');
  const post = (q, type, bodyBytes, hdr = true) => fetch(url + '/api/voices' + q, { method: 'POST', headers: { ...(hdr ? { 'X-Reelkit': '1' } : {}), 'Content-Type': type }, body: bodyBytes }).then(x => x.status);
  r.voiceNoHeader = await post('?name=t', 'audio/wav', new Uint8Array(10), false);
  r.voiceBadType = await post('?name=t', 'text/plain', 'hello');
  r.voiceTooBig = await post('?name=t', 'audio/wav', new Uint8Array((20 << 20) + 1024));
  r.voiceMissing = (await fetch(url + '/api/voices/nobody-here', { method: 'DELETE', headers: { 'X-Reelkit': '1' } })).status;
  r.reelVoiceBad = (await fetch(url + '/api/reels/sky-blue/voice', { method: 'PUT', headers: { 'X-Reelkit': '1' }, body: JSON.stringify({ provider: 'chatterbox', voice: 'nobody-here' }) })).status;
  // a foreign Host header (DNS rebinding) is refused; fetch won't set Host, so use http directly
  const http = await import('node:http');
  r.badHost = await new Promise(res => http.get(url + '/api/state', { headers: { Host: 'evil.example' } }, x => { x.resume(); res(x.statusCode); }));
} finally { child.kill(); }
console.log(JSON.stringify(r));
