#!/usr/bin/env node
// Voice the script: one clip per scene, word timestamps, stitched voiceover, timeline.json.
//   npm run voice -- <reel> [--provider elevenlabs|openai|say|piper|none]
//
// Providers (auto picks the first that works):
//   elevenlabs  ELEVENLABS_API_KEY        best quality, exact word timings
//   openai      OPENAI_API_KEY            good quality, estimated word timings
//   say         macOS built-in, free      robotic but free and offline
//   piper       PIPER_MODEL=/path.onnx    free, open-source, offline (pip install piper-tts)
//   none        silent, timing estimated  for layout drafts
//
// Clips are cached by text+voice, so editing one scene only re-voices that scene.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs, reelDir, readJSON, writeJSON, ffmpegPath, mediaDuration, run, die, which, ROOT } from './lib.mjs';

const args = parseArgs();
const dir = reelDir(args._[0]);
const script = readJSON(path.join(dir, 'script.json'));
const ff = ffmpegPath(); if (!ff) die('ffmpeg not found. Run: npm run doctor -- --fix');
const vcfg = script.voice || {};
const cacheDir = path.join(dir, '.voice-cache'); fs.mkdirSync(cacheDir, { recursive: true });

export function pickProvider(want) {
  if (want && want !== 'auto') return want;
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.platform === 'darwin' && which('say')) return 'say';
  if (process.env.PIPER_MODEL && which('piper')) return 'piper';
  return 'none';
}
const provider = pickProvider(args.provider || vcfg.provider);

// ---------- providers: each returns { wav, words|null } ----------
async function elevenlabs(text, wav) {
  const key = process.env.ELEVENLABS_API_KEY; if (!key) die('ELEVENLABS_API_KEY is not set (put it in .env)');
  const c = vcfg.elevenlabs || {};
  const voiceId = c.voiceId || process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // "George", a stock voice
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: c.model || 'eleven_multilingual_v2', voice_settings: { stability: c.stability ?? 0.45, similarity_boost: c.similarity ?? 0.8, style: c.style ?? 0.3, speed: vcfg.speed ?? 1.05 } }),
  });
  if (!res.ok) die(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();
  const mp3 = wav.replace(/\.wav$/, '.mp3');
  fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
  run(ff, ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '44100', '-ac', '1', wav]); fs.rmSync(mp3);
  const a = j.normalized_alignment || j.alignment; const words = []; let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } return; }
    if (!cur) cur = { w: '', start: a.character_start_times_seconds[i] };
    cur.w += ch; cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return { words };
}

async function openai(text, wav) {
  const key = process.env.OPENAI_API_KEY; if (!key) die('OPENAI_API_KEY is not set (put it in .env)');
  const c = vcfg.openai || {};
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: c.model || 'gpt-4o-mini-tts', voice: c.voice || 'ash', input: text, response_format: 'wav', speed: vcfg.speed ?? 1.05,
      ...(c.instructions ? { instructions: c.instructions } : { instructions: 'Energetic, warm short-form video narrator. Punchy, conversational, not salesy.' }) }),
  });
  if (!res.ok) die(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const raw = wav.replace(/\.wav$/, '.raw.wav');
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  run(ff, ['-y', '-loglevel', 'error', '-i', raw, '-ar', '44100', '-ac', '1', wav]); fs.rmSync(raw);
  return { words: null };
}

async function say(text, wav) {
  const c = vcfg.say || {};
  const aiff = wav.replace(/\.wav$/, '.aiff');
  const rate = Math.round(190 * (vcfg.speed ?? 1));
  run('say', [...(c.voice ? ['-v', c.voice] : []), '-r', String(rate), '-o', aiff, text]);
  run(ff, ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '44100', '-ac', '1', wav]); fs.rmSync(aiff);
  return { words: null };
}

async function piper(text, wav) {
  const model = (vcfg.piper && vcfg.piper.model) || process.env.PIPER_MODEL; if (!model) die('Set PIPER_MODEL to a .onnx voice file');
  const raw = wav.replace(/\.wav$/, '.raw.wav');
  const r = spawnSync('piper', ['--model', model, '--output_file', raw, '--length_scale', String(1 / (vcfg.speed ?? 1))], { input: text, encoding: 'utf8' });
  if (r.status !== 0) die('piper failed: ' + r.stderr);
  run(ff, ['-y', '-loglevel', 'error', '-i', raw, '-ar', '44100', '-ac', '1', wav]); fs.rmSync(raw);
  return { words: null };
}

