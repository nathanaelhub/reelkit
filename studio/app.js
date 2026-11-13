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
// the voice for new reels: 'free' or 'mine:<name>', remembered in this browser
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let voiceChoice = store.get('reelkit.voice') || 'free';

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
    const r = await api('/api/make', { method: 'POST', json: { idea, style, format: $('#format').value, blank, voice: voiceChoice } });
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
  renderReelVoice();
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

// ---------- voices ----------
const voiceExists = name => state.voices.some(v => v.name === name);
function renderVoiceChips() {
  if (voiceChoice.startsWith('mine:') && !voiceExists(voiceChoice.slice(5))) voiceChoice = 'free';
  const box = $('#voice-chips'); box.textContent = '';
  const chip = (label, value, title) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label; b.title = title;
    b.setAttribute('aria-pressed', String(voiceChoice === value));
    b.onclick = () => { voiceChoice = value; store.set('reelkit.voice', value); renderVoiceChips(); };
    box.append(b);
  };
  chip('Free voice', 'free', 'Kokoro: a natural narrator that runs on this computer');
  for (const v of state.voices) chip(v.name === 'me' ? 'My voice' : v.name, `mine:${v.name}`, `voices/${v.name}.wav (${v.seconds} s), cloned with Chatterbox`);
  const add = document.createElement('button'); add.type = 'button'; add.className = 'chip add'; add.textContent = 'Record a voice…';
  add.onclick = openRecorder; box.append(add);
}
function renderReelVoice() {
  const r = current; if (!r) return;
  const v = r.script.voice || {}, mine = v.provider === 'chatterbox' ? (v.chatterbox?.reference || '').match(/voices\/([a-z0-9-]+)\.wav$/)?.[1] : null;
  $('#voice-now').textContent = mine ? `Speaking in the recorded voice "${mine}".` : v.provider === 'chatterbox' ? 'Speaking in a cloned voice from a file.'
    : `Speaking in the ${v.provider && v.provider !== 'auto' ? v.provider : 'automatically chosen'} voice.`;
  const sel = $('#voice-pick'); sel.textContent = '';
  const opt = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.append(o); };
  opt('free', 'Free voice (Kokoro)');
  for (const x of state.voices) opt(`mine:${x.name}`, x.name === 'me' ? 'My voice' : x.name);
  sel.value = mine && voiceExists(mine) ? `mine:${mine}` : 'free';
  $('#delivery').value = v.chatterbox?.exaggeration ?? 0.5;
  const showDelivery = () => { $('#delivery-row').hidden = sel.value === 'free'; };
  sel.onchange = showDelivery; showDelivery();
}
$('#voice-use').onclick = async () => {
  if (!current) return;
  const pick = $('#voice-pick').value;
  const body = pick === 'free' ? { provider: 'kokoro' } : { provider: 'chatterbox', voice: pick.slice(5), exaggeration: +$('#delivery').value };
  try {
    const r = await api(`/api/reels/${current.slug}/voice`, { method: 'PUT', json: body });
    current.script.voice = r.voice; renderReelVoice();
    log(`✓ ${current.slug} will use ${pick === 'free' ? 'the free voice' : `the voice "${pick.slice(5)}"`}. Press Re-voice to hear it${pick === 'free' || state.chatterbox ? '' : ' (the first time downloads the cloning model, about 1.5 GB)'}.`);
  } catch (e) { fail(e); }
};
$('#voice-record-2').onclick = () => openRecorder();

