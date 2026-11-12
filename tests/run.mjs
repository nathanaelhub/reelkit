#!/usr/bin/env node
// npm test. Each case runs the real scripts and asserts on exit codes and output, so a guard
// only passes when it fails for its own reason.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath, ffprobePath } from '../scripts/lib.mjs';
import { sentences, keepRanges, parseCuts } from '../scripts/footage.mjs';
import { buildTrack } from '../scripts/faces.mjs';
import { numberToWords, prepareForKokoro, alignTokens, cmuToKokoro, kokoroInstalled, sherpaInstalled, inflect } from '../scripts/speech.mjs';

const node = (script, args) => {
  // a hung script fails its case (named in the output) instead of stalling the whole run
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 8 * 60e3 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? `\n[${r.error.code === 'ETIMEDOUT' ? 'timed out after 8 min' : r.error.message}]` : '') };
};
// check a script's exit code, required substrings and forbidden patterns
const expectRun = (r, { exit, expect = [], forbid = [] }) => {
  const missing = expect.filter(s => !r.out.includes(s)), hit = forbid.filter(rx => rx.test(r.out));
  const ok = r.status === exit && !missing.length && !hit.length;
  return { ok, detail: `exit ${r.status} (wanted ${exit})${missing.length ? '\n  missing: ' + missing.join(' | ') : ''}${hit.length ? '\n  should not appear: ' + hit.join(' | ') : ''}\n${r.out}` };
};