async function none(text, wav) {
  const n = text.split(/\s+/).filter(Boolean).length;
  const d = n / 2.7 + 0.2 + (text.match(/[.,!?;:—]/g) || []).length * 0.12;
  run(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', d.toFixed(3), wav]);
  return { words: estimateWords(text, 0.05, d - 0.1) };
}

const PROVIDERS = { elevenlabs, openai, say, piper, none };
if (!PROVIDERS[provider]) die(`Unknown voice provider "${provider}". Use: ${Object.keys(PROVIDERS).join(', ')}`);

// ---------- timing helpers ----------
// Spread words over the speech region, weighting by length and punctuation pauses.
function estimateWords(text, s0, s1) {
  const toks = text.split(/\s+/).filter(Boolean);
  const wt = toks.map(w => w.replace(/[^\w]/g, '').length * 1 + 2.2 + (/[.!?]$/.test(w) ? 4 : /[,;:—]$/.test(w) ? 2.5 : 0));
  const pre = toks.map(w => (/[.!?]$/.test(w) ? 4 : /[,;:—]$/.test(w) ? 2.5 : 0));
  const total = wt.reduce((a, b) => a + b, 0); const span = s1 - s0; let acc = 0;
  return toks.map((w, i) => {
    const st = s0 + (acc / total) * span; acc += wt[i];
    const en = s0 + ((acc - pre[i]) / total) * span;
    return { w, start: +st.toFixed(3), end: +en.toFixed(3) };
  });
}

// Find where speech actually starts/ends inside a clip (trims TTS silence padding).
function speechBounds(wav, dur) {
  const r = spawnSync(ff, ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  let s0 = 0, s1 = dur;
  if (starts.length && starts[0] < 0.05 && ends.length) s0 = ends[0];
  if (starts.length && starts[starts.length - 1] > dur * 0.6 && (ends.length < starts.length || ends[ends.length - 1] >= dur - 0.05)) s1 = starts[starts.length - 1];
  return [s0, Math.max(s0 + 0.2, s1)];
}

// ---------- main ----------
const scenes = script.scenes || [];
if (!scenes.length) die('script.json has no scenes');
const ids = new Set();
for (const s of scenes) { if (!s.id || !s.say) die(`every scene needs "id" and "say" (problem: ${JSON.stringify(s).slice(0, 80)})`); if (ids.has(s.id)) die(`duplicate scene id "${s.id}"`); ids.add(s.id); }

console.log(`\n▸ voicing ${scenes.length} scenes with ${provider}${provider === 'none' ? ' (silent draft, timing estimated)' : ''}`);
const clips = [];
for (const s of scenes) {
  const text = s.say.trim();
  const h = crypto.createHash('sha1').update(JSON.stringify([provider, vcfg[provider] || {}, vcfg.speed ?? 1, text])).digest('hex').slice(0, 12);
  const wav = path.join(cacheDir, `${s.id}-${h}.wav`), meta = wav.replace(/\.wav$/, '.json');
  let words;
  if (fs.existsSync(wav) && fs.existsSync(meta)) { words = readJSON(meta).words; process.stdout.write(`  · ${s.id} (cached)\n`); }
  else {
    process.stdout.write(`  · ${s.id} …`);
    const r = await PROVIDERS[provider](text, wav);
    const d = mediaDuration(wav);
    words = r.words || estimateWords(text, ...speechBounds(wav, d));
    writeJSON(meta, { text, words });
    process.stdout.write(` ${d.toFixed(2)}s\n`);
  }
  clips.push({ s, wav, words, dur: mediaDuration(wav) });
}

// stitch: each scene = clip + pause (default 0.2s), padded up to scene.min seconds
const parts = []; const tlScenes = []; let t = 0;
const sr = 44100;
const silence = sec => { const f = path.join(cacheDir, `sil-${sec.toFixed(3)}.wav`); if (!fs.existsSync(f)) run(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=mono`, '-t', sec.toFixed(3), f]); return f; };
clips.forEach((c, i) => {
  const last = i === clips.length - 1;
  let len = c.dur + (c.s.pause ?? (last ? 0.8 : 0.2));
  if (c.s.min && len < c.s.min) len = c.s.min;
  const pad = len - c.dur;
  parts.push(c.wav); if (pad > 0.001) parts.push(silence(pad));
  tlScenes.push({ id: c.s.id, start: +t.toFixed(3), end: +(t + len).toFixed(3), say: c.s.say, words: c.words.map(w => ({ w: w.w, start: +(t + w.start).toFixed(3), end: +(t + w.end).toFixed(3) })) });
  t += len;
});
const list = path.join(cacheDir, 'concat.txt');
fs.writeFileSync(list, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
const audio = provider === 'none' ? null : 'voice.mp3';
if (audio) run(ff, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-b:a', '160k', path.join(dir, audio)]);
else if (fs.existsSync(path.join(dir, 'voice.mp3'))) fs.rmSync(path.join(dir, 'voice.mp3'));

const timeline = { title: script.title || path.basename(dir), fps: script.fps || 30, width: 1080, height: 1920, theme: script.theme || 'paper', captions: script.captions !== false,
  voice: provider, audio, music: script.music || null, musicVolume: script.musicVolume ?? 0.12, duration: +t.toFixed(3), scenes: tlScenes };
writeJSON(path.join(dir, 'timeline.json'), timeline);
console.log(`✓ timeline.json: ${tlScenes.length} scenes, ${t.toFixed(1)}s${audio ? ', voice.mp3' : ''}\n`);
tlScenes.forEach(s => console.log(`  ${s.id.padEnd(16)} ${s.start.toFixed(2).padStart(6)} → ${s.end.toFixed(2).padStart(6)}  ${s.words.map(w => w.w).join(' ')}`));
