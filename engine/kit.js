/* reelkit runtime — deterministic, time-driven animation for vertical reels.
 *
 * Every visual state is a pure function of time t. The renderer calls
 * window.__reel.seek(t) for each frame and screenshots the stage, so there are
 * no CSS animations, no timers, no randomness without a seed.
 *
 * Markup contract (see .claude/skills/make-reel/guides/scenes.md):
 *   <div id="stage">
 *     <section class="scene" data-scene="hook" data-transition="cut|fade|slide-up|slide-left|zoom|flash">
 *       <h1 data-anim="rise" data-at="@airplane" data-dur="0.5">...</h1>
 *     </section>
 *   </div>
 *   <script src="../../engine/kit.js"></script>
 *   <script>Reel.init()</script>
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const RENDER = params.has('render');

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    linear: t => t,
    in: t => t * t * t,
    out: t => 1 - Math.pow(1 - t, 3),
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
    snap: t => 1 - Math.pow(1 - t, 5),
  };

  // ---------- spring physics (closed form, so every frame is exact) ----------
  // Position of a mass on a spring released from 0 toward 1 with no initial velocity,
  // at time t seconds. stiffness k, damping c, mass m. Overshoots when underdamped.
  function spring(t, k = 170, c = 26, m = 1) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
    return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
  }
  // Time after which the spring stays within 0.1% of its target. Scanned once per
  // parameter set (deterministic), so an ease can map p in [0,1] onto the whole motion.
  const settleCache = {};
  function settleTime(k, c, m) {
    const key = k + ',' + c + ',' + m;
    if (settleCache[key]) return settleCache[key];
    let last = 0;
    for (let t = 0; t <= 20; t += 1 / 480) if (Math.abs(1 - spring(t, k, c, m)) > 0.001) last = t;
    return (settleCache[key] = Math.max(1 / 480, last));
  }
  const springEase = (k, c, m = 1) => { const T = settleTime(k, c, m); return p => (p >= 1 ? 1 : spring(p * T, k, c, m)); };
  const SPRINGS = {
    spring: [170, 26, 1],         // critically damped: arrives fast, no overshoot
    'spring-snappy': [380, 25, 1], // small overshoot (~7%), settles quickly
    'spring-bouncy': [200, 12, 1], // visible bounce (~25% overshoot)
  };
  for (const [name, [k, c, m]] of Object.entries(SPRINGS)) EASE[name] = springEase(k, c, m);
  const isSpring = name => !!name && (name in SPRINGS || /^spring:/.test(name));
  // "spring:k,c[,m]" builds a custom spring; anything else looks up EASE.
  function getEase(name) {
    if (!name) return null;
    const m = String(name).match(/^spring:\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?$/);
    if (m) return springEase(+m[1], +m[2], m[3] ? +m[3] : 1);
    return EASE[name] || null;
  }
  // deterministic noise for wiggle/shake
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const noise = t => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };

  // ---------- entrance presets: p in [0,1] (already eased) -> visual state ----------
  const PRESETS = {
    fade:        p => ({ o: p }),
    rise:        p => ({ o: p, ty: (1 - p) * 90 }),
    drop:        p => ({ o: p, ty: -(1 - p) * 140 }),
    'slide-left':  p => ({ o: p, tx: -(1 - p) * 260 }),
    'slide-right': p => ({ o: p, tx: (1 - p) * 260 }),
    'fly-left':  p => ({ tx: -(1 - p) * 1300 }),
    'fly-right': p => ({ tx: (1 - p) * 1300 }),
    'fly-up':    p => ({ ty: (1 - p) * 2000 }),
    pop:         p => ({ o: clamp(p * 4), s: Math.max(0, p) }),
    zoom:        p => ({ o: clamp(p * 2), s: lerp(1.8, 1, p) }),
    stamp:       p => ({ o: clamp(p * 5), s: lerp(2.6, 1, p), r: lerp(-10, 0, p) }),
    spin:        p => ({ o: clamp(p * 3), s: Math.max(0, p), r: lerp(-200, 0, p) }),
    flip:        p => ({ o: clamp(p * 3), sy: Math.max(0.001, p) }),
    blur:        p => ({ o: p, blur: (1 - p) * 24 }),
    wipe:        p => ({ clip: `inset(-20% ${(1 - p) * 100}% -20% -5%)` }),
    'wipe-up':   p => ({ clip: `inset(${(1 - p) * 100}% -5% -5% -5%)` }),
    'wipe-down': p => ({ clip: `inset(-5% -5% ${(1 - p) * 100}% -5%)` }),
    iris:        p => ({ clip: `circle(${p * 75}% at 50% 50%)` }),
    // these drive content instead of transform; handled specially below
    type: p => ({}), count: p => ({}), draw: p => ({}), mark: p => ({}), none: p => ({}),
  };
  // Everything that moves runs on a spring. Content kinds keep plain curves: a counter must
  // never overshoot its number, and typing/drawing read best at a steady rate.
  const DEFAULT_EASE = { pop: 'spring-bouncy', spin: 'spring-bouncy', flip: 'spring-bouncy', stamp: 'spring-snappy', zoom: 'spring',
    rise: 'spring-snappy', drop: 'spring-snappy', 'slide-left': 'spring-snappy', 'slide-right': 'spring-snappy',
    'fly-left': 'spring-snappy', 'fly-right': 'spring-snappy', 'fly-up': 'spring-snappy',
    fade: 'spring', blur: 'spring', wipe: 'spring', 'wipe-up': 'spring', 'wipe-down': 'spring', iris: 'spring',
    type: 'linear', count: 'out', draw: 'inOut', mark: 'inOut' };
  const CONTENT_KINDS = new Set(['type', 'count', 'draw', 'mark', 'none', 'fade']); // may use any ease
  const DEFAULT_DUR = { pop: 0.45, stamp: 0.3, type: null, count: 1.2, draw: 0.9, mark: 0.5, wipe: 0.5, 'fly-left': 0.55, 'fly-right': 0.55, 'fly-up': 0.6 };

  // ---------- loop presets: lt = seconds since entrance finished ----------
  const LOOPS = {
    float:  (lt, a) => ({ ty: Math.sin(lt * 2.2) * 14 * a }),
    bob:    (lt, a) => ({ ty: Math.abs(Math.sin(lt * 5)) * -12 * a }),
    wiggle: (lt, a) => ({ r: noise(lt * 3) * 4 * a }),
    shake:  (lt, a) => ({ tx: noise(lt * 18) * 10 * a, ty: noise(lt * 18 + 50) * 10 * a }),
    pulse:  (lt, a) => ({ s: 1 + Math.sin(lt * 5) * 0.04 * a }),
    spin:   (lt, a) => ({ r: lt * 60 * a }),
    sway:   (lt, a) => ({ r: Math.sin(lt * 1.6) * 3 * a }),
    drift:  (lt, a) => ({ tx: lt * 18 * a }),
    'zoom-slow': (lt, a) => ({ s: 1 + lt * 0.02 * a }),
    talk:   null, // special: bounces while words are being spoken
  };

  // ---------- state ----------
  const R = {
    timeline: null, scenes: [], globals: [], words: [], phrases: [], hooks: {}, everyFrame: [],
    issues: [], duration: 0, fps: 30, width: 1080, height: 1920, captions: true, t: 0,
  };

  const norm = s => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'%$.-]/g, '').replace(/^[.'-]+|[.'-]+$/g, '');

  // resolve a time spec relative to a scene. Returns scene-local seconds.
  //   "0.4"  "@bland"  "@bland+0.2"  "@bland#2"  "@bland:end"  "end-0.5"  "50%"
  function resolveTime(spec, sc, el) {
    if (spec == null || spec === '') return 0;
    spec = String(spec).trim();
    let m;
    if ((m = spec.match(/^@([^#:+\-\s]+)(?:#(\d+))?(:end)?\s*([+-]\s*[\d.]+)?$/))) {
      const target = norm(m[1]); const nth = m[2] ? +m[2] : 1; let seen = 0;
      for (const w of sc.words) {
        if (norm(w.w) === target && ++seen === nth) {
          const base = (m[3] ? w.end : w.start) - sc.start;
          return Math.max(0, base + (m[4] ? parseFloat(m[4].replace(/\s/g, '')) : 0));
        }
      }
      R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `word "${m[1]}"${nth > 1 ? ' #' + nth : ''} is not spoken in this scene. Spoken: ${sc.words.map(w => w.w).join(' ')}` });
      return 0;
    }
    if ((m = spec.match(/^end\s*([+-]\s*[\d.]+)?$/))) return Math.max(0, sc.dur + (m[1] ? parseFloat(m[1].replace(/\s/g, '')) : 0));
    if ((m = spec.match(/^([\d.]+)%$/))) return sc.dur * parseFloat(m[1]) / 100;
    const n = parseFloat(spec);
    if (isNaN(n)) R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `bad time "${spec}"` });
    return isNaN(n) ? 0 : n;
  }

  function describe(el) {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.');
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return txt ? `${s} "${txt}"` : s;
  }

  // ---------- setup ----------
  function prepareTextNodes(el) {
    const nodes = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) nodes.push({ node: n, text: n.nodeValue });
    return nodes;
  }

  function prepAnim(el, sc) {
    const kind = el.dataset.anim || 'none';
    if (!PRESETS[kind]) R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `unknown data-anim "${kind}". Use one of: ${Object.keys(PRESETS).join(', ')}` });
    const a = {
      el, kind: PRESETS[kind] ? kind : 'fade',
      at: resolveTime(el.dataset.at, sc, el) + (el.__staggerOffset || 0),
      ease: getEase(el.dataset.ease) || EASE[DEFAULT_EASE[kind] || 'spring'],
      out: el.dataset.out || null,
      loop: el.dataset.loop || null,
      amp: el.dataset.amp != null ? parseFloat(el.dataset.amp) : 1,
    };
    if (el.dataset.ease && !getEase(el.dataset.ease)) R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `unknown data-ease "${el.dataset.ease}". Use spring, spring-snappy, spring-bouncy or spring:k,c,m` });
    else if (el.dataset.ease && !CONTENT_KINDS.has(kind) && !isSpring(el.dataset.ease))
      R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `data-ease="${el.dataset.ease}" on a moving "${kind}" entrance. Motion must use a spring: spring, spring-snappy, spring-bouncy or spring:k,c,m` });
    if (el.dataset.outEase && !isSpring(el.dataset.outEase))
      R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `data-out-ease="${el.dataset.outEase}": exits must use a spring too` });
    if (el.dataset.loop && !(el.dataset.loop in LOOPS)) R.issues.push({ level: 'error', scene: sc.id, el: describe(el), msg: `unknown data-loop "${el.dataset.loop}". Use one of: ${Object.keys(LOOPS).join(', ')}` });
    if (a.kind === 'type') {
      a.nodes = prepareTextNodes(el);
      a.len = a.nodes.reduce((s, n) => s + n.text.length, 0);
      a.dur = el.dataset.dur ? parseFloat(el.dataset.dur) : Math.max(0.3, a.len * 0.035);
    } else if (a.kind === 'count') {
      a.from = parseFloat(el.dataset.from || '0'); a.to = parseFloat(el.dataset.to || el.textContent.replace(/[^\d.-]/g, '') || '0');
      a.dec = parseInt(el.dataset.decimals || '0', 10); a.pre = el.dataset.prefix || ''; a.suf = el.dataset.suffix || '';
      a.sep = el.dataset.sep !== 'none';
    } else if (a.kind === 'draw') {
      a.paths = [...el.querySelectorAll('path,line,polyline,polygon,circle,rect,ellipse')].concat(el.matches('path,line,polyline,circle') ? [el] : []);
      a.paths.forEach(p => { let L = 1000; try { L = p.getTotalLength(); } catch (e) {} p.__len = L; p.style.strokeDasharray = L; });
    }
    if (a.dur == null) a.dur = el.dataset.dur ? parseFloat(el.dataset.dur) : (DEFAULT_DUR[kind] || 0.5);
    if (a.out) {
      a.outAt = resolveTime(el.dataset.outAt || 'end-0.35', sc, el);
      a.outDur = el.dataset.outDur ? parseFloat(el.dataset.outDur) : 0.3;
      a.outEase = getEase(el.dataset.outEase) || EASE.spring;
    }
    return a;
  }

  function expandStagger(root) {
    root.querySelectorAll('[data-stagger]').forEach(parent => {
      const step = parseFloat(parent.dataset.stagger) || 0.1;
      const kind = parent.dataset.anim || 'rise';
      const at = parent.dataset.at || '0';
      [...parent.children].forEach((child, i) => {
        if (!child.dataset.anim) child.dataset.anim = kind;
        if (!child.dataset.at) { child.dataset.at = at; child.__staggerOffset = i * step; }
        if (parent.dataset.dur && !child.dataset.dur) child.dataset.dur = parent.dataset.dur;
        if (parent.dataset.loop && !child.dataset.loop) child.dataset.loop = parent.dataset.loop;
      });
      delete parent.dataset.anim; delete parent.dataset.at; delete parent.dataset.stagger;
    });
  }

  function buildPhrases(words) {
    const phrases = []; let cur = [];
    const flush = () => { if (cur.length) phrases.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end, scene: cur[0].scene }); cur = []; };
    words.forEach((w, i) => {
      if (cur.length && (cur[0].scene !== w.scene)) flush();
      cur.push(w);
      const long = cur.reduce((s, x) => s + x.w.length, 0) > 16;
      const gap = words[i + 1] ? words[i + 1].start - w.end > 0.35 : true;
      if (cur.length >= 3 || /[.,!?;:—]$/.test(w.w) || long || gap) flush();
    });
    flush();
    for (let i = 0; i < phrases.length; i++) {
      const nx = phrases[i + 1];
      phrases[i].until = nx && nx.scene === phrases[i].scene ? nx.start : phrases[i].end + 0.5;
    }
    return phrases;
  }

  async function init(opts = {}) {
    if (RENDER) document.body.classList.add('render');
    const tl = opts.timeline && typeof opts.timeline === 'object'
      ? opts.timeline
      : await fetch(opts.timeline || 'timeline.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('timeline.json missing — run: npm run voice -- <reel>'); return r.json(); });
    R.timeline = tl; R.fps = tl.fps || 30; R.duration = tl.duration;
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('No #stage element');
    if (tl.theme) stage.classList.add('theme-' + tl.theme);

    // words with global times
    R.words = [];
    tl.scenes.forEach(s => (s.words || []).forEach(w => R.words.push({ ...w, scene: s.id })));
    R.phrases = buildPhrases(R.words);

    // scenes
    const els = [...stage.querySelectorAll(':scope > .scene')];
    const byId = Object.fromEntries(els.map(e => [e.dataset.scene, e]));
    tl.scenes.forEach((s, i) => {
      const el = byId[s.id];
      if (!el) { R.issues.push({ level: 'error', scene: s.id, msg: `timeline has scene "${s.id}" but reel.html has no <section class="scene" data-scene="${s.id}">` }); return; }
      const sc = { id: s.id, el, start: s.start, end: s.end, dur: s.end - s.start, words: R.words.filter(w => w.scene === s.id), index: i,
        transition: el.dataset.transition || 'cut', tdur: parseFloat(el.dataset.transitionDur || '0.3'), captions: el.dataset.captions || 'on' };
      el.style.zIndex = 10 + i;
      expandStagger(el);
      sc.anims = [...el.querySelectorAll('[data-anim],[data-loop]')].map(a => prepAnim(a, sc));
      el.querySelectorAll('canvas[data-fit]').forEach(c => { const r = c.getBoundingClientRect(); c.width = c.offsetWidth; c.height = c.offsetHeight; });
      R.scenes.push(sc);
    });
    els.forEach(e => { if (!tl.scenes.find(s => s.id === e.dataset.scene)) R.issues.push({ level: 'warn', scene: e.dataset.scene, msg: 'scene exists in reel.html but not in the script/timeline, it will never show' }); });

    // global layer: anything with data-anim directly under #stage (not in a scene) uses global time
    const g = { id: '__global', start: 0, end: R.duration, dur: R.duration, words: R.words, el: stage };
    [...stage.children].filter(c => !c.classList.contains('scene') && c.id !== 'captions').forEach(c => {
      expandStagger(c);
      [c, ...c.querySelectorAll('*')].filter(e => e.dataset && (e.dataset.anim || e.dataset.loop)).forEach(e => R.globals.push(prepAnim(e, g)));
      c.style.zIndex = c.style.zIndex || 40;
    });
    R.globalScene = g;

    // captions
    let cap = document.getElementById('captions');
    if (!cap) { cap = document.createElement('div'); cap.id = 'captions'; stage.appendChild(cap); }
    R.capEl = cap; R.captions = tl.captions !== false && document.body.dataset.captions !== 'off';

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; })));

    seek(0);
    if (!RENDER) mountPreview(stage);
    return R;
  }

  // ---------- per-frame ----------
  function applyAnim(a, lt, sc) {
    const el = a.el;
    let st = {};
    let pIn = a.dur > 0 ? clamp((lt - a.at) / a.dur) : (lt >= a.at ? 1 : 0);
    const e = a.ease(pIn);
    el.style.setProperty('--p', e.toFixed(4));

    if (a.kind === 'type') {
      let n = Math.round(pIn * a.len);
      a.nodes.forEach(t => { const take = Math.max(0, Math.min(t.text.length, n)); t.node.nodeValue = t.text.slice(0, take); n -= take; });
      st.o = lt >= a.at ? 1 : 0;
    } else if (a.kind === 'count') {
      const v = lerp(a.from, a.to, e);
      let s = v.toFixed(a.dec); if (a.sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      el.textContent = a.pre + s + a.suf; st.o = lt >= a.at - 0.001 ? 1 : 0;
    } else if (a.kind === 'draw') {
      a.paths.forEach(p => { p.style.strokeDashoffset = p.__len * (1 - e); });
    } else if (a.kind === 'mark' || a.kind === 'none') {
      // CSS reads --p
    } else {
      st = PRESETS[a.kind](e);
    }

    if (a.out) {
      const po = clamp((lt - a.outAt) / a.outDur);
      if (po > 0) {
        const o2 = PRESETS[a.out] ? PRESETS[a.out](1 - a.outEase(po)) : { o: 1 - po };
        st = { ...st, ...o2, o: (st.o == null ? 1 : st.o) * (o2.o == null ? 1 : o2.o) };
      }
    }

    if (a.loop) {
      const since = lt - (a.at + (el.dataset.anim ? a.dur : 0));
      let l = {};
      if (a.loop === 'talk') {
        const T = sc.start + lt;
        const w = sc.words.find(w => T >= w.start && T < w.end + 0.05);
        if (w) { const k = (T - w.start) / Math.max(0.08, w.end - w.start); l = { ty: -Math.sin(k * Math.PI) * 16 * a.amp, r: Math.sin(T * 9) * 1.5 * a.amp }; }
      } else if (since > 0 || !el.dataset.anim) {
        l = LOOPS[a.loop](Math.max(0, since), a.amp);
      }
      st.tx = (st.tx || 0) + (l.tx || 0); st.ty = (st.ty || 0) + (l.ty || 0);
      st.r = (st.r || 0) + (l.r || 0); if (l.s != null) st.s = (st.s == null ? 1 : st.s) * l.s;
    }

    const s = el.style;
    s.opacity = st.o == null ? '' : String(clamp(st.o));
    s.translate = (st.tx || st.ty) ? `${(st.tx || 0).toFixed(2)}px ${(st.ty || 0).toFixed(2)}px` : '';
    s.rotate = st.r ? `${st.r.toFixed(3)}deg` : '';
    s.scale = st.sy != null ? `1 ${st.sy.toFixed(4)}` : (st.s != null && st.s !== 1 ? st.s.toFixed(4) : '');
    s.filter = st.blur ? `blur(${st.blur.toFixed(2)}px)` : '';
    s.clipPath = st.clip || '';
  }

  function sceneTransition(sc, t) {
    const el = sc.el; const lt = t - sc.start; const p = clamp(lt / sc.tdur); const e = EASE.spring(p); // critically damped: a scene never overshoots its frame
    let tf = '', op = '', clip = '';
    if (sc.index > 0 && lt < sc.tdur) {
      switch (sc.transition) {
        case 'fade': op = String(e); break;
        case 'slide-up': tf = `translateY(${(1 - e) * 1920}px)`; break;
        case 'slide-left': tf = `translateX(${(1 - e) * 1080}px)`; break;
        case 'zoom': tf = `scale(${lerp(1.35, 1, e)})`; op = String(clamp(p * 2.5)); break;
        case 'iris': clip = `circle(${e * 120}% at 50% 50%)`; break;
        case 'flash': el.style.setProperty('--flash', String(1 - p)); break;
      }
    }
    el.style.transform = tf; el.style.opacity = op; el.style.clipPath = clip;
    el.classList.toggle('flashing', sc.transition === 'flash' && lt < sc.tdur);
  }

  function seek(t) {
    R.t = t;
    const scenes = R.scenes;
    scenes.forEach((sc, i) => {
      const next = scenes[i + 1];
      const tail = next && next.transition !== 'cut' ? next.tdur : 0;
      const visible = t >= sc.start && (t < sc.end + tail || (i === scenes.length - 1 && t <= sc.end + 1));
      sc.el.classList.toggle('on', visible);
      if (!visible) return;
      const lt = t - sc.start;
      sceneTransition(sc, t);
      sc.anims.forEach(a => applyAnim(a, lt, sc));
      const hooks = R.hooks[sc.id];
      if (hooks) hooks.forEach(fn => fn(ctxFor(sc, lt, t)));
    });
    R.globals.forEach(a => applyAnim(a, t, R.globalScene));
    R.everyFrame.forEach(fn => fn(ctxFor(R.globalScene, t, t)));
    renderCaptions(t);
  }

  function ctxFor(sc, lt, T) {
    return {
      el: sc.el, $: s => sc.el.querySelector(s), $$: s => [...sc.el.querySelectorAll(s)],
      t: lt, T, dur: sc.dur, p: clamp(lt / sc.dur), words: sc.words,
      word: (w, nth = 1) => resolveTime('@' + w + (nth > 1 ? '#' + nth : ''), sc, null),
      speaking: () => !!sc.words.find(w => T >= w.start && T < w.end),
      ease: EASE, spring, clamp, lerp, noise,
      prog: (from, dur, easeName = 'spring') => (getEase(easeName) || EASE.spring)(clamp((lt - from) / dur)),
    };
  }

  function renderCaptions(t) {
    const cap = R.capEl; if (!cap) return;
    const sc = R.scenes.find(s => t >= s.start && t < s.end) || R.scenes[R.scenes.length - 1];
    const mode = sc ? sc.captions : 'on';
    cap.className = !R.captions || mode === 'off' ? 'off' : mode === 'top' ? 'top' : '';
    const ph = R.phrases.find(p => t >= p.start - 0.02 && t < p.until);
    const key = ph ? ph.start : -1;
    if (cap.__key !== key) {
      cap.__key = key;
      cap.innerHTML = ph ? ph.words.map(w => `<span class="w">${w.w.replace(/[<>&]/g, '')}</span>`).join('') : '';
    }
    if (!ph) return;
    const spans = cap.children;
    ph.words.forEach((w, i) => {
      const nx = ph.words[i + 1];
      spans[i].classList.toggle('on', t >= w.start && t < (nx ? nx.start : ph.until));
      spans[i].classList.toggle('future', t < w.start - 0.02);
    });
    const k = EASE['spring-snappy'](clamp((t - ph.start) / 0.2));
    cap.style.scale = String(lerp(0.82, 1, k));
  }

  // ---------- design rules (enforced by lint) ----------
  // 1. No CSS motion. Render mode forces `transition/animation: none` on every element, so the
  //    computed style can't show them; read the declared styles instead. kit.css's own
  //    `none !important` guard is the only exception.
  function cssMotionIssues() {
    const issues = [];
    const bad = st => {
      const found = [];
      const tp = st.getPropertyValue('transition-property'), td = st.getPropertyValue('transition-duration');
      if ((td && !/^(0s,?\s*)+$/.test(td) && tp !== 'none') || /\btransition\s*:/.test(st.cssText) && !/transition:\s*none/.test(st.cssText)) found.push('transition');
      const an = st.getPropertyValue('animation-name');
      if ((an && an !== 'none') || /\banimation\s*:/.test(st.cssText) && !/animation:\s*none/.test(st.cssText)) found.push('animation');
      return found;
    };
    const walk = (rules, where) => {
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE) issues.push({ level: 'error', scene: '*', el: `@keyframes ${r.name}`, msg: `CSS keyframe animation in ${where}. All motion must come from data-anim or Reel.on (it renders frame by frame).` });
        else if (r.style) bad(r.style).forEach(k => issues.push({ level: 'error', scene: '*', el: r.selectorText, msg: `CSS ${k} in ${where}. Basic CSS ${k}s read as generic and don't render frame by frame; use data-anim with a spring.` }));
        if (r.cssRules) walk(r.cssRules, where);
      }
    };
    for (const sh of document.styleSheets) {
      const where = sh.href ? sh.href.replace(/^.*\/(?=[^/]+$)/, '') : 'an inline <style>';
      if (where === 'kit.css') continue; // engine stylesheet: holds the render-mode `none !important` guard
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      walk(rules, where);
    }
    document.querySelectorAll('#stage [style]').forEach(el => {
      const css = el.getAttribute('style');
      ['transition', 'animation'].forEach(k => { if (new RegExp(`(^|;)\\s*${k}(-[a-z]+)?\\s*:`).test(css) && !new RegExp(`${k}\\s*:\\s*none`).test(css))
        issues.push({ level: 'error', scene: el.closest('.scene')?.dataset.scene || '*', el: describe(el), msg: `inline CSS ${k}. Use data-anim with a spring.` }); });
    });
    return issues;
  }

  // 2. No all-caps centred text on a strong gradient (the generic "AI video" look).
  //    Strong = one full-size gradient layer whose opaque colour stops differ a lot. Subtle
  //    vignettes (one opaque stop over transparent) and small pattern tiles (bg-grid, bg-dots) pass.
  function splitLayers(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  function strongGradient(el) {
    const cs = getComputedStyle(el); if (!cs.backgroundImage || cs.backgroundImage === 'none') return null;
    const layers = splitLayers(cs.backgroundImage), sizes = cs.backgroundSize.split(',').map(s => s.trim());
    for (let i = 0; i < layers.length; i++) {
      if (!/gradient\(/.test(layers[i])) continue;
      const size = sizes[i % sizes.length] || 'auto';
      if (!/^(auto|cover|contain|100% 100%|100%|auto auto)$/.test(size)) continue; // repeating tile = texture, not a gradient fill
      const cols = [...layers[i].matchAll(/rgba?\(([^)]+)\)/g)].map(m => m[1].split(/[\s,/]+/).filter(Boolean).map(Number))
        .filter(c => (c[3] == null ? 1 : c[3]) >= 0.3);
      for (let a = 0; a < cols.length; a++) for (let b = a + 1; b < cols.length; b++) {
        const d = Math.hypot(cols[a][0] - cols[b][0], cols[a][1] - cols[b][1], cols[a][2] - cols[b][2]);
        if (d >= 80) return layers[i].slice(0, 70);
      }
    }
    return null;
  }
  function capsOnGradient(el, cs, x, x2) {
    const own = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.nodeValue).join(' ').trim();
    const letters = own.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) return null;
    const caps = cs.textTransform === 'uppercase' || letters === letters.toUpperCase();
    const centred = cs.textAlign === 'center' || Math.abs((x + x2) / 2 - 540) < 24;
    if (!caps || !centred) return null;
    for (let n = el; n && n.id !== 'stage'; n = n.parentElement) { const g = strongGradient(n); if (g) return g; }
    return strongGradient(document.getElementById('stage'));
  }

  // ---------- lint: called by scripts/check.mjs ----------
  function lint() {
    const out = [...R.issues, ...cssMotionIssues()];
    const stage = document.getElementById('stage').getBoundingClientRect();
    const SAFE = { l: 48, r: 1080 - 48, t: 120, b: 1920 - 200 };
    const capOn = R.captions;
    R.scenes.forEach(sc => {
      if (!sc.anims.length) out.push({ level: 'warn', scene: sc.id, msg: 'nothing animates in this scene, it will look frozen' });
      const last = Math.max(0, ...sc.anims.map(a => a.at + (a.loop ? sc.dur : a.dur)));
      if (sc.dur > 4 && last < sc.dur * 0.45) out.push({ level: 'warn', scene: sc.id, msg: `dead air: all motion finishes by ${last.toFixed(1)}s of a ${sc.dur.toFixed(1)}s scene. Add a beat synced to a later word, or a loop.` });
      const late = sc.anims.filter(a => a.at > sc.dur);
      late.forEach(a => out.push({ level: 'error', scene: sc.id, el: describe(a.el), msg: `starts at ${a.at.toFixed(2)}s but the scene is only ${sc.dur.toFixed(2)}s long` }));

      seek(Math.max(sc.start, sc.end - 0.06));
      const capRect = capOn && sc.captions !== 'off' && R.capEl.children.length ? R.capEl.getBoundingClientRect() : null;
      const all = [...sc.el.querySelectorAll('*')];
      const textBoxes = [];
      all.forEach(el => {
        if (el.closest('[data-bleed]')) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return;
        let o = 1, n = el; while (n && n !== sc.el) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
        if (o < 0.05) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const x = r.left - stage.left, y = r.top - stage.top, x2 = x + r.width, y2 = y + r.height;
        const hasText = [...el.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim());
        if (hasText) {
          if (x < SAFE.l - 1 || x2 > SAFE.r + 1) out.push({ level: x < -2 || x2 > 1082 ? 'error' : 'warn', scene: sc.id, el: describe(el), msg: `text ${x < -2 || x2 > 1082 ? 'is cut off at' : 'too close to'} the side edge (x ${Math.round(x)}–${Math.round(x2)})` });
          if (y < SAFE.t - 1) out.push({ level: y < -2 ? 'error' : 'warn', scene: sc.id, el: describe(el), msg: `text in the top ${SAFE.t}px, where the app UI covers it (y ${Math.round(y)})` });
          if (y2 > SAFE.b + 1) out.push({ level: y2 > 1922 ? 'error' : 'warn', scene: sc.id, el: describe(el), msg: `text in the bottom ${1920 - SAFE.b}px, where the app UI covers it (bottom ${Math.round(y2)})` });
          if (el.scrollWidth > el.clientWidth + 4 && cs.overflow !== 'visible') out.push({ level: 'error', scene: sc.id, el: describe(el), msg: 'text overflows its box' });
          const g = !el.closest('#captions') && capsOnGradient(el, cs, x, x2);
          if (g) out.push({ level: 'error', scene: sc.id, el: describe(el), msg: `all-caps centred text on a colour gradient (${g}…). It's the generic AI-video look: use a solid or textured background, sentence case, or an off-centre layout.` });
          if (capRect && !el.closest('#captions')) {
            const ix = Math.min(x2, capRect.right - stage.left) - Math.max(x, capRect.left - stage.left);
            const iy = Math.min(y2, capRect.bottom - stage.top) - Math.max(y, capRect.top - stage.top);
            if (ix > 20 && iy > 20) out.push({ level: 'warn', scene: sc.id, el: describe(el), msg: `collides with captions (caption band y ${Math.round(capRect.top - stage.top)}–${Math.round(capRect.bottom - stage.top)}). Move it or set data-captions="top" on the scene.` });
          }
        }
        if (hasText && !el.closest('.stamp,[data-overlap]')) { const fs = parseFloat(cs.fontSize) || 40; const inset = Math.min(r.height * 0.3, fs * 0.22); textBoxes.push({ el, x, y: y + inset, x2, y2: y2 - inset }); } // approx. glyph ink, not the font's full line box
        if (x2 < -10 || x > 1090 || y2 < -10 || y > 1930) return; // fully off-stage is a deliberate choice
        if ((x < -40 || x2 > 1120 || y < -40 || y2 > 1960) && r.width < 1400 && hasText) out.push({ level: 'warn', scene: sc.id, el: describe(el), msg: 'partly off-stage' });
      });
      // text colliding with other text (stamps and [data-overlap] are allowed to sit on top)
      for (let i = 0; i < textBoxes.length; i++) for (let j = i + 1; j < textBoxes.length; j++) {
        const a = textBoxes[i], b = textBoxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.x2, b.x2) - Math.max(a.x, b.x), iy = Math.min(a.y2, b.y2) - Math.max(a.y, b.y);
        if (ix > 12 && iy > 12) out.push({ level: 'error', scene: sc.id, el: describe(a.el), msg: `text overlaps ${describe(b.el)}. Move one, or add data-overlap if it is intentional.` });
      }
    });
    // de-dup
    const seen = new Set();
    return out.filter(i => { const k = i.scene + i.el + i.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- live preview ----------
  function mountPreview(stage) {
    const fit = () => {
      const s = Math.min(innerWidth / 1080, (innerHeight - 56) / 1920);
      stage.style.transform = `scale(${s})`;
      stage.style.marginLeft = `${(innerWidth - 1080 * s) / 2}px`;
    };
    fit(); addEventListener('resize', fit);
    const ui = document.createElement('div'); ui.id = 'reel-ui';
    ui.innerHTML = `<button id="rp">▶ play</button><span id="rt">0.00</span><input id="rs" type="range" min="0" max="${R.duration}" step="0.01" value="0"><span id="rn"></span><button id="rc">cc</button>`;
    document.body.appendChild(ui);
    const audio = R.timeline.audio ? new Audio(R.timeline.audio) : null;
    let playing = false, t0 = 0, w0 = 0;
    const now = () => (audio ? audio.currentTime : w0 + (performance.now() - t0) / 1000);
    const btn = ui.querySelector('#rp'), rs = ui.querySelector('#rs'), rt = ui.querySelector('#rt'), rn = ui.querySelector('#rn');
    const show = t => { seek(t); rs.value = t; rt.textContent = t.toFixed(2); const sc = R.scenes.find(s => t >= s.start && t < s.end); rn.textContent = sc ? sc.id : ''; };
    const loop = () => { if (!playing) return; const t = now(); if (t >= R.duration) { pause(); show(R.duration); return; } show(t); requestAnimationFrame(loop); };
    const play = () => { playing = true; btn.textContent = '❚❚ pause'; if (audio) { audio.currentTime = +rs.value; audio.play(); } else { w0 = +rs.value; t0 = performance.now(); } loop(); };
    const pause = () => { playing = false; btn.textContent = '▶ play'; if (audio) audio.pause(); };
    btn.onclick = () => (playing ? pause() : play());
    rs.oninput = () => { pause(); show(+rs.value); };
    ui.querySelector('#rc').onclick = () => { R.captions = !R.captions; show(+rs.value); };
    addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); btn.click(); }
      if (e.code === 'ArrowRight') { pause(); show(Math.min(R.duration, +rs.value + (e.shiftKey ? 1 : 1 / R.fps))); }
      if (e.code === 'ArrowLeft') { pause(); show(Math.max(0, +rs.value - (e.shiftKey ? 1 : 1 / R.fps))); }
    });
    if (params.has('t')) show(parseFloat(params.get('t')));
  }

  // ---------- public API ----------
  window.Reel = {
    init: opts => { const p = init(opts); window.__reel.ready = p.then(() => true); p.catch(err => { console.error(err); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;right:0;background:#b00;color:#fff;padding:20px;font:16px monospace;z-index:9999;white-space:pre-wrap">${err.message}</pre>`); window.__reel.error = err.message; }); return p; },
    on: (sceneId, fn) => { (R.hooks[sceneId] = R.hooks[sceneId] || []).push(fn); },
    every: fn => R.everyFrame.push(fn),
    ease: EASE, spring, clamp, lerp, noise,
  };
  window.__reel = {
    ready: null, error: null,
    seek, lint,
    get duration() { return R.duration; }, get fps() { return R.fps; },
    get scenes() { return R.scenes.map(s => ({ id: s.id, start: s.start, end: s.end })); },
    setCaptions: on => { R.captions = on; },
  };
})();
