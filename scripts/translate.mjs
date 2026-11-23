#!/usr/bin/env node
// A copy of a reel, set up for another language. The words themselves are translated by your agent (or by
// "Make a version in…" in reelkit studio), because a good translation also moves every word cue in reel.html.
//   npm run translate -- <reel> --to es        → reels/<reel>-es/  (es, fr, it, pt; npm run translate -- --list)
//   then ask your agent: "translate reels/<reel>-es"   (it follows "Another language" in .claude/skills/make-reel/SKILL.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, die, REELS, readJSON, writeJSON } from './lib.mjs';
import { LANGUAGES, languageOf } from './languages.mjs';

// made from the words: voiced again in the new language
const GENERATED = new Set(['voice.mp3', 'timeline.json', 'score.wav', '.voice-cache', '.job']);

export function translateCopy(slug, to, { as = null } = {}) {
  const src = path.join(REELS, slug);
  if (!fs.existsSync(path.join(src, 'script.json'))) throw new Error(`no reel called "${slug}"`);
  const lang = languageOf(to);
  const script = readJSON(path.join(src, 'script.json'));
  const from = languageOf(script.language);
  if (from === lang) throw new Error(`reels/${slug} is already in ${LANGUAGES[lang].name}`);
  const name = as || `${slug.replace(new RegExp(`-${from}$`), '')}-${lang}`;
  const dst = path.join(REELS, name);
  if (fs.existsSync(dst)) throw new Error(`reels/${name} already exists`);
  fs.cpSync(src, dst, { recursive: true, filter: f => !GENERATED.has(path.basename(f)) });
  // the free voice in the new language; your own voice (Chatterbox) speaks English only, so it falls back too
  const voice = { ...(script.voice || {}) };
  if (lang !== 'en' && ['kokoro', 'chatterbox', 'say', 'piper', 'auto', undefined].includes(voice.provider)) {
    voice.provider = 'kokoro'; voice.kokoro = { voice: LANGUAGES[lang].voices[0] }; delete voice.chatterbox;
  } else if (lang === 'en' && voice.provider === 'kokoro') delete voice.kokoro;
  const out = { ...script, language: lang, voice, translatedFrom: { reel: slug, language: from }, translated: false };
  if (lang === 'en') delete out.language;
  writeJSON(path.join(dst, 'script.json'), out);
  const talk = (script.scenes || []).filter(s => s.footage).map(s => s.id);
  return { dir: dst, name, lang, from, talk };
}

function main() {
  const args = parseArgs();
  if (args.list) { for (const [c, l] of Object.entries(LANGUAGES)) console.log(`  ${c}  ${l.name}`); return; }
  const slug = args._[0];
  if (!slug || !args.to) die('Usage: npm run translate -- <reel> --to <es|fr|it|pt|en> [--as <new-name>]');
  try {
    const r = translateCopy(slug, args.to, { as: args.as });
    console.log(`✓ reels/${r.name}: a copy of ${slug} for ${LANGUAGES[r.lang].name} (voice: ${readJSON(path.join(r.dir, 'script.json')).voice?.provider || 'auto'})`);
    if (r.talk.length) console.log(`  ⚠ ${r.talk.join(', ')} use filmed speech, which stays in ${LANGUAGES[r.from].name}`);
    console.log(`  next: ask your agent "translate reels/${r.name}", or press "Make a version in…" in reelkit studio (npm start)`);
  } catch (e) { die(e.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
