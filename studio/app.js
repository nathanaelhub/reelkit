// reelkit studio front end: talks to scripts/studio.mjs.
const $ = s => document.querySelector(s);
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'X-Reelkit': '1', ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.json ? JSON.stringify(opts.json) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j;
};

let state = { reels: [], styles: [], agent: false, jobs: [] };
let current = null;      // the selected reel's detail
let style = null;        // chosen look in the composer
let view = 'video';      // 'video' | 'live'
let version = null;      // which out/*.mp4 is showing
let stream = null, streamJob = null;

// ---------- log ----------
const logEl = $('#log');
function log(line, cls) {
  const div = document.createElement('div');
  div.textContent = line;
  if (cls) div.className = cls; else if (/^✗/.test(line)) div.className = 'bad'; else if (/^✓/.test(line)) div.className = 'good';
  logEl.append(div);
  while (logEl.childNodes.length > 3000) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
function follow(jobId, label, onEnd) {
  if (stream) stream.close();
  logEl.textContent = '';
  $('#log-title').textContent = label;
  $('#stop').hidden = false; streamJob = jobId;
  stream = new EventSource(`/api/jobs/${jobId}/stream`);
  stream.addEventListener('line', e => log(JSON.parse(e.data)));
  stream.addEventListener('end', e => {
    stream.close(); stream = null; $('#stop').hidden = true;
    const code = JSON.parse(e.data);
    $('#log-title').textContent = `${label}: ${code === 0 ? 'done' : 'stopped'}`;
    busy(false); refresh().then(() => onEnd && onEnd(code));
  });
  stream.onerror = () => { if (stream) { stream.close(); stream = null; } $('#stop').hidden = true; busy(false); };
}
$('#stop').onclick = () => streamJob && api(`/api/jobs/${streamJob}/stop`, { method: 'POST' }).catch(e => log('✗ ' + e.message));
function busy(on) { document.querySelectorAll('[data-action], #send-note, #make, #blank').forEach(b => { b.disabled = on; }); }
const fail = e => { log('✗ ' + e.message); busy(false); };

// ---------- composer ----------
const SWATCH_DEFAULT = ['#c8cdd3', '#22262e'];
function renderStyles() {
  const box = $('#styles'); box.textContent = '';
  const opts = [{ name: null, title: 'Kit default', swatch: ['#f1efea', '#e0282e'] }, ...state.styles];
  for (const s of opts) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(style === s.name));
    b.title = s.description || 'The kit\'s own look, set by a theme';
    const sw = s.swatch || SWATCH_DEFAULT;
    const i = document.createElement('i'); i.style.background = `linear-gradient(135deg, ${sw[0]} 50%, ${sw[1]} 50%)`;
    b.append(i, s.title || s.name);
    b.onclick = () => { style = s.name; renderStyles(); };
    box.append(b);
  }
}
function renderAgent() {
  const a = $('#agent');
  a.className = 'agent' + (state.agent ? ' on' : '');
  a.textContent = state.agent ? 'Agent ready (Claude Code)' : 'No agent found';
  $('#make-hint').textContent = state.agent
    ? 'Make it writes the script, voices it, draws the scenes, checks its own frames and renders. It runs Claude Code on your account and takes a few minutes; every step shows in the log below.'
    : 'Claude Code isn\'t installed, so Make it starts a blank reel: you can edit what\'s said and voice it here, and build the scenes in reel.html by hand or with another coding agent. Install Claude Code (claude.com/claude-code) to have the agent build whole reels.';
  $('#make').textContent = state.agent ? 'Make it' : 'Start it';
  $('#blank').hidden = !state.agent;
}
async function make(blank) {
  const idea = $('#idea').value.trim();
  if (!idea) { $('#idea').focus(); log('✗ Write what the reel is about first.'); return; }
  busy(true);
  try {
    const r = await api('/api/make', { method: 'POST', json: { idea, style, format: $('#format').value, blank } });
    follow(r.job, r.agent ? `Making ${r.slug}` : `New reel ${r.slug}`, () => open(r.slug));
  } catch (e) { fail(e); }
}
$('#make').onclick = () => make(false);
$('#blank').onclick = () => make(true);
$('#idea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) make(false); });

// ---------- shelf ----------
function renderShelf() {
  const box = $('#reels'); box.textContent = '';
  if (!state.reels.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No reels yet. Write an idea above and press Make it.'; box.append(p); return; }
  for (const r of state.reels) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'reel'; b.setAttribute('aria-current', String(current?.slug === r.slug));
    const t = document.createElement('div'); t.className = 'thumb';
    const vid = r.videos.find(v => !v.includes('.draft.')) || r.videos[0];
    if (vid) { const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.src = `/out/${encodeURIComponent(vid)}#t=1.5`; t.append(v); }
    else { const s = document.createElement('span'); s.className = 'blank'; s.textContent = r.voiced ? 'not rendered yet' : 'not voiced yet'; t.append(s); }
    const title = document.createElement('b'); title.textContent = r.title;
    const small = document.createElement('small'); small.textContent = [r.duration ? `${Math.round(r.duration)} s` : null, r.style].filter(Boolean).join(', ') || r.slug;
    b.append(t, title, small);
    b.onclick = () => open(r.slug);
    box.append(b);
  }
}

// ---------- bay ----------
async function open(slug) {
  try { current = await api(`/api/reels/${slug}`); } catch (e) { fail(e); return; }
  version = current.videos.find(v => !v.includes('.draft.')) || current.videos[0] || null;
  view = version ? 'video' : 'live';
  $('#bay').hidden = false;
  renderShelf(); renderBay();
  history.replaceState(null, '', `?reel=${slug}`);
  $('#bay').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
function renderBay() {
  const r = current; if (!r) return;
  $('#title').textContent = r.title;
  $('#meta').textContent = [r.slug, r.style ? `${r.style} style` : null, r.duration ? `${r.duration.toFixed(1)} s` : 'not voiced', `${r.scenes} scenes`, r.format].filter(Boolean).join(', ');
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  const frame = $('#frame'); frame.textContent = '';
  frame.className = 'frame' + (r.format === '16:9' ? ' wide' : r.format === '1:1' ? ' square' : '');
  if (view === 'video') {
    if (version) { const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.src = `/out/${encodeURIComponent(version)}?v=${Date.now()}`; frame.append(v); }
    else { const p = document.createElement('p'); p.textContent = r.voiced ? 'Not rendered yet. Press Render, or Draft render for a quick look.' : 'Press Voice first: the timing of every scene comes from the voiceover.'; frame.append(p); }
  } else if (r.voiced && r.hasHtml) {
    const f = document.createElement('iframe'); f.title = 'Live preview'; f.src = `/reels/${r.slug}/reel.html`; frame.append(f);
  } else { const p = document.createElement('p'); p.textContent = 'The live preview needs a voiceover (press Voice) and scenes in reel.html.'; frame.append(p); }

  const vs = $('#versions'); vs.textContent = '';
  if (view === 'video') for (const v of r.videos) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(v === version));
    b.textContent = v.replace(r.slug, '').replace(/^\./, '').replace(/\.mp4$/, '') || 'final';
    b.onclick = () => { version = v; renderBay(); };
    vs.append(b);
  }

  const ol = $('#scenes'); ol.textContent = '';
  for (const s of r.script.scenes || []) {
    const li = document.createElement('li');
    const c = document.createElement('code'); c.textContent = s.id;
    const t = document.createElement('textarea'); t.rows = 2; t.value = s.say; t.dataset.id = s.id;
    t.setAttribute('aria-label', `What's said in scene ${s.id}`);
    li.append(c, t);
    if (s.footage) { const n = document.createElement('span'); n.className = 'from-footage'; n.textContent = 'Their own words from the footage: editing this changes the caption, not the sound.'; li.append(n); }
    ol.append(li);
  }
  const sh = $('#sheets'); sh.textContent = '';
  for (const f of r.sheets) { const a = document.createElement('a'); a.href = `/out/${f}`; a.target = '_blank'; const i = document.createElement('img'); i.src = `/out/${f}?v=${Date.now()}`; i.alt = `Contact sheet ${f}`; a.append(i); sh.append(a); }
  $('#sheets-block').hidden = !r.sheets.length;
}
document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => { view = b.dataset.view; renderBay(); }; });
document.querySelectorAll('[data-action]').forEach(b => {
  b.onclick = async () => {
    if (!current) return; busy(true);
    try { const r = await api(`/api/reels/${current.slug}/run`, { method: 'POST', json: { action: b.dataset.action } });
      follow(r.job, `${b.textContent} ${current.slug}`, () => open(current.slug)); } catch (e) { fail(e); }
  };
});
$('#save-scenes').onclick = async () => {
  if (!current) return;
  const script = structuredClone(current.script);
  for (const t of document.querySelectorAll('#scenes textarea')) { const s = script.scenes.find(x => x.id === t.dataset.id); if (s) s.say = t.value.trim(); }
  try { await api(`/api/reels/${current.slug}/script`, { method: 'PUT', json: { script } }); log(`✓ Saved what's said in ${current.slug}. Press Voice to hear it.`); current.script = script; }
  catch (e) { fail(e); }
};
$('#send-note').onclick = async () => {
  const note = $('#note').value.trim();
  if (!current) return; if (!note) { $('#note').focus(); return; }
  busy(true);
  try { const r = await api(`/api/reels/${current.slug}/notes`, { method: 'POST', json: { note } }); $('#note').value = ''; follow(r.job, `Notes on ${current.slug}`, () => open(current.slug)); }
  catch (e) { fail(e); }
};

// ---------- footage ----------
async function upload(file) {
  if (!current || !file) return;
  busy(true); log(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
  try {
    const r = await api(`/api/reels/${current.slug}/footage?name=${encodeURIComponent(file.name)}&talk=${$('#talk').checked ? 1 : 0}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
    follow(r.job, `Footage for ${current.slug}`, () => open(current.slug));
  } catch (e) { fail(e); }
}
const drop = $('#drop');
$('#file').onchange = e => upload(e.target.files[0]);
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => upload(e.dataTransfer.files[0]));

// ---------- boot ----------
async function refresh() {
  try { state = await api('/api/state'); } catch (e) { log('✗ ' + e.message); return; }
  renderAgent(); renderStyles(); renderShelf();
  if (current) { const fresh = state.reels.find(r => r.slug === current.slug); if (fresh) { Object.assign(current, fresh); renderBay(); } }
}
await refresh();
const want = new URLSearchParams(location.search).get('reel');
if (want && state.reels.some(r => r.slug === want)) open(want);
const running = state.jobs.filter(j => j.running).pop();
if (running) follow(running.id, running.label, () => running.reel && open(running.reel));
else log('Ready. Write an idea and press Make it, or pick a reel below.');
