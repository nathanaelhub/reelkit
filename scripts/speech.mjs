// Local speech: Kokoro text-to-speech (sherpa-onnx) and Whisper word alignment (transformers.js).
// Both run on your machine with open weights (Apache-2.0), so the free path needs no key and the
// voices can be used in reels you sell.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, run } from './lib.mjs';

const require = createRequire(import.meta.url);
export const MODELS = path.join(ROOT, 'models');
export const KOKORO_DIR = path.join(MODELS, 'kokoro-int8-multi-lang-v1_0');
export const KOKORO_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2';
export const WHISPER_MODEL = 'onnx-community/whisper-base_timestamped';

// Kokoro v1.0 speaker ids (from the model's metadata). a = American, b = British; f/m = female/male.
export const KOKORO_VOICES = ('af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky ' +
  'am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa bf_alice bf_emma bf_isabella bf_lily ' +
  'bm_daniel bm_fable bm_george bm_lewis').split(' ');
export const KOKORO_DEFAULT = 'am_michael';
// bump when the text front end changes what Kokoro is asked to say, so cached clips are re-voiced
export const KOKORO_FRONTEND = 2;

export const kokoroInstalled = () => fs.existsSync(path.join(KOKORO_DIR, 'model.int8.onnx'));
export const sherpaInstalled = () => { try { require.resolve('sherpa-onnx-node'); return true; } catch { return false; } };

