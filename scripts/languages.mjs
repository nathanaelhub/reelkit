// Reels in other languages. script.json "language": "es" makes the free voice (Kokoro) speak Spanish with a Spanish
// Kokoro voice, Whisper listen for Spanish when it times the captions, and the agent write the lines in Spanish.
//
// Kokoro reads sounds (phonemes), not letters. For English the model ships a dictionary; for the other languages the
// words are turned into sounds by eSpeak NG, which reelkit downloads once (about 12 MB) into models/espeak-ng the
// first time a reel needs it. eSpeak NG is GPL-3.0 and runs as its own WebAssembly program: it is not part of reelkit's
// code and is not installed by npm install.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { run, ROOT } from './lib.mjs';

// (not imported from speech.mjs, which imports this file)
const MODELS = path.join(ROOT, 'models');
const KOKORO_DIR = path.join(MODELS, 'kokoro-int8-multi-lang-v1_0');

// code → name, eSpeak NG voice, Whisper language, Kokoro voices (first = default). Kokoro v1.0 was trained on these.
export const LANGUAGES = {
  en: { name: 'English', espeak: null, whisper: 'en', voices: [] }, // English uses the voices and dictionary in speech.mjs
  es: { name: 'Spanish', espeak: 'es', whisper: 'es', voices: ['em_alex', 'ef_dora', 'em_santa'] },
  fr: { name: 'French', espeak: 'fr', whisper: 'fr', voices: ['ff_siwis'] },
  it: { name: 'Italian', espeak: 'it', whisper: 'it', voices: ['im_nicola', 'if_sara'] },
  pt: { name: 'Portuguese (Brazil)', espeak: 'pt-br', whisper: 'pt', voices: ['pm_alex', 'pf_dora', 'pm_santa'] },
};
export const languageCodes = () => Object.keys(LANGUAGES);

// "es", "ES", "spanish", "Español" → "es"; null for English or nothing; throws for a language reelkit can't voice.
const ALIASES = { english: 'en', spanish: 'es', español: 'es', espanol: 'es', french: 'fr', français: 'fr', francais: 'fr',
  italian: 'it', italiano: 'it', portuguese: 'pt', português: 'pt', portugues: 'pt', 'pt-br': 'pt' };
export function languageOf(value) {
  if (value == null || value === '') return 'en';
  const v = String(value).trim().toLowerCase();
  const code = LANGUAGES[v] ? v : ALIASES[v];
  if (!code) throw new Error(`reelkit can't voice "${value}" yet. Languages: ${Object.entries(LANGUAGES).map(([c, l]) => `${c} (${l.name})`).join(', ')}`);
  return code;
}

// Which language a Kokoro voice speaks, from its first letter: a/b English, e Spanish, f French, i Italian, p Portuguese.
const VOICE_LANG = { a: 'en', b: 'en', e: 'es', f: 'fr', i: 'it', p: 'pt' };
export const voiceLanguage = v => VOICE_LANG[String(v || '')[0]] || null;

// ---------- eSpeak NG (downloaded on first use) ----------
const ESPEAK = { version: '0.3.5', integrity: 'sha512-Izbkm7NWccwb//RKgOp1/0k21StKN1DFIn+K7GU1XN7n6pmSi4bsk/0tYUsgQbysC4GVyrVompNmLInU/BFE+A==' };
ESPEAK.url = `https://registry.npmjs.org/@echogarden/espeak-ng-emscripten/-/espeak-ng-emscripten-${ESPEAK.version}.tgz`;
export const ESPEAK_DIR = path.join(MODELS, 'espeak-ng');
const espeakJs = () => path.join(ESPEAK_DIR, 'package', 'espeak-ng.js');
export const espeakInstalled = () => fs.existsSync(espeakJs()) && fs.existsSync(path.join(ESPEAK_DIR, 'package', 'espeak-ng.data'));

