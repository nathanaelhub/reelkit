#!/usr/bin/env node
// Your own voices, for Chatterbox cloning: check a recording, clean it, keep it in voices/ (never committed).
//   npm run my-voice -- add <recording> [--name me] --mine   clean, check and save as voices/<name>.wav
//   npm run my-voice -- sample [name] ["text"]               voices/<name>.sample.wav: one line in that voice
//   npm run my-voice -- list
// Then use it in a reel: "voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/me.wav" } }
// or pick it in reelkit studio (npm start), which records it for you.
//
// Only add your own voice, or the voice of someone who has agreed. The studio asks the speaker to read PARAGRAPH, which
// starts by saying so, and only keeps a take where Whisper hears it. That is a nudge, not a lock: script.json can still
// point at any file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, die, run, ffmpegPath, mediaDuration, ROOT, readJSON, writeJSON, TOOL_TIMEOUT } from './lib.mjs';
import { transcribeWords, alignTokens, chatterbox } from './speech.mjs';

export const VOICES = path.join(ROOT, 'voices');
export const PARAGRAPH = "This is my own voice, and I'm recording it for my own videos. Every morning I walk past the bakery on the corner, where warm bread and strong coffee drift out into the street. Sometimes I stop, check the weather, and think about what I'll make next. It's a small routine, but it's a good way to start the day.";
export const SAMPLE_LINE = "Here's how your reels will sound in this voice. Not bad for twenty seconds of reading.";
const MIN_SECONDS = 8, MAX_SECONDS = 30, MIN_WORDS = 15, MIN_MATCH = 0.5;

export const voiceName = n => String(n || 'me').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'me';
export const voiceFile = name => path.join(VOICES, `${voiceName(name)}.wav`);

export function listVoices() {
  if (!fs.existsSync(VOICES)) return [];
  return fs.readdirSync(VOICES).filter(f => /^[a-z0-9-]+\.wav$/.test(f) && !f.endsWith('.sample.wav')).sort().map(f => {
    const name = f.replace(/\.wav$/, ''), meta = path.join(VOICES, `${name}.json`);
    let m = {}; try { if (fs.existsSync(meta)) m = readJSON(meta); } catch {}
    return { name, seconds: m.seconds ?? +mediaDuration(path.join(VOICES, f)).toFixed(1), created: m.created || null,
      hasSample: fs.existsSync(path.join(VOICES, `${name}.sample.wav`)) };
  });
}

// level of the original recording: mean dB and how many samples hit full scale
function levels(file) {
  const e = spawnSync(ffmpegPath(), ['-nostdin', '-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', timeout: TOOL_TIMEOUT, killSignal: 'SIGKILL' }).stderr || '';
  return { mean: +(e.match(/mean_volume: (-?[\d.]+) dB/) || [, -99])[1], clipped: +(e.match(/histogram_0db: (\d+)/) || [, 0])[1] };
}