// Download + unpack the Kokoro model (about 130 MB). Uses the system tar, which reads .tar.bz2 on macOS, Linux and Windows 10+.
export async function installKokoro(log = console.log) {
  if (kokoroInstalled()) return true;
  fs.mkdirSync(MODELS, { recursive: true });
  const tarball = path.join(MODELS, path.basename(KOKORO_URL));
  log(`▸ downloading Kokoro voice model (~130 MB) from ${new URL(KOKORO_URL).host}`);
  const res = await fetch(KOKORO_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  run('tar', ['-xjf', tarball, '-C', MODELS]);
  fs.rmSync(tarball);
  return kokoroInstalled();
}

// ---------- numbers to words ----------
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
function intWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + intWords(n % 100) : '');
  for (const [v, w] of SCALES) if (n >= v) return intWords(Math.floor(n / v)) + ' ' + w + (n % v ? ' ' + intWords(n % v) : '');
  return String(n);
}
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const ordinal = w => w.replace(/(\w+)$/, last => ORD[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th'));
const year = n => (n % 100 === 0 ? intWords(n / 100) + ' hundred' : n >= 2000 && n < 2010 ? intWords(n) : intWords(Math.floor(n / 100)) + ' ' + (n % 100 < 10 ? 'oh ' + ONES[n % 100] : intWords(n % 100)));

// One written token ("$1,200", "30%", "3.5", "1776", "4th", "9:16") to spoken words, or null if it isn't a number.
export function numberToWords(tok) {
  const m = tok.match(/^([$€£]?)(\d[\d,]*)(?:\.(\d+))?(%|st|nd|rd|th|s|k|m|bn)?$/i);
  if (!m) { const r = tok.match(/^(\d+)[:x×/](\d+)$/); return r ? `${intWords(+r[1])} ${tok.includes(':') ? 'by' : tok.includes('/') ? 'over' : 'by'} ${intWords(+r[2])}` : null; }
  const [, cur, intPart, dec, suf = ''] = m;
  if (/^\d{1,3}(,\d{3})+$/.test(intPart) === false && intPart.includes(',')) return null;
  const n = +intPart.replace(/,/g, '');
  if (!Number.isSafeInteger(n)) return null;
  const s = suf.toLowerCase();
  let words = !cur && !dec && !intPart.includes(',') && n >= 1100 && n <= 2099 && (s === '' || s === 's') ? year(n) : intWords(n);
  if (dec) words += ' point ' + [...dec].map(d => ONES[+d]).join(' ');
  if (s === 's') words = words.replace(/(\w+)$/, w => (w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's'));
  if (['st', 'nd', 'rd', 'th'].includes(s)) words = ordinal(words);
  if (s === 'k') words += ' thousand';
  if (s === 'm') words += ' million';
  if (s === 'bn') words += ' billion';
  if (s === '%') words += ' percent';
  if (cur) words += { $: n === 1 && !dec ? ' dollar' : ' dollars', '€': ' euros', '£': ' pounds' }[cur];
  return words;
}

// ---------- Kokoro lexicon front end ----------
// sherpa-onnx v2 reads Kokoro pronunciations from a lexicon and silently SKIPS any word it doesn't know.
// So every word is resolved before synthesis: numbers become words, unknown compounds are split into
// known words ("reelkit" → "reel kit"), and anything left is reported so it can go in script.json "pronounce".
const lexCache = new Map();
function loadLexicon(file) {
  if (!lexCache.has(file)) {
    const map = new Map(); // word → phoneme tokens ("k ˈ ɔ ɹ ə l")
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const sp = line.indexOf(' '); if (sp > 0 && !map.has(line.slice(0, sp))) map.set(line.slice(0, sp), line.slice(sp + 1).trim()); }
    lexCache.set(file, map);
  }
  return lexCache.get(file);
}

// Inflected forms the lexicon lacks ("corals", "carved", "cutting") built from a known base word plus the
// ending's sound. Returns phoneme tokens or null.
const VOICELESS = new Set(['p', 't', 'k', 'f', 'θ']), SIBILANT = new Set(['s', 'z', 'ʃ', 'ʒ', 'ʧ', 'ʤ']);
const lastSound = p => p.trim().split(/\s+/).filter(x => !/[ˈˌː]/.test(x)).pop();
// the sound of a plural or possessive ending after these phonemes: z, s or ɪz
const sEnding = p => (SIBILANT.has(lastSound(p)) ? ' ɪ z' : VOICELESS.has(lastSound(p)) ? ' s' : ' z');
export function inflect(w, phon) {
  if (/'s$/.test(w)) { const p = phon(w.slice(0, -2)) || inflect(w.slice(0, -2), phon); return p ? p + sEnding(p) : null; }
  const last = lastSound;
  const tries = [];
  if (/[^s]s$/.test(w)) tries.push([w.slice(0, -1), 's']);
  if (/(s|x|z|ch|sh)es$/.test(w)) tries.push([w.slice(0, -2), 's']);
  if (/[^aeiou]ies$/.test(w)) tries.push([w.slice(0, -3) + 'y', 's']);
  if (/ed$/.test(w)) tries.push([w.slice(0, -2), 'd'], [w.slice(0, -1), 'd']);
  if (/([^aeiou])\1ed$/.test(w)) tries.push([w.slice(0, -3), 'd']);
  if (/ing$/.test(w)) tries.push([w.slice(0, -3), 'ing'], [w.slice(0, -3) + 'e', 'ing']);
  if (/([^aeiou])\1ing$/.test(w)) tries.push([w.slice(0, -4), 'ing']);
  for (const [base, end] of tries) {
    const p = phon(base); if (!p) continue;
    const l = last(p);
    if (end === 's') return p + (SIBILANT.has(l) ? ' ɪ z' : VOICELESS.has(l) ? ' s' : ' z');
    if (end === 'd') return p + (l === 't' || l === 'd' ? ' ɪ d' : VOICELESS.has(l) || SIBILANT.has(l) && l !== 'z' && l !== 'ʒ' && l !== 'ʤ' ? ' t' : ' d');
    if (end === 'ing') return p + ' ɪ ŋ';
  }
  return null;
}

// Split an unknown word into the fewest known words (each at least 2 letters, "a" and "i" excepted).
function splitCompound(w, has) {
  const n = w.length, best = new Array(n + 1).fill(null); best[0] = [];
  for (let i = 1; i <= n; i++) for (let j = Math.max(0, i - 20); j < i; j++) {
    const part = w.slice(j, i);
    if (best[j] && (part.length >= 2 || part === 'a' || part === 'i') && has(part) && (!best[i] || best[j].length + 1 < best[i].length)) best[i] = [...best[j], part];
  }
  return best[n] && best[n].length <= 3 ? best[n] : null;
}

const LETTER = /[\p{L}']/u;
// Returns { text, unknown[], derived[] }: text Kokoro can say in full, the words it still can't, and lexicon
// entries built for inflected forms (pass phon = word → phonemes to enable those).
export function prepareForKokoro(text, has, phon = null) {
  const unknown = [], derived = [];
  const words = text.replace(/&/g, ' and ').replace(/\+/g, ' plus ').split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const m = tok.match(/^([^\p{L}\p{N}$€£]*)(.*?)([^\p{L}\p{N}%]*)$/u);
    const [, pre, core, post] = m;
    if (!core) return tok;
    const num = numberToWords(core.replace(/[’]/g, "'"));
    if (num) return pre + num + post;
    const out = core.split(/[-–/]/).filter(Boolean).map(part => {
      const lw = part.toLowerCase().replace(/’/g, "'");
      if (has(lw)) return part;
      // possessive of a known word: sherpa skips "earth's", so build its entry
      if (/'s$/.test(lw) && has(lw.slice(0, -2))) { const p = phon && inflect(lw, phon); if (p) derived.push([lw, p]); return part; }
      if (/^[A-Z]{2,5}$/.test(part) && [...lw].every(c => has(c))) return [...part].join(' '); // acronyms: spell out
      const num2 = numberToWords(part);
      if (num2) return num2;
      const inf = phon && /^[a-z]+$/.test(lw) ? inflect(lw, phon) : null;
      if (inf) { derived.push([lw, inf]); return part; }
      const poss = /'s$/.test(lw) ? "'s" : '';
      const split = LETTER.test(lw) ? splitCompound((poss ? lw.slice(0, -2) : lw).replace(/'/g, ''), has) : null;
      if (split) {
        if (poss && phon) { const last = split[split.length - 1], p = inflect(last + "'s", phon); if (p) derived.push([last + "'s", p]); }
        return split.join(' ') + poss;
      }
      unknown.push(part);
      return part;
    }).join(' ');
    return pre + out + post;
  }).join('');
  return { text: words, unknown: [...new Set(unknown)], derived };
}

// ---------- phonemes (script.json "pronounce" { "cmu": … } / { "ipa": … }) to Kokoro's symbols ----------
const ARPA = { AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'W', AY: 'I', B: 'b', CH: 'ʧ', D: 'd', DH: 'ð', EH: 'ɛ', ER: 'ɜɹ', EY: 'A', F: 'f', G: 'ɡ',
  HH: 'h', IH: 'ɪ', IY: 'i', JH: 'ʤ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', OW: 'O', OY: 'Y', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't',
  TH: 'θ', UH: 'ʊ', UW: 'u', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ' };
export function cmuToKokoro(cmu) {
  return cmu.trim().split(/\s+/).map(p => {
    const m = p.toUpperCase().match(/^([A-Z]+)([012])?$/); if (!m || !ARPA[m[1]]) throw new Error(`unknown CMU phoneme "${p}"`);
    let s = ARPA[m[1]];
    if (m[1] === 'AH' && m[2] === '0') s = 'ə';
    if (m[1] === 'ER' && m[2] === '0') s = 'əɹ';
    return (m[2] === '1' ? 'ˈ' : m[2] === '2' ? 'ˌ' : '') + s;
  }).join('');
}
export function ipaToKokoro(ipa) {
  return ipa.replace(/[/\[\]]/g, '').replace(/eɪ/g, 'A').replace(/oʊ|əʊ/g, 'O').replace(/aɪ/g, 'I').replace(/aʊ/g, 'W').replace(/ɔɪ/g, 'Y')
    .replace(/tʃ/g, 'ʧ').replace(/dʒ/g, 'ʤ').replace(/r/g, 'ɹ').replace(/g/g, 'ɡ').replace(/[ˑ.]/g, '');
}

// ---------- Kokoro synthesis ----------
let tts = null, ttsKey = '';
export function kokoro(text, wav, { voice = KOKORO_DEFAULT, speed = 1, extraLexicon = null } = {}) {
  if (!sherpaInstalled()) throw new Error('sherpa-onnx-node is not installed. Run: npm install');
  if (!kokoroInstalled()) throw new Error('Kokoro model not downloaded. Run: npm run doctor -- --fix');
  const sid = KOKORO_VOICES.indexOf(voice);
  if (sid < 0) throw new Error(`unknown Kokoro voice "${voice}". English voices: ${KOKORO_VOICES.join(', ')}`);
  const base = path.join(KOKORO_DIR, voice[0] === 'b' ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt');
  const base0 = loadLexicon(base), extra = extraLexicon && fs.existsSync(extraLexicon) ? loadLexicon(extraLexicon) : new Map();
  const { text: said, unknown, derived } = prepareForKokoro(text, w => base0.has(w) || extra.has(w), w => extra.get(w) || base0.get(w));
  if (unknown.length) throw new Error(`Kokoro doesn't know how to say: ${unknown.join(', ')}. Add a respelling to script.json "pronounce" (e.g. "${unknown[0]}": "…") or a phoneme ({ "ipa": "…" }).`);
  // inflected forms go in a growing lexicon beside the model; the voice reloads only when a new word appears
  const auto = path.join(MODELS, `kokoro-derived-${voice[0] === 'b' ? 'gb' : 'us'}.txt`);
  const autoMap = fs.existsSync(auto) ? loadLexicon(auto) : new Map();
  const fresh = derived.filter(([w]) => !autoMap.has(w));
  if (fresh.length) { fresh.forEach(([w, p]) => autoMap.set(w, p)); fs.writeFileSync(auto, [...autoMap].map(([w, p]) => `${w} ${p}`).join('\n') + '\n'); }
  const lexicon = [extra.size && extraLexicon, autoMap.size && auto, base].filter(Boolean).join(',');
  const key = lexicon + ':' + autoMap.size;
  if (!tts || ttsKey !== key) {
    const sherpa = require('sherpa-onnx-node'); kokoroLoaded = true;
    tts = new sherpa.OfflineTts({ model: { kokoro: { model: path.join(KOKORO_DIR, 'model.int8.onnx'), voices: path.join(KOKORO_DIR, 'voices.bin'),
      tokens: path.join(KOKORO_DIR, 'tokens.txt'), lexicon }, numThreads: 4, debug: false }, maxNumSentences: 1 });
    ttsKey = key;
  }
  const a = tts.generate({ text: said, sid, speed });
  require('sherpa-onnx-node').writeWave(wav, { samples: a.samples, sampleRate: a.sampleRate });
  return said;
}

// Write a per-reel lexicon for phoneme pronunciations, so Kokoro says "Saba" exactly as given.
export function writeExtraLexicon(file, entries) {
  const lines = entries.map(([word, phon]) => `${word.toLowerCase()} ${[...phon].join(' ')}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// ---------- Whisper word alignment ----------
// Whisper hears the clip and gives each heard word a time. The script's words (what captions show) are then
// matched to the heard words, so captions keep the script's spelling and only the timing comes from Whisper.
const norm = w => w.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, '');
function expand(tok) { // a token as comparable words: "30,000" → ["thirty", "thousand"]
  const core = tok.replace(/^[^\p{L}\p{N}$€£]+|[^\p{L}\p{N}%]+$/gu, '');
  const n = numberToWords(core);
  return (n || core).replace(/-/g, ' ').split(/\s+/).map(norm).filter(Boolean);
}
function similar(a, b) {
  if (a === b) return 2;
  if (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a))) return 1;
  // one edit apart (Whisper spelling a name differently)
  if (Math.abs(a.length - b.length) <= 1 && a.length > 3) { let i = 0; while (a[i] === b[i]) i++; if (a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)) return 1; }
  return -1;
}

// Pure alignment: target tokens (script words) + heard words [{w,start,end}] → [{start,end}] per target token.
export function alignTokens(tokens, heard, clipStart = 0, clipEnd = null) {
  const T = []; tokens.forEach((tok, i) => { const ex = expand(tok); (ex.length ? ex : ['']).forEach(w => T.push({ w, i })); });
  // Whisper sometimes stamps the last word past the end of the audio (start beyond it, end many seconds out): a word
  // that starts after the clip is treated as unheard, and every end is held inside the clip
  if (clipEnd != null) heard = heard.filter(h => h.start < clipEnd - 0.02).map(h => ({ ...h, end: Math.min(h.end, clipEnd) }));
  const H = []; heard.forEach(h => expand(h.w).forEach((w, k, all) => {
    const d = (h.end - h.start) / all.length; H.push({ w, start: h.start + k * d, end: h.start + (k + 1) * d });
  }));
  const n = T.length, m = H.length, GAP = -1;
  const S = Array.from({ length: n + 1 }, (_, i) => Float64Array.from({ length: m + 1 }, (_, j) => (i + j) * GAP));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    S[i][j] = Math.max(S[i - 1][j - 1] + similar(T[i - 1].w, H[j - 1].w), S[i - 1][j] + GAP, S[i][j - 1] + GAP);
  const match = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (S[i][j] === S[i - 1][j - 1] + similar(T[i - 1].w, H[j - 1].w)) { if (similar(T[i - 1].w, H[j - 1].w) > 0) match[i - 1] = H[j - 1]; i--; j--; }
    else if (S[i][j] === S[i - 1][j] + GAP) i--; else j--;
  }
  // fill unmatched words by spreading them between their matched neighbours, weighted by length
  const end0 = clipEnd ?? (H.length ? H[H.length - 1].end : clipStart + 0.3 * n);
  const times = new Array(n);
  for (let i = 0; i < n;) {
    if (match[i]) { times[i] = { start: match[i].start, end: match[i].end }; i++; continue; }
    let j = i; while (j < n && !match[j]) j++;
    const a = i > 0 ? times[i - 1].end : (H.length ? Math.min(H[0].start, clipStart + 0.05) : clipStart);
    const b = j < n ? match[j].start : end0;
    const wts = T.slice(i, j).map(t => t.w.length + 2), tot = wts.reduce((x, y) => x + y, 0); let acc = 0;
    for (let k = i; k < j; k++) { const s = a + (b - a) * acc / tot; acc += wts[k - i]; times[k] = { start: s, end: a + (b - a) * acc / tot }; }
    i = j;
  }
  const out = tokens.map(() => null);
  T.forEach((t, k) => { const o = out[t.i]; out[t.i] = o ? { start: o.start, end: times[k].end } : { ...times[k] }; });
  return { times: out.map(o => ({ start: +o.start.toFixed(3), end: +Math.max(o.end, o.start + 0.04).toFixed(3) })), matched: match.filter(Boolean).length / Math.max(1, n) };
}

let asr = null;
export async function transcribeWords(wav16k) {
  if (!asr) {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(MODELS, 'transformers');
    asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8' });
  }
  const out = await asr(wav16k, { return_timestamps: 'word', chunk_length_s: 30, language: 'en' });
  // Whisper splits "30,000" into "30" + ",000"; a chunk without a leading space belongs to the word before it
  const words = [];
  for (const c of out.chunks || []) {
    if (words.length && !/^\s/.test(c.text)) { const w = words[words.length - 1]; w.w += c.text; w.end = c.timestamp[1] ?? w.end; }
    else words.push({ w: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.2 });
  }
  return words.filter(w => w.w);
}

// Align a voiced clip (any sample rate) to its script text. Returns [{w,start,end}] or null if alignment can't run.
export async function alignClip(wav, text, ff) {
  const raw = wav.replace(/\.wav$/, '.16k.f32');
  run(ff, ['-y', '-loglevel', 'error', '-i', wav, '-ar', '16000', '-ac', '1', '-f', 'f32le', raw]);
  let heard, samples;
  if (useWorker()) { samples = fs.statSync(raw).size / 4; heard = await workerTranscribe(raw); fs.rmSync(raw); }
  else {
    const buf = fs.readFileSync(raw); fs.rmSync(raw);
    const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    samples = audio.length; heard = await transcribeWords(audio);
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  const { times, matched } = alignTokens(tokens, heard, 0, samples / 16000);
  return { words: tokens.map((w, i) => ({ w, ...times[i] })), matched };
}

// ---------- Whisper in its own process ----------
// On Windows, sherpa-onnx (Kokoro) and onnxruntime-node (Whisper) each ship an onnxruntime.dll; once Kokoro has loaded
// its copy, Whisper's binding gets that one and fails ("The operating system cannot run %1"). So after Kokoro has run,
// Windows transcribes in a child process with a clean DLL table. REELKIT_WHISPER_WORKER=1 forces this anywhere (tests).
let kokoroLoaded = false;
const useWorker = () => process.env.REELKIT_WHISPER_WORKER === '1' || (process.platform === 'win32' && kokoroLoaded);
let worker = null;
function startWorker() {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'whisper-worker.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = []; let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const w = waiting.shift(); if (!w) continue;
      const m = JSON.parse(line); m.error ? w.reject(new Error(m.error)) : w.resolve(m.words);
    }
  });
  child.on('exit', code => { worker = null; while (waiting.length) waiting.shift().reject(new Error(`Whisper worker exited (${code})`)); });
  return { child, waiting };
}
function workerTranscribe(raw) {
  if (!worker) worker = startWorker();
  return new Promise((resolve, reject) => { worker.waiting.push({ resolve, reject }); worker.child.stdin.write(raw + '\n'); });
}
export function stopWhisperWorker() { if (worker) { worker.child.stdin.end(); worker = null; } }