export async function installEspeak(log = console.log) {
  if (espeakInstalled()) return true;
  fs.mkdirSync(ESPEAK_DIR, { recursive: true });
  log(`▸ downloading eSpeak NG ${ESPEAK.version} (about 12 MB, once) so the free voice can speak other languages`);
  const res = await fetch(ESPEAK.url);
  if (!res.ok) throw new Error(`eSpeak NG download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');
  if (got !== ESPEAK.integrity) throw new Error('eSpeak NG download did not match its checksum; not using it');
  const tgz = path.join(ESPEAK_DIR, 'espeak-ng.tgz');
  fs.writeFileSync(tgz, buf);
  run('tar', ['-xzf', tgz, '-C', ESPEAK_DIR]);
  fs.rmSync(tgz);
  return espeakInstalled();
}

let espeak = null;
async function espeakWorker() {
  if (espeak) return espeak;
  if (!espeakInstalled()) await installEspeak();
  const init = (await import(pathToFileURL(espeakJs()).href)).default;
  const m = await init();
  const worker = new m.eSpeakNGWorker();
  const str = p => { let e = p; while (m.HEAPU8[e]) e++; return Buffer.from(m.HEAPU8.subarray(p, e)).toString('utf8'); };
  // useIpa = 1: phonemes in IPA, "_" between sounds, spaces between words
  return (espeak = { ipa(text, voice) { worker.set_voice(voice); return str(m.getPointer(worker.text_to_phonemes(text, 1))); } });
}

let kokoroSymbols = null;
const symbols = () => kokoroSymbols ??= new Set(fs.readFileSync(path.join(KOKORO_DIR, 'tokens.txt'), 'utf8').split('\n').map(l => l.split(' ')[0]).filter(Boolean));

// Text in another language → { text, lexicon } for Kokoro. Every word becomes a made-up key ("rkwa", "rkwb", …) whose
// sounds come from eSpeak NG, so numbers ("1776" → "mil setecientos setenta y seis"), "30%", "l'eau" and accents all
// reach the voice, whatever sherpa-onnx would have done with them. Punctuation the voice uses for pauses is kept.
const KEEP = new Set([',', '.', '!', '?', ';', ':', '—', '…']);
const key = n => 'rkw' + n.toString(26).split('').map(c => String.fromCharCode(97 + parseInt(c, 26))).join('');
// own: word → Kokoro sounds (space-separated) for words given in script.json "pronounce"; they skip eSpeak.
export async function phonemize(text, language, own = new Map()) {
  const lang = LANGUAGES[languageOf(language)];
  if (!lang.espeak) throw new Error('English uses the Kokoro dictionary, not eSpeak');
  const es = await espeakWorker(), sym = symbols();
  const lines = [], out = [], cache = new Map(), dropped = new Set();
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^([^\p{L}\p{N}$€£]*)(.*?)([^\p{L}\p{N}%]*)$/u);
    const [, , core, post] = m; // leading marks (¿ ¡ « ") are dropped
    const tail = [...post].find(c => KEEP.has(c)) || '';
    if (!core) { if (tail && out.length) out[out.length - 1] += tail; continue; }
    const k = core.toLowerCase();
    if (!cache.has(k)) {
      // one written token can be several spoken words ("1776", "30%"): one key each
      const words = own.has(k) ? [own.get(k)] : es.ipa(core, lang.espeak).replace(/_/g, '').split(/\s+/).filter(Boolean)
        .map(w => [...w.replace(/[-|]/g, '')].filter(c => sym.has(c) || (dropped.add(c), false)).join(' ')).filter(Boolean);
      cache.set(k, words.map(p => { const name = key(lines.length); lines.push(`${name} ${p}`); return name; }));
    }
    const keys = cache.get(k);
    if (keys.length) out.push(keys.join(' ') + tail);
  }
  return { text: out.join(' '), lexicon: lines.join('\n') + '\n', dropped: [...dropped] };
}