// Check a recording and save it as voices/<name>.wav (24 kHz mono, silence trimmed, at most 30 s). Throws Error with a
// plain-words fix when it isn't usable.
export async function addVoice(input, { name = 'me', studio = false, log = console.log } = {}) {
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
  const ff = ffmpegPath(); if (!ff) throw new Error('ffmpeg not found. Run: npm run doctor -- --fix');
  name = voiceName(name);
  const lv = levels(input);
  if (lv.mean < -50) throw new Error('That was almost silent. Check the right microphone is selected, move closer, and try again.');
  if (lv.clipped > 2000) throw new Error('That was too loud and distorted. Move back a little or speak more softly, and try again.');
  fs.mkdirSync(VOICES, { recursive: true });
  const tmp = path.join(VOICES, `.${name}.cleaning.wav`);
  try {
    // mono 24 kHz (Chatterbox's own rate), rumble off, quiet ends trimmed, even loudness, 30 s at most
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15';
    run(ff, ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '24000',
      '-af', `highpass=f=70,${trim},areverse,${trim},areverse,loudnorm=I=-20:TP=-2:LRA=11,atrim=0:${MAX_SECONDS}`, '-c:a', 'pcm_s16le', tmp]);
    const seconds = mediaDuration(tmp);
    if (seconds < MIN_SECONDS) throw new Error(`Only ${seconds.toFixed(1)} s of speech came through; it needs at least ${MIN_SECONDS}. Read the whole paragraph at a normal pace.`);
    log(`  cleaned: ${seconds.toFixed(1)} s, listening …`);
    const raw = run(ff, ['-y', '-loglevel', 'error', '-i', tmp, '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], { encoding: 'buffer' });
    const heard = await transcribeWords(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4));
    if (heard.length < MIN_WORDS) throw new Error(`I could only make out ${heard.length} word${heard.length === 1 ? "" : "s"}. Speak clearly, in a quiet room, without music, and try again.`);
    let matched = null;
    if (studio) {
      ({ matched } = alignTokens(PARAGRAPH.split(/\s+/), heard, 0, seconds));
      if (matched < MIN_MATCH) throw new Error(`I couldn't hear the paragraph (${Math.round(matched * 100)}% of its words). Read the text on screen from the start, then save again.`);
    }
    const out = voiceFile(name), existed = fs.existsSync(out);
    fs.renameSync(tmp, out);
    fs.rmSync(path.join(VOICES, `${name}.sample.wav`), { force: true }); // an old sample would be someone else's voice now
    writeJSON(path.join(VOICES, `${name}.json`), { name, seconds: +seconds.toFixed(1), created: new Date().toISOString(),
      consent: studio ? 'recorded in reelkit studio, reading the consent paragraph' : 'added with --mine', paragraphMatch: matched == null ? null : +matched.toFixed(2),
      heard: heard.map(w => w.w).join(' ') });
    log(`✓ ${existed ? 'replaced' : 'saved'} voices/${name}.wav (${seconds.toFixed(1)} s${matched != null ? `, read ${Math.round(matched * 100)}% of the paragraph` : ''})`);
    return { name, seconds, file: out };
  } finally { fs.rmSync(tmp, { force: true }); }
}

export async function sampleVoice(name = 'me', text = SAMPLE_LINE, { log = console.log } = {}) {
  name = voiceName(name);
  const ref = voiceFile(name);
  if (!fs.existsSync(ref)) throw new Error(`no voice called "${name}". npm run my-voice -- list shows them`);
  const out = path.join(VOICES, `${name}.sample.wav`);
  const t0 = Date.now();
  await chatterbox(text, out, { reference: ref, ff: ffmpegPath(), log });
  log(`✓ voices/${name}.sample.wav (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return out;
}

async function main() {
  const args = parseArgs();
  const [cmd, a1, a2] = args._;
  try {
    if (cmd === 'add') {
      if (!a1) die('Usage: npm run my-voice -- add <recording> [--name me] --mine');
      if (!args.mine && !args.studio) die('Only add your own voice, or one whose owner has agreed. Add --mine to confirm.');
      await addVoice(path.resolve(a1), { name: args.name, studio: !!args.studio });
      console.log(`  use it: "voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/${voiceName(args.name)}.wav" } }`);
    } else if (cmd === 'sample') {
      await sampleVoice(a1 || 'me', a2 || SAMPLE_LINE, { log: m => console.log(m) });
    } else if (cmd === 'list' || !cmd) {
      const all = listVoices();
      if (!all.length) console.log('no voices yet: record one in reelkit studio (npm start), or npm run my-voice -- add <recording> --mine');
      for (const v of all) console.log(`  ${v.name.padEnd(14)} ${String(v.seconds).padStart(5)} s  ${v.created ? v.created.slice(0, 10) : ''}  voices/${v.name}.wav`);
    } else die(`unknown command "${cmd}". Use add, sample or list`);
  } catch (e) { die(e.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