// the recorder: read the paragraph, check it, keep it
const rec = { stream: null, mr: null, chunks: [], blob: null, t0: 0, timer: null, ctx: null, raf: 0 };
const recStatus = (msg, cls = '') => { const p = $('#rec-status'); p.textContent = msg; p.className = 'rec-status ' + cls; };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderVoiceList() {
  const ul = $('#voice-list'); ul.textContent = '';
  if (!state.voices.length) { const li = document.createElement('li'); li.innerHTML = '<small>None yet.</small>'; ul.append(li); return; }
  for (const v of state.voices) {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = v.name === 'me' ? 'me (my voice)' : v.name;
    const sm = document.createElement('small'); sm.textContent = `${v.seconds} s${v.created ? ', ' + v.created.slice(0, 10) : ''}`;
    const play = document.createElement('button'); play.type = 'button'; play.textContent = '▶ Recording';
    play.onclick = () => new Audio(`/voices/${v.name}.wav?v=${Date.now()}`).play();
    const sample = document.createElement('button'); sample.type = 'button'; sample.textContent = 'Hear it speak';
    sample.onclick = () => hearSample(v.name);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'quiet'; del.textContent = 'Delete';
    del.onclick = async () => {
      if (!confirm(`Delete the voice "${v.name}"?`)) return;
      try { const r = await api(`/api/voices/${v.name}`, { method: 'DELETE' }); await refresh();
        recStatus(r.stillUsedBy.length ? `Deleted. ${r.stillUsedBy.join(', ')} still point at it: switch their voice before re-voicing.` : 'Deleted.', r.stillUsedBy.length ? 'bad' : 'good'); }
      catch (e) { recStatus(e.message, 'bad'); }
    };
    li.append(b, sm, play, sample, del); ul.append(li);
  }
}
function openRecorder() {
  $('#paragraph').textContent = state.paragraph || '';
  $('#consent').checked = false; $('#rec-start').disabled = true;
  $('#rec-save').hidden = true; $('#rec-play').hidden = true; recStatus('');
  $('#rec-name').value = state.voices.some(v => v.name === 'me') ? '' : 'me';
  renderVoiceList();
  $('#recorder').showModal();
}
$('#consent').onchange = e => { $('#rec-start').disabled = !e.target.checked || !!rec.mr; };
$('#recorder').addEventListener('close', () => stopRecording(true));
function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    recStatus('This browser can\'t record here. Open the studio at http://127.0.0.1:4242 in Chrome, Edge, Safari or Firefox.', 'bad'); return;
  }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    recStatus(e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it for this page (the icon in the address bar) and press Record again.'
      : e.name === 'NotFoundError' ? 'No microphone found. Plug one in or pick one in your system settings.' : `Couldn't start the microphone: ${e.message}`, 'bad');
    return;
  }
  $('#rec-start').disabled = true; $('#rec-save').hidden = true; $('#rec-play').hidden = true;
  for (const n of [3, 2, 1]) { recStatus(`Starting in ${n}…`); await new Promise(r => setTimeout(r, 700)); }
  const mime = pickMime();
  rec.chunks = []; rec.mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  rec.mr.onstop = () => {
    rec.blob = new Blob(rec.chunks, { type: (rec.mr.mimeType || mime || 'audio/webm') });
    const a = $('#rec-play'); a.src = URL.createObjectURL(rec.blob); a.hidden = false;
    const secs = (Date.now() - rec.t0) / 1000;
    $('#rec-save').hidden = secs < 1;
    recStatus(secs < 10 ? `That was ${Math.round(secs)} seconds: read the whole paragraph (about 20 seconds).` : 'Listen back, then save it, or record again.', secs < 10 ? 'bad' : '');
    rec.mr = null; $('#rec-start').disabled = !$('#consent').checked;
  };
  rec.mr.start(250); rec.t0 = Date.now();
  recStatus('Recording: read the paragraph now.');
  // level meter and timer; Stop is allowed after 10 s, and it stops by itself at 30 s
  rec.ctx = new AudioContext(); const an = rec.ctx.createAnalyser(); an.fftSize = 1024;
  rec.ctx.createMediaStreamSource(rec.stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    an.getFloatTimeDomainData(buf); let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x));
    $('#meter').style.width = `${Math.min(100, peak * 140)}%`; $('#meter').style.background = peak > 0.95 ? 'var(--bad)' : 'var(--ok)';
    const t = (Date.now() - rec.t0) / 1000; $('#rec-time').textContent = fmtTime(t);
    $('#rec-stop').disabled = t < 10;
    if (t >= 30) { stopRecording(); return; }
    rec.raf = requestAnimationFrame(tick);
  };
  tick();
}
function stopRecording(discard = false) {
  cancelAnimationFrame(rec.raf); $('#meter').style.width = '0'; $('#rec-stop').disabled = true;
  if (rec.mr && rec.mr.state !== 'inactive') { if (discard) rec.mr.onstop = () => { rec.mr = null; }; rec.mr.stop(); }
  rec.stream?.getTracks().forEach(t => t.stop()); rec.stream = null;
  rec.ctx?.close().catch(() => {}); rec.ctx = null;
}
$('#rec-start').onclick = startRecording;
$('#rec-stop').onclick = () => stopRecording();
$('#rec-again').onclick = () => { $('#rec-save').hidden = true; $('#rec-play').hidden = true; startRecording(); };
$('#rec-keep').onclick = async () => {
  const name = ($('#rec-name').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || '').slice(0, 30);
  if (!name) { $('#rec-name').focus(); recStatus('Give the voice a name, like me, or the speaker\'s first name.', 'bad'); return; }
  if (!rec.blob) return;
  if (voiceExists(name) && !confirm(`Replace the voice "${name}" with this recording?`)) return;
  $('#rec-keep').disabled = true; recStatus('Checking the recording…');
  try {
    const r = await api(`/api/voices?name=${encodeURIComponent(name)}`, { method: 'POST', body: rec.blob, headers: { 'Content-Type': rec.blob.type.split(';')[0] || 'audio/webm' } });
    follow(r.job, `Saving the voice "${name}"`, async code => {
      $('#rec-keep').disabled = false;
      if (code === 0) {
        voiceChoice = `mine:${name}`; store.set('reelkit.voice', voiceChoice);
        renderVoiceChips(); renderVoiceList(); if (current) renderReelVoice();
        $('#rec-save').hidden = true;
        recStatus(`Saved "${name}". New reels will use it (change that under Voice). Press "Hear it speak" to try it.`, 'good');
      } else {
        const j = await api(`/api/jobs/${r.job}`).catch(() => ({ lines: [] }));
        const why = [...j.lines].reverse().find(l => /^✗ /.test(l) && !/stopped \(exit/.test(l));
        recStatus(why ? why.replace(/^✗ /, '') : 'That recording couldn\'t be used. Try again.', 'bad');
      }
    });
  } catch (e) { $('#rec-keep').disabled = false; recStatus(e.message, 'bad'); }
};
async function hearSample(name) {
  recStatus(state.chatterbox ? `Making a sample of "${name}"…` : `Making a sample of "${name}". The first time downloads the cloning model (about 1.5 GB), so this can take a few minutes.`);
  try {
    const r = await api(`/api/voices/${name}/sample`, { method: 'POST' });
    follow(r.job, `Sample of "${name}"`, code => {
      if (code === 0) { recStatus(`Playing "${name}".`, 'good'); new Audio(`/voices/${name}.sample.wav?v=${Date.now()}`).play(); }
      else recStatus('The sample didn\'t work: see the log below.', 'bad');
    });
  } catch (e) { recStatus(e.message, 'bad'); }
}

// ---------- boot ----------
async function refresh() {
  try { state = await api('/api/state'); } catch (e) { log('✗ ' + e.message); return; }
  renderAgent(); renderStyles(); renderVoiceChips(); renderShelf();
  if ($('#recorder').open) renderVoiceList();
  if (current) { const fresh = state.reels.find(r => r.slug === current.slug); if (fresh) { Object.assign(current, fresh); renderBay(); } }
}
await refresh();
const want = new URLSearchParams(location.search).get('reel');
if (want && state.reels.some(r => r.slug === want)) open(want);
const running = state.jobs.filter(j => j.running).pop();
if (running) follow(running.id, running.label, () => running.reel && state.reels.some(r => r.slug === running.reel) && open(running.reel));
else log('Ready. Write an idea and press Make it, or pick a reel below.');