const cases = [
  ['speech: numbers, money, years, ratios and ordinals become words', () => {
    const want = { '1776': 'seventeen seventy-six', '2026': 'twenty twenty-six', '2005': 'two thousand five', '1900': 'nineteen hundred',
      '$1,200': 'one thousand two hundred dollars', '30%': 'thirty percent', '3.5': 'three point five', '4th': 'fourth', '21st': 'twenty-first',
      '9:16': 'nine by sixteen', '30,000': 'thirty thousand', '1990s': 'nineteen nineties', '10k': 'ten thousand', 'abc': null };
    const bad = Object.entries(want).filter(([k, v]) => numberToWords(k) !== v).map(([k, v]) => `${k} → ${numberToWords(k)} (want ${v})`);
    return { ok: !bad.length, detail: bad.join('\n  ') };
  }],

  ['speech: Kokoro front end splits compounds, keeps possessives, spells acronyms, builds inflections, reports unknown words', () => {
    const lex = new Set(['visit', 'reel', 'kit', 'budget', 'the', 'hyper', 'frames', 'in', 'cost', 'n', 'a', 's', 'with', 'and']);
    const r = prepareForKokoro("Visit reelkit's budget with NASA & Hyperframes in 1776, Zylqorb!", w => lex.has(w));
    const problems = [];
    if (!r.text.includes("reel kit's budget")) problems.push(`possessive compound: ${r.text}`);
    if (!r.text.includes('N A S A')) problems.push(`acronym: ${r.text}`);
    if (!r.text.includes('hyper frames') || !r.text.includes('seventeen seventy-six,')) problems.push(`compound/number: ${r.text}`);
    if (!r.text.includes(' and ')) problems.push(`ampersand: ${r.text}`);
    if (JSON.stringify(r.unknown) !== '["Zylqorb"]') problems.push(`unknown ${JSON.stringify(r.unknown)}, want ["Zylqorb"]`);
    if (cmuToKokoro('S EY1 B AH0') !== 'sˈAbə') problems.push(`cmu → ${cmuToKokoro('S EY1 B AH0')}`);
    // plurals, past tenses and -ing forms missing from the lexicon are built from their base word
    const P = new Map([['coral', 'k ˈ ɔ ɹ ə l'], ['page', 'p ˈ A ʤ'], ['map', 'm ˈ æ p'], ['carve', 'k ˈ ɑ ɹ v'], ['cut', 'k ˈ ʌ t'], ['jump', 'ʤ ˈ ʌ m p']]);
    const want = { corals: 'k ˈ ɔ ɹ ə l z', pages: 'p ˈ A ʤ ɪ z', mapped: 'm ˈ æ p t', carved: 'k ˈ ɑ ɹ v d', cutting: 'k ˈ ʌ t ɪ ŋ', jumps: 'ʤ ˈ ʌ m p s' };
    for (const [w, p] of Object.entries(want)) if (inflect(w, x => P.get(x)) !== p) problems.push(`${w} → ${inflect(w, x => P.get(x))} (want ${p})`);
    const r2 = prepareForKokoro('Corals carved pages', w => P.has(w), w => P.get(w));
    const r3 = prepareForKokoro("map's", w => P.has(w), w => P.get(w));
    if (JSON.stringify(r3.derived) !== JSON.stringify([["map's", 'm ˈ æ p s']])) problems.push(`possessive: ${JSON.stringify(r3.derived)}`);
    if (r2.unknown.length || r2.derived.length !== 3) problems.push(`inflected sentence: unknown ${r2.unknown}, derived ${JSON.stringify(r2.derived)}`);
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],

  ['align: script words take Whisper\'s times, through number spelling, merges and missed words', () => {
    const heard = [['Why', 0.2, 0.4], ['does', 0.4, 0.7], ['airplane', 0.7, 1.1], ['food', 1.1, 1.5], ['At', 4.8, 5.2], ['30,000', 5.2, 5.9], ['feet,', 5.9, 6.3], ['ur', 6.4, 6.6], ['taste', 6.6, 7.0]]
      .map(([w, start, end]) => ({ w, start, end }));
    const toks = 'Why does airplane food — At thirty thousand feet, your taste'.split(' ');
    const { times, matched } = alignTokens(toks, heard, 0, 7.2);
    const at = w => times[toks.indexOf(w)];
    const problems = [];
    if (at('airplane').start !== 0.7 || at('food').end !== 1.5) problems.push(`airplane/food ${JSON.stringify([at('airplane'), at('food')])}`);
    if (at('thirty').start !== 5.2 || Math.abs(at('thousand').end - 5.9) > 1e-6) problems.push(`thirty thousand ${JSON.stringify([at('thirty'), at('thousand')])}`);
    if (!(at('your').start >= 6.3 && at('your').end <= 6.6 + 1e-6)) problems.push(`unmatched "your" should sit between feet and taste: ${JSON.stringify(at('your'))}`);
    if (!times.every((t, i) => t.end > t.start && (i === 0 || t.start >= times[i - 1].start))) problems.push('times not ordered');
    if (!(matched > 0.7)) problems.push(`matched ${matched}`);
    // Whisper can stamp the last word past the end of the clip; it must land inside it
    const tail = alignTokens(['damage', 'to', 'DNA.'], [{ w: 'damage', start: 1.72, end: 2.12 }, { w: 'to', start: 2.12, end: 2.74 }, { w: 'DNA.', start: 3.96, end: 17.46 }], 0, 3.27).times;
    if (!(tail[2].start >= 2.74 && tail[2].end <= 3.27 + 1e-6)) problems.push(`a word Whisper placed after the clip should fit inside it: ${JSON.stringify(tail[2])}`);
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['styles: one reel renders in each pack, the pack really changes the look, and unknown packs are refused', () => {
    const problems = [];
    const l = node('scripts/styles.mjs', []);
    for (const n of ['riso', 'blueprint', 'engraving', 'terminal']) if (!l.out.includes(n)) problems.push(`npm run styles doesn't list ${n}`);
    // the page background (top-left corner, inside the texture) in each pack, from a 1-frame draft
    const corner = st => {
      const out = path.join(os.tmpdir(), `reelkit-style-${st}.mp4`);
      const r = node('scripts/render.mjs', ['sky-blue', '--draft', '--from', '0.5', '--to', '0.6', '--style', st, '--out', out]);
      if (r.status !== 0) { problems.push(`${st} render failed:\n${r.out}`); return null; }
      const px = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', out, '-frames:v', '1', '-vf', 'crop=40:40:200:20,scale=1:1,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
      fs.rmSync(out, { force: true });
      return [...px];
    };
    const want = { riso: [243, 237, 225], blueprint: [18, 64, 138], terminal: [4, 10, 5] };
    for (const [st, rgb] of Object.entries(want)) {
      const c = corner(st); if (!c) continue;
      if (Math.hypot(...c.map((v, i) => v - rgb[i])) > 45) problems.push(`${st}: background ${c} not near ${rgb}`);
    }
    const bad = node('scripts/render.mjs', ['sky-blue', '--draft', '--style', 'vaporwave']);
    if (bad.status === 0 || !bad.out.includes('unknown style "vaporwave"')) problems.push(`unknown style not refused:\n${bad.out}`);
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['footage: sentences, kept ranges and shot cuts from what Whisper and FFmpeg report', () => {
    const W = (w, start, end) => ({ w, start, end });
    const words = [W('Hi.', 0.5, 0.8), W('This', 1.0, 1.2), W('is', 1.2, 1.3), W('the', 1.3, 1.4), W('first', 1.4, 1.8), W('sentence.', 3.5, 4.0), W('And', 4.2, 4.4), W('a', 4.4, 4.5), W('second', 4.5, 4.9), W('one.', 4.9, 6.0)];
    const problems = [];
    const ss = sentences(words);
    // "Hi." is too short to stand alone, so it joins the next sentence
    if (ss.length !== 2 || ss[0][0].w !== 'Hi.' || ss[1][0].w !== 'And') problems.push(`sentences ${JSON.stringify(ss.map(x => x.map(w => w.w).join(' ')))}`);
    const r = keepRanges(ss[0], { gap: 0.35, pad: 0.08 });
    // the 1.7 s pause before "sentence." is cut; the 0.2 s gap after "Hi." stays
    if (r.length !== 2 || r[0][0] !== 0.42 || r[0][1] !== 1.88 || r[1][0] !== 3.42) problems.push(`keep ranges ${JSON.stringify(r)}`);
    // a silence the audio shows inside a word span Whisper stretched over it is cut too
    const r2 = keepRanges([W('first', 1.0, 3.2), W('sentence.', 3.2, 3.8)], { gap: 0.35, pad: 0.08, silences: [[1.6, 2.9]] });
    if (r2.length !== 2 || r2[0][1] !== 1.68 || r2[1][0] !== 2.82) problems.push(`silence inside a stretched word not cut: ${JSON.stringify(r2)}`);
    // but a "silence" a word starts inside is quiet speech: it stays
    const r3 = keepRanges([W('first', 1.0, 2.0), W('quiet', 2.0, 2.3), W('word.', 2.3, 2.8)], { gap: 0.35, pad: 0.08, silences: [[1.5, 2.6]] });
    if (r3.length !== 1 || r3[0][0] !== 0.92 || r3[0][1] !== 2.88) problems.push(`a silence holding the start of a word should be ignored: ${JSON.stringify(r3)}`);
    const cuts = parseCuts('n:0 pts_time:3.136 x\nn:1 pts_time:3.17 x\nn:2 pts_time:14.882', 0.5);
    if (JSON.stringify(cuts) !== '[3.136,14.882]') problems.push(`cuts ${JSON.stringify(cuts)} (a cut 34 ms after another is the same cut)`);
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['faces: a still face gets one crop, a moving face is followed, no face is centred, and a cut jumps', () => {
    const samples = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 6;
      // 0–3 s: face steady at x 0.30 (detector jitter ±0.01); 3–6 s: face walks 0.3 → 0.7; 6–10 s: nobody
      const f = t < 3 ? [[0.30 + (i % 2 ? 0.01 : -0.01), 0.4, 0.3, 0.9]] : t < 6 ? [[0.3 + 0.4 * (t - 3) / 3, 0.4, 0.3, 0.9]] : [];
      samples.push([+t.toFixed(3), f]);
    }
    const tr = buildTrack(samples, [3, 6], 10);
    const at = t => { let a = tr[0]; for (const p of tr) if (p[0] <= t) a = p; return a; };
    const problems = [];
    const still = tr.filter(p => p[0] < 3);
    if (new Set(still.map(p => p[1])).size !== 1 || Math.abs(still[0][1] - 0.3) > 0.011) problems.push(`steady shot should be one crop near 0.30: ${JSON.stringify(still)}`);
    if (!(at(4)[1] > 0.38 && at(4)[1] < 0.5 && at(5.2)[1] > at(4)[1])) problems.push(`moving face not followed: ${JSON.stringify([at(4), at(5.2)])}`);
    if (at(8)[1] !== 0.5) problems.push(`no face should centre: ${JSON.stringify(at(8))}`);
    if (!(tr.filter(p => p[0] === 3).length >= 2 && tr.filter(p => p[0] === 6).length >= 2)) problems.push('no jump points at the cuts');
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['talk: footage --talk cuts the pauses out, and voice makes a picture clip that matches the sound', () => {
    if (!sherpaInstalled() || !kokoroInstalled()) return { ok: true, skip: 'Kokoro model not downloaded (npm run doctor -- --fix)' };
    const fx = path.resolve('tests/fixtures/talk'), problems = [];
    fs.rmSync(fx, { recursive: true, force: true });
    // a speaker: Kokoro says two sentences with a 1.2 s pause in the middle of the first
    const spk = path.join(fx, 'speaker'), reel = path.join(fx, 'reel');
    fs.mkdirSync(spk, { recursive: true }); fs.mkdirSync(reel, { recursive: true });
    fs.writeFileSync(path.join(spk, 'script.json'), JSON.stringify({ voice: { provider: 'kokoro' }, scenes: [
      { id: 'a', say: 'Here is the first sentence', pause: 1.2 }, { id: 'b', say: 'about cats.', pause: 0.7 }, { id: 'c', say: 'And here is the second one about dogs.', pause: 0.3 }] }));
    const v = node('scripts/voice.mjs', [spk]); if (v.status !== 0) return { ok: false, detail: v.out };
    const dur = +spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(spk, 'voice.mp3')], { encoding: 'utf8' }).stdout;
    // the camera: red, then a cut to blue at 2 s
    // picture first, then the sound (FFmpeg 6.0 writes silent audio when both happen in one pass with -shortest)
    const src = path.join(fx, 'interview.mp4'), pic = path.join(fx, 'picture.mp4');
    spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=red:s=640x360:r=30:d=2`, '-f', 'lavfi', '-i', `color=c=blue:s=640x360:r=30:d=${(dur - 2).toFixed(2)}`,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', pic]);
    spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', pic, '-i', path.join(spk, 'voice.mp3'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', src]);
    fs.writeFileSync(path.join(reel, 'script.json'), JSON.stringify({ title: 'talk' }));
    const f = node('scripts/footage.mjs', [reel, src, '--talk']);
    if (f.status !== 0) return { ok: false, detail: f.out };
    const meta = JSON.parse(fs.readFileSync(path.join(reel, 'footage', 'interview.json'), 'utf8'));
    if (!meta.cuts.some(c => Math.abs(c - 2) < 0.1)) problems.push(`shot cut at 2 s not found: ${JSON.stringify(meta.cuts)}`);
    const sc = JSON.parse(fs.readFileSync(path.join(reel, 'script.json'), 'utf8')).scenes;
    // how Whisper punctuates Kokoro's sentences varies, so the scene count may too; the pauses must go either way
    if (sc.length < 1 || sc.length > 3) problems.push(`${sc.length} scenes, wanted 1 to 3: ${sc.map(s => s.say).join(' | ')}`);
    if (!sc.some(s => s.footage.cut.length >= 2)) problems.push(`no pause cut inside any sentence: ${JSON.stringify(sc.map(s => s.footage.cut))}`);
    const v2 = node('scripts/voice.mjs', [reel]);
    if (v2.status !== 0) return { ok: false, detail: v2.out + `\nsilences ${JSON.stringify(meta.silences)}\nwords ${JSON.stringify(meta.words)}\ncuts ${JSON.stringify(sc.map(s => s.footage.cut))}` };
    const probe = file => +spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout;
    const tl = JSON.parse(fs.readFileSync(path.join(reel, 'timeline.json'), 'utf8'));
    for (const s of tl.scenes) {
      const clip = probe(path.join(reel, 'assets', `${s.id}.talk.mp4`)), len = s.end - s.start;
      if (Math.abs(clip - len) > 0.05) problems.push(`${s.id}: picture ${clip.toFixed(3)}s but sound ${len.toFixed(3)}s`);
      if (!s.words.every(w => w.start >= s.start - 1e-6 && w.end <= s.end + 1e-6)) problems.push(`${s.id}: words outside the scene`);
    }
    if (tl.voice !== 'footage') problems.push(`timeline voice ${tl.voice}`);
    if (!(tl.duration < dur - 0.8)) problems.push(`talk is ${tl.duration}s, source speech ${dur.toFixed(2)}s: the pause should be gone`);
    return { ok: !problems.length, detail: problems.join('\n  ') + '\n' + f.out };
  }],

  ['kokoro: voices a reel locally with numbers and a phoneme, timed by Whisper', () => {
    if (!sherpaInstalled() || !kokoroInstalled()) return { ok: true, skip: 'Kokoro model not downloaded (npm run doctor -- --fix)' };
    const fx = path.resolve('tests/fixtures/kokoro');
    fs.rmSync(path.join(fx, '.voice-cache'), { recursive: true, force: true });
    const v = node('scripts/voice.mjs', [fx]);
    if (v.status !== 0) return { ok: false, detail: v.out };
    const tl = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8'));
    const words = tl.scenes.flatMap(s => s.words), problems = [];
    if (tl.voice !== 'kokoro') problems.push(`voice ${tl.voice}`);
    if ((v.out.match(/aligned timing/g) || []).length !== 2) problems.push('both scenes should be aligned by Whisper');
    if (words.map(w => w.w).join(' ') !== 'In 1776, reelkit cost $1,200. Welcome to Saba.') problems.push(`captions "${words.map(w => w.w).join(' ')}"`);
    if (!words.every((w, i) => w.end > w.start && (i === 0 || w.start >= words[i - 1].start))) problems.push('word times not ordered');
    // "1776" is spoken as four words, so it must take far longer than a short word
    const yr = words[1], inW = words[0];
    if (!(yr.end - yr.start > 2 * (inW.end - inW.start))) problems.push(`1776 spans ${(yr.end - yr.start).toFixed(2)}s, "In" ${(inW.end - inW.start).toFixed(2)}s`);
    return { ok: !problems.length, detail: problems.join('\n  ') + '\n' + v.out };
  }],

  ['score: score.js renders to the reel\'s exact length, audibly, and the same every time (to rounding)', () => {
    const fx = path.resolve('tests/fixtures/score'), wav = path.join(fx, 'score.wav');
    if (!fs.existsSync(path.join(fx, 'timeline.json'))) { const v = node('scripts/voice.mjs', [fx]); if (v.status !== 0) return { ok: false, detail: v.out }; }
    const pcm = () => { const b = fs.readFileSync(wav); return new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1); };
    const r1 = node('scripts/score.mjs', [fx]); const p1 = pcm();
    const r2 = node('scripts/score.mjs', [fx]); const p2 = pcm();
    if (r1.status !== 0 || r2.status !== 0) return { ok: false, detail: r1.out + r2.out };
    const tl = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8')), problems = [];
    const d = +spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).stdout;
    if (Math.abs(d - tl.duration) > 0.02) problems.push(`score ${d}s, reel ${tl.duration}s`);
    // Chromium's audio thread can round a handful of samples differently (±1 of 32768); anything more is a real difference
    let worst = p1.length === p2.length ? 0 : Infinity; for (let i = 0; i < p1.length && worst < 3; i++) worst = Math.max(worst, Math.abs(p1[i] - p2[i]));
    if (worst > 2) problems.push(`two renders differ (largest sample difference ${worst})`);
    const peak = +(r1.out.match(/peak (-?[\d.]+) dBFS/) || [])[1];
    if (!(peak > -20 && peak < 0)) problems.push(`peak ${peak} dBFS`);
    return { ok: !problems.length, detail: problems.join('\n  ') + '\n' + r1.out };
  }],

  ['mix: the score ducks under the voice and comes back in the pauses', () => {
    if (!sherpaInstalled() || !kokoroInstalled()) return { ok: true, skip: 'Kokoro model not downloaded (npm run doctor -- --fix)' };
    const fx = path.resolve('tests/fixtures/duck'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-'));
    const v = node('scripts/voice.mjs', [fx]); if (v.status !== 0) return { ok: false, detail: v.out };
    const out = path.join(tmp, 'd.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, detail: r.stdout + r.stderr }; }
    const tl = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8'));
    const level = (t0, t1) => { const e = spawnSync(ffmpegPath(), ['-hide_banner', '-ss', String(t0), '-t', String(t1 - t0), '-i', out, '-af', 'bandpass=f=6000:w=60,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; return +(e.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]; };
    const w = tl.scenes[0].words, speaking = level(w[1].start, w[w.length - 2].end);
    const gap = level(tl.scenes[0].words.at(-1).end + 0.7, tl.scenes[1].start - 0.1);
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: gap - speaking >= 3, detail: `tone at ${speaking} dB while speaking, ${gap} dB in the pause (want ≥ 3 dB louder in the pause)` };
  }],

  ['depth: a camera move shifts near pixels and leaves far ones still', () => {
    const fx = path.resolve('tests/fixtures/depth'), as = path.join(fx, 'assets'); fs.mkdirSync(as, { recursive: true });
    const mk = (args, out) => spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', args, '-frames:v', '1', path.join(as, out)], { encoding: 'utf8' });
    mk('color=white:s=1080x1920,drawgrid=w=90:h=1920:t=30:c=black', 'stripes.png');
    mk('color=black:s=1080x1920,drawbox=x=0:y=0:w=540:h=1920:color=white:t=fill', 'stripes-map.png');
    const v = node('scripts/voice.mjs', [fx]); if (v.status !== 0) return { ok: false, detail: v.out };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'd.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    const dur = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8')).duration;
    const row = t => spawnSync(ffmpegPath(), ['-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=iw:1:0:ih/2,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
    const a = row(0.05), b = row(dur - 0.1), w = a.length;
    fs.rmSync(tmp, { recursive: true, force: true });
    const diff = (x0, x1) => { let d = 0; for (let x = x0; x < x1; x++) d += Math.abs(a[x] - b[x]); return d / (x1 - x0); };
    const near = diff(Math.round(w * 0.08), Math.round(w * 0.42)), far = diff(Math.round(w * 0.6), Math.round(w * 0.92));
    return { ok: near > 15 && far < 3, detail: `mean pixel change: near half ${near.toFixed(1)}, far half ${far.toFixed(1)} (want near > 15, far < 3; the stripes are a third black, so ~30 is a full shift)` };
  }],

  ['depth: npm run depth makes a map the size of the photo', () => {
    const fx = path.resolve('tests/fixtures/depth'), as = path.join(fx, 'assets'), photo = path.join(as, 'scene.png'), map = path.join(as, 'scene.depth.png');
    fs.mkdirSync(as, { recursive: true });
    // a floor that gets nearer towards the bottom, with a box standing on it
    spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=s=640x480:c0=0x87ceeb:c1=0x2e8b57:x0=0:y0=0:x1=0:y1=480,drawbox=x=260:y=220:w=120:h=160:color=0x8b4513:t=fill', '-frames:v', '1', photo]);
    fs.rmSync(map, { force: true });
    const html = path.join(fx, 'reel.html'), orig = fs.readFileSync(html, 'utf8');
    fs.writeFileSync(html, orig + '\n<!-- <canvas data-depth="assets/scene.png"> -->');
    const r = node('scripts/depth.mjs', [fx]);
    fs.writeFileSync(html, orig);
    if (r.status !== 0 || !fs.existsSync(map)) return { ok: false, detail: r.out };
    const size = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', map], { encoding: 'utf8' }).stdout.trim();
    return { ok: size === '640,480', detail: `map ${size}, want 640,480\n${r.out}` };
  }],

  ['gl transitions: render blends the two scenes mid-way, and check rejects unknown names with a suggestion', () => {
    const fx = path.resolve('tests/fixtures/gl');
    const v = node('scripts/voice.mjs', [fx]); if (v.status !== 0) return { ok: false, detail: v.out };
    const tl = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8')), b = tl.scenes[1].start;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'g.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--from', String(b - 0.3), '--to', String(b + 1.3), '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    // share of red (scene B's background) pixels in the frame, sampled small
    const red = t => { const px = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=54:96,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
      let n = 0; for (let i = 0; i < px.length; i += 3) if (px[i] > 150 && px[i + 1] < 90 && px[i + 2] < 90) n++; return n / (px.length / 3); };
    const before = red(0.1), mid = red(0.3 + 0.62), after = red(1.5);
    fs.rmSync(tmp, { recursive: true, force: true });
    const problems = [];
    if (!(before < 0.02 && after > 0.85)) problems.push(`red share before ${before.toFixed(2)}, after ${after.toFixed(2)}`);
    if (!(mid > 0.1 && mid < 0.9)) problems.push(`mid-transition red share ${mid.toFixed(2)}: should be a blend of both scenes`);
    const html = path.join(fx, 'reel.html'), orig = fs.readFileSync(html, 'utf8');
    fs.writeFileSync(html, orig.replace('gl:InkBleed', 'gl:InkBled'));
    const c = node('scripts/check.mjs', [fx]);
    fs.writeFileSync(html, orig);
    if (c.status === 0 || !c.out.includes('unknown transition "gl:InkBled"') || !c.out.includes('gl:InkBleed')) problems.push('check should fail on gl:InkBled and suggest gl:InkBleed:\n' + c.out);
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],

  ['16:9: voices at 1920x1080, keeps phoneme words written, passes the check, renders wide at the target loudness', () => {
    const fx = path.resolve('tests/fixtures/wide'), problems = [];
    // a quiet tone as music, so the final loudness pass has real work to do (about -30 LUFS in, -14 out)
    spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=330:d=6,volume=-28dB', '-ac', '2', path.join(fx, 'music.wav')]);
    fs.rmSync(path.join(fx, '.voice-cache'), { recursive: true, force: true });
    const v = node('scripts/voice.mjs', [fx]);
    if (v.status !== 0) return { ok: false, detail: v.out };
    const tl = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8'));
    if (tl.width !== 1920 || tl.height !== 1080) problems.push(`timeline ${tl.width}x${tl.height}`);
    const words = tl.scenes[0].words.map(w => w.w).join(' ');
    if (words !== 'Welcome to Saba today.') problems.push(`words "${words}"`);
    const c = node('scripts/check.mjs', [fx]);
    if (c.status !== 0) problems.push('check failed:\n' + c.out);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'w.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: problems.join('\n') + r.stdout + r.stderr };
    const size = spawnSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().replace(/,+$/, '');
    if (size !== '960,540') problems.push(`draft size ${size}, wanted 960,540`);
    const e = spawnSync(ffmpegPath(), ['-hide_banner', '-nostats', '-i', out, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const lufs = +(e.slice(e.lastIndexOf('Summary:')).match(/I:\s+(-?[\d.]+) LUFS/) || [])[1];
    if (!(Math.abs(lufs + 14) <= 1)) problems.push(`loudness ${lufs} LUFS, wanted -14 ±1`);
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],

  ['pronounce: the voice gets the replacement, captions keep the written words', () => {
    const fx = path.resolve('tests/fixtures/pronounce');
    fs.rmSync(path.join(fx, '.voice-cache'), { recursive: true, force: true });
    const r = node('scripts/voice.mjs', [fx, '--provider', 'none']);
    if (r.status !== 0) return { ok: false, detail: r.out };
    const sc = JSON.parse(fs.readFileSync(path.join(fx, 'timeline.json'), 'utf8')).scenes[0];
    const got = sc.words.map(w => w.w).join(' '), want = 'Welcome to Saba. Visit sabanrealty.com.';
    const ordered = sc.words.every((w, i) => w.end > w.start && (i === 0 || w.start >= sc.words[i - 1].end - 1e-6));
    // 9 spoken words take longer than the 5 written ones would: the last word must end late in the clip
    const lastEnd = sc.words[sc.words.length - 1].end;
    return { ok: got === want && ordered && lastEnd > 2.5, detail: `words "${got}" (want "${want}"), ordered ${ordered}, last word ends ${lastEnd}s` };
  }],

  ['clips: every rendered frame shows its exact source frame', () => {
    const fx = path.resolve('tests/fixtures/clip'), vid = path.join(fx, 'assets', 'ramp.webm');
    fs.mkdirSync(path.dirname(vid), { recursive: true });
    // 4 s at 30 fps; frame N has brightness (N * 8) mod 256, so one frame of lag is visible
    if (!fs.existsSync(vid)) {
      const g = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=4,format=gray,geq=lum=mod(N*8\\,256)',
        '-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '10', vid], { encoding: 'utf8' });
      if (g.status !== 0) return { ok: false, detail: 'could not make ramp.webm: ' + g.stderr };
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'f.mp4');
    const from = 0.5, n = 8; // data-from=1: scene time t shows source time 1 + t
    const r = spawnSync(process.execPath, ['scripts/render.mjs', fx, '--draft', '--fps', '30', '--from', String(from), '--to', String(from + n / 30), '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    const raw = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', out, '-vf', 'crop=4:4:iw/2:ih/2,scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
    fs.rmSync(tmp, { recursive: true, force: true });
    const problems = [];
    for (let i = 0; i < n; i++) {
      const want = (Math.round((1 + from + i / 30) * 30) * 8) % 256, got = raw[i];
      if (got == null || Math.abs(got - want) > 3) problems.push(`frame ${i}: brightness ${got}, source frame wants ${want}`);
    }
    return { ok: !problems.length, detail: problems.join('\n  ') };
  }],
  ['render: a 1 s draft is standard yuv420p, limited range, bt709', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-')), out = path.join(tmp, 'clip.mp4');
    const r = spawnSync(process.execPath, ['scripts/render.mjs', 'airplane-food', '--draft', '--from', '0', '--to', '1', '--out', out], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, detail: r.stdout + r.stderr };
    const p = spawnSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=pix_fmt,color_range,color_space', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().replace(/,+$/, '');
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: p === 'yuv420p,tv,bt709', detail: `ffprobe: ${p} (wanted yuv420p,tv,bt709)` };
  }],

  ['example reel passes the self-check', () => expectRun(node('scripts/check.mjs', ['airplane-food']), { exit: 0 })],

  ['design rules: each banned pattern fails for its own reason, controls pass', () => expectRun(node('scripts/check.mjs', [path.resolve('tests/fixtures/rules')]), {
    exit: 2,
    expect: [
      'data-ease="out" on a moving "rise" entrance',
      '.card-x: CSS transition in an inline <style>',
      '@keyframes wobble: CSS keyframe animation',
      'inline CSS animation',
      '"Game changer": all-caps centred text on a colour gradient',
      '5 errors',
    ],
    forbid: [/Pattern ok.*all-caps/, /Vignette ok.*all-caps/],
  })],

  ['taste: a reel slower than its references gets a pacing warning', () => expectRun(node('scripts/check.mjs', ['airplane-food', '--taste', path.resolve('tests/fixtures/taste-fast')]), {
    exit: 0, expect: ['slower than the', 'they show something new every 0.8s', 'taste "'],
  })],

  ['ref: measures cuts, colours and loudness, and keeps hand-written notes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelkit-test-'));
    const vid = path.join(tmp, 'three-shots.mp4'), taste = path.join(tmp, 'taste');
    // white, black, blue: one second each, with a tone, so cuts land at exactly 1s and 2s
    const f = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error',
      ...['white', 'black', '0x2050c0'].flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=360x640:d=1:r=30`]),
      '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid], { encoding: 'utf8' });
    if (f.status !== 0) return { ok: false, detail: 'could not make the test video: ' + f.stderr };
    const r1 = node('scripts/ref.mjs', [taste, vid]);
    const mf = path.join(taste, 'refs', 'three-shots.metrics.json');
    if (r1.status !== 0 || !fs.existsSync(mf)) return { ok: false, detail: r1.out };
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const near = (hex, rgb) => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.hypot(...v.map((x, i) => x - rgb[i])) < 40; };
    const problems = [];
    if (JSON.stringify(m.cuts) !== '[1,2]') problems.push(`cuts ${JSON.stringify(m.cuts)}, wanted [1,2]`);
    if (m.shots !== 3 || m.avgShot !== 1) problems.push(`shots ${m.shots}, avgShot ${m.avgShot}`);
    if (!(m.motion < 0.01)) problems.push(`motion ${m.motion} for still shots, wanted < 0.01`);
    if (m.beats.length !== 0 || m.pace !== 1) problems.push(`beats ${JSON.stringify(m.beats)}, pace ${m.pace}: still shots have no beats, pace = shot length`);
    if (!m.palette.some(h => near(h, [255, 255, 255])) || !m.palette.some(h => near(h, [0, 0, 0])) || !m.palette.some(h => near(h, [32, 80, 192]))) problems.push(`palette ${m.palette}`);
    if (typeof m.lufs !== 'number') problems.push('no loudness');
    if (!fs.existsSync(path.join(taste, 'refs', 'three-shots.sheet.jpg'))) problems.push('no contact sheet');
    // notes outside the measured block survive a re-measure
    const md = path.join(taste, 'taste.md');
    fs.appendFileSync(md, '\nMY NOTE: keep the hold on the logo.\n');
    const r2 = node('scripts/ref.mjs', [taste]);
    const text = fs.readFileSync(md, 'utf8');
    if (r2.status !== 0) problems.push('re-measure failed: ' + r2.out);
    if (!text.includes('MY NOTE: keep the hold on the logo.')) problems.push('re-measure dropped the hand-written note');
    if ((text.match(/measured:start/g) || []).length !== 1) problems.push('measured block duplicated');
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: !problems.length, detail: problems.join('\n  ') + '\n' + r1.out };
  }],
];

let failed = 0;
const tty = process.stdout.isTTY;
for (const [name, fn] of cases) {
  if (!tty) console.log(`… ${name}`); // in CI, a case that hangs is the last one named
  const t0 = Date.now();
  const { ok, detail, skip } = fn();
  console.log(`${skip ? '–' : ok ? '✓' : '✗'} ${name}${skip ? ` (skipped: ${skip})` : ''}${tty ? '' : ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`}`);
  if (!ok) { failed++; console.log(detail.split('\n').map(l => '    ' + l).join('\n')); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
