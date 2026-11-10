// score-kit: music and sound effects written in code, timed to the reel's timeline.
// Runs inside Tone.Offline in headless Chromium (scripts/score.mjs), so every note is placed by time, not by ear.
//
//   // reels/<slug>/score.js
//   export default function ({ bed, sfx, at }) {
//     bed({ mood: 'warm', bpm: 96, key: 'D' });   // a full backing track for the whole reel
//     sfx.hit('@bland');                           // a thump the instant the narrator says "bland"
//     sfx.scenes('whoosh');                        // a whoosh into every scene after the first
//   }
//
// Full Tone.js is there too ({ Tone }) for anything the kit doesn't cover: https://tonejs.github.io

const MOODS = {
  // chords as scale degrees in a major key; minor moods borrow from the relative minor
  warm:      { bpm: 96,  prog: [['I', 'iii', 'V'], ['vi', 'I', 'iii'], ['IV', 'vi', 'I'], ['V', 'vii', 'ii']], pad: 'triangle', drums: 'soft', bass: 'root2' },
  upbeat:    { bpm: 118, prog: [['I', 'iii', 'V'], ['V', 'vii', 'ii'], ['vi', 'I', 'iii'], ['IV', 'vi', 'I']], pad: 'pluck', drums: 'four', bass: 'octave8' },
  tense:     { bpm: 104, prog: [['vi', 'I', 'iii'], ['IV', 'vi', 'I'], ['I', 'iii', 'V'], ['V', 'vii', 'ii']], pad: 'saw', drums: 'pulse', bass: 'pulse8' },
  lofi:      { bpm: 80,  prog: [['ii', 'IV', 'vi', 'I'], ['V', 'vii', 'ii', 'IV'], ['I', 'iii', 'V', 'vii'], ['vi', 'I', 'iii', 'V']], pad: 'keys', drums: 'swing', bass: 'root2' },
  cinematic: { bpm: 72,  prog: [['vi', 'I', 'iii'], ['IV', 'vi', 'I'], ['I', 'iii', 'V'], ['V', 'vii', 'ii']], pad: 'strings', drums: 'none', bass: 'drone' },
};
const DEG = { I: 0, ii: 2, iii: 4, IV: 5, V: 7, vi: 9, vii: 11 };
const KEYS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function createScore(Tone, tl) {
  const words = tl.scenes.flatMap(s => s.words.map(w => ({ ...w, scene: s.id, n: w.w.toLowerCase().replace(/[^a-z0-9'%$.-]/g, '').replace(/^[.'-]+|[.'-]+$/g, '') })));
  const end = tl.duration;

  // Time from a spec: 4.2 · "intro" (scene start) · "@bland" · "@bland:end" · "@bland#2" (2nd time it's said) · "intro@bland" · "intro+0.5"
  function at(spec) {
    if (typeof spec === 'number') return spec;
    const m = String(spec).match(/^([\w-]*)(?:@([^#:+-]+)(?:#(\d+))?(:end)?)?([+-][\d.]+)?$/);
    if (!m) throw new Error(`score: can't read time "${spec}"`);
    const [, scene, word, nth, isEnd, off] = m;
    let t;
    if (word) {
      const hits = words.filter(w => w.n === word.toLowerCase() && (!scene || w.scene === scene));
      const w = hits[(+nth || 1) - 1]; if (!w) throw new Error(`score: "${word}" is never said${scene ? ` in scene ${scene}` : ''}`);
      t = isEnd ? w.end : w.start;
    } else if (scene) {
      const s = tl.scenes.find(s => s.id === scene); if (!s) throw new Error(`score: no scene "${scene}"`);
      t = s.start;
    } else t = 0;
    return Math.max(0, t + (off ? +off : 0));
  }
  const out = new Tone.Gain(1).toDestination();
  const bus = (db) => new Tone.Volume(db).connect(out);

  // ---------- backing track ----------
  function bed({ mood = 'warm', bpm, key = 'C', from = 0, to = end, volume = -6 } = {}) {
    const M = MOODS[mood]; if (!M) throw new Error(`score: unknown mood "${mood}". Use ${Object.keys(MOODS).join(', ')}`);
    const root = 48 + (KEYS[key] ?? 0); // C3
    const beat = 60 / (bpm || M.bpm), bar = beat * 4;
    const t0 = at(from), t1 = at(to);
    const master = bus(volume);
    const fade = new Tone.Gain(0).connect(master);
    fade.gain.setValueAtTime(0, t0); fade.gain.linearRampToValueAtTime(1, t0 + Math.min(1.2, bar / 2));
    const midi = n => Tone.Frequency(n, 'midi').toNote();
    const chordAt = i => M.prog[i % M.prog.length].map((d, k) => root + 12 + DEG[d] + (k > 0 && DEG[d] < DEG[M.prog[i % M.prog.length][0]] ? 12 : 0));

    const padSynth = {
      triangle: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.5, decay: 0.3, sustain: 0.7, release: 1.4 } }),
      saw: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.3, sustain: 0.6, release: 1 } }),
      pluck: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.2 } }),
      keys: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3, modulationIndex: 2, envelope: { attack: 0.01, decay: 0.8, sustain: 0.2, release: 1 } }),
      strings: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 5, spread: 30 }, envelope: { attack: 1.2, sustain: 0.8, release: 2.5 } }),
    }[M.pad]();
    const lp = new Tone.Filter(M.pad === 'saw' || M.pad === 'strings' ? 1400 : 2600, 'lowpass').connect(fade);
    padSynth.connect(lp); padSynth.volume.value = M.pad === 'pluck' ? -16 : -14;
    const bass = new Tone.MonoSynth({ oscillator: { type: M.bass === 'pulse8' ? 'sawtooth' : 'sine' }, filter: { Q: 1, frequency: 600 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2 } }).connect(fade);
    bass.volume.value = -10;
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(fade); kick.volume.value = -8;
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } });
    hat.connect(new Tone.Filter(8000, 'highpass').connect(fade)); hat.volume.value = -26;

    for (let b = 0, t = t0; t < t1 - 0.05; b++, t += bar) {
      const ch = chordAt(b).map(midi), rootN = midi(chordAt(b)[0] - 24);
      if (M.pad === 'pluck') for (let k = 0; k < 8; k++) { if (k % 2) padSynth.triggerAttackRelease(ch, beat * 0.4, t + k * beat / 2); }
      else padSynth.triggerAttackRelease(ch, Math.min(bar * 0.95, t1 - t), t);
      for (let k = 0; k < 8; k++) {
        const tt = t + k * beat / 2; if (tt >= t1) break;
        if (M.bass === 'root2' && k % 4 === 0) bass.triggerAttackRelease(rootN, beat * 1.6, tt);
        if (M.bass === 'octave8') bass.triggerAttackRelease(k % 2 ? midi(chordAt(b)[0] - 12) : rootN, beat * 0.4, tt);
        if (M.bass === 'pulse8') bass.triggerAttackRelease(rootN, beat * 0.35, tt);
        if (M.bass === 'drone' && k === 0) bass.triggerAttackRelease(rootN, Math.min(bar, t1 - t), tt);
        const swing = M.drums === 'swing' && k % 2 ? beat * 0.12 : 0;
        if ((M.drums === 'four' || M.drums === 'pulse') && k % 2 === 0) kick.triggerAttackRelease('C1', '8n', tt);
        if ((M.drums === 'soft' || M.drums === 'swing') && (k === 0 || k === 4 || (M.drums === 'swing' && k === 5))) kick.triggerAttackRelease('C1', '8n', tt + swing);
        if (M.drums !== 'none' && M.drums !== 'pulse' && (M.drums === 'four' ? k % 2 === 1 : true)) hat.triggerAttackRelease(0.03, tt + swing, k % 2 ? 0.5 : 0.8);
      }
    }
    return { beat, bar, bpm: bpm || M.bpm };
  }

  // ---------- sound effects ----------
  const fx = bus(-4);
  const sfx = {
    // low thump + click: the beat a stamp or a number lands on
    hit(when, { volume = 0 } = {}) {
      const t = at(when);
      const k = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(fx); k.volume.value = volume - 2;
      const n = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(fx); n.volume.value = volume - 14;
      k.triggerAttackRelease('G1', 0.3, t); n.triggerAttackRelease(0.05, t);
    },
    // filtered noise sweep that peaks at the given time (a scene change)
    whoosh(when, { dur = 0.5, volume = 0 } = {}) {
      const t = at(when), s = Math.max(0, t - dur * 0.7);
      const f = new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 1.2 }).connect(fx);
      const n = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: dur * 0.7, decay: dur * 0.3, sustain: 0, attackCurve: 'exponential' } }).connect(f);
      n.volume.value = volume - 6;
      f.frequency.setValueAtTime(300, s); f.frequency.exponentialRampToValueAtTime(4500, t); f.frequency.exponentialRampToValueAtTime(800, t + dur * 0.3);
      n.triggerAttackRelease(dur, s);
    },
    // rising tension that ends exactly on the given time
    riser(when, { dur = 1.5, volume = 0 } = {}) {
      const t = at(when), s = Math.max(0, t - dur);
      const f = new Tone.Filter({ type: 'lowpass', frequency: 200, Q: 4 }).connect(fx);
      const n = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: dur, decay: 0.05, sustain: 0 } }).connect(f);
      const o = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: dur, decay: 0.05, sustain: 0 } }).connect(f);
      n.volume.value = volume - 10; o.volume.value = volume - 20;
      f.frequency.setValueAtTime(200, s); f.frequency.exponentialRampToValueAtTime(6000, t);
      o.frequency.setValueAtTime(110, s); o.frequency.exponentialRampToValueAtTime(880, t);
      n.triggerAttackRelease(dur, s); o.triggerAttackRelease(dur, s);
    },
    // short bubbly blip: something pops onto the screen
    pop(when, { volume = 0, pitch = 'A5' } = {}) {
      const t = at(when);
      const s = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0 } }).connect(fx); s.volume.value = volume - 8;
      s.frequency.setValueAtTime(Tone.Frequency(pitch).toFrequency() * 1.6, t); s.frequency.exponentialRampToValueAtTime(Tone.Frequency(pitch).toFrequency(), t + 0.06);
      s.triggerAttackRelease(pitch, 0.09, t);
    },
    // clock tick / typing click; pass a list of times or { from, to, every }
    tick(when, { volume = 0 } = {}) {
      const times = Array.isArray(when) ? when.map(at) : typeof when === 'object' ? (() => { const r = []; for (let x = at(when.from); x < at(when.to); x += when.every || 0.12) r.push(x); return r; })() : [at(when)];
      const m = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.03, release: 0.01 }, harmonicity: 5.1, modulationIndex: 16, resonance: 3000, octaves: 1 }).connect(fx);
      m.volume.value = volume - 22;
      times.forEach(x => m.triggerAttackRelease('C6', 0.03, x));
    },
    // bell for a reveal or the end card
    ding(when, { volume = 0, note = 'E6' } = {}) {
      const t = at(when);
      const b = new Tone.FMSynth({ harmonicity: 3.01, modulationIndex: 14, envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1 }, modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0 } }).connect(fx);
      b.volume.value = volume - 12; b.triggerAttackRelease(note, 1.2, t);
    },
    // one effect at the start of every scene after the first
    scenes(kind = 'whoosh', opts = {}) { tl.scenes.slice(1).forEach(s => sfx[kind](s.start, opts)); },
  };

  return { Tone, tl, at, bed, sfx, words, duration: end, bus };
}
