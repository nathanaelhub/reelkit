# Kit reference: building scenes in reel.html

`reel.html` is a normal HTML page with a 1080×1920 `#stage`. `engine/kit.js` drives every pixel from time `t`, so the renderer can step through frames exactly. You describe motion with data attributes.

```html
<link rel="stylesheet" href="../../engine/kit.css">
<div id="stage">
  <section class="scene bg-paper" data-scene="hook">            <!-- id must match script.json -->
    <div class="pad kicker" style="top:170px" data-anim="fade">// 01 · the question</div>
    <h1 class="pad headline" style="top:230px" data-anim="rise">Why is <em>this</em> a thing?</h1>
    <div class="abs stamp" style="left:250px;top:700px" data-anim="stamp" data-at="@thing">NOPE</div>
  </section>
  <!-- more scenes… -->
  <div class="abs note" style="left:72px;top:1660px" data-anim="fade">@handle</div>  <!-- global layer: outside scenes, shows all reel long -->
</div>
<script src="../../engine/kit.js"></script>
<script>Reel.init();</script>
```

## Entrances: `data-anim`

Every entrance that moves runs on a spring by default (see Motion below).

| value | what it does | default ease |
|---|---|---|
| `fade` `rise` `drop` `slide-left` `slide-right` | fade in, optionally moving up/down/sideways | spring-snappy (fade: spring) |
| `fly-left` `fly-right` `fly-up` | travel in from off-screen, no fade | spring-snappy |
| `pop` | scale from 0 with overshoot | spring-bouncy |
| `zoom` | shrink in from 1.8× | spring |
| `stamp` | slam down from 2.6× (pair with `.stamp`) | spring-snappy |
| `spin` `flip` `blur` | rotate in / flip vertically / unblur | spring-bouncy (blur: spring) |
| `wipe` `wipe-up` `wipe-down` `iris` | reveal with a clip mask | spring |
| `type` | typewriter: reveals the element's text (keeps inner markup) | linear |
| `count` | counts a number: `data-from="0" data-to="30" data-prefix="−" data-suffix="%" data-decimals="0"` | out |
| `draw` | draws SVG strokes inside the element (paths, lines, circles) | inOut |
| `mark` | only sets CSS `--p` from 0→1; use with `.hl`, `.strike`, `.circle-mark`, `.bar-fill` | inOut |

## Timing

| attribute | meaning |
|---|---|
| `data-at="0.4"` | seconds after the scene starts (default 0) |
| `data-at="@bland"` | the moment the narrator **starts** saying "bland" in this scene |
| `data-at="@bland:end"` | when they **finish** the word |
| `data-at="@bland+0.2"` / `"@so-0.1"` | offset from the word |
| `data-at="@the#2"` | second occurrence of "the" in the scene |
| `data-at="end-0.5"` / `"60%"` | relative to the scene's end / length |
| `data-dur="0.6"` | animation length (defaults ~0.5s; `type` scales with text length) |
| `data-ease="spring|spring-snappy|spring-bouncy|spring:k,c,m"` | motion feel (see Motion). `type`, `count`, `draw`, `mark` and `fade` may also use `linear|out|in|inOut` |

Word matching ignores case and punctuation ("bland?" matches `@bland`). An unknown word is reported by `npm run check` with the list of words actually spoken.

## Motion: springs only

All motion uses closed-form spring physics, and `npm run check` enforces it:

| ease | feel |
|---|---|
| `spring` | critically damped: arrives fast, no overshoot. Fades, zooms, wipes, scene transitions |
| `spring-snappy` | ~7% overshoot, settles quickly. Rises, slides, fly-ins, stamps |
| `spring-bouncy` | ~25% overshoot, visible bounce. Pops, spins, playful hits |
| `spring:k,c,m` | your own stiffness, damping, mass (e.g. `spring:300,15,1`) |

`data-dur` is how long the spring takes to settle (within 0.1%), so a longer duration is a slower spring with the same feel. Exits (`data-out`) default to `spring`; `data-out-ease` must also be a spring.

The check fails on:
- a non-spring `data-ease` on a moving entrance (`rise`, `pop`, `fly-*` …)
- any CSS `transition`, CSS `animation` or `@keyframes` in your styles or inline styles (they look generic and don't render frame by frame)
- all-caps centred text on a strong colour gradient (the generic AI-video look). Solid colours, textures like `bg-grid`/`bg-dots`, and the subtle `bg-paper` vignette are fine.

## Exits, loops, stagger

- `data-out="fade"` (any entrance name, played backwards) + `data-out-at="@word"` (default `end-0.35`) + `data-out-dur`.
- `data-loop="float|bob|wiggle|shake|pulse|sway|spin|drift|zoom-slow|talk"` keeps an element alive after it enters. `data-amp="0.5"` scales it. `talk` bounces only while words are being spoken (good for a host character).
- `data-stagger="0.12"` on a parent animates its children one after another, using the parent's `data-anim` / `data-at`.

## Scene options

- `data-transition="cut|fade|slide-up|slide-left|zoom|iris|flash"` + `data-transition-dur="0.3"`: how this scene enters. Mix them, but cut is the reel default; use the others at section changes.
- `data-captions="on|top|off"`: move captions to the top for scenes with a lot of content in the lower half; off for the outro.
- Backgrounds: `bg-paper` `bg-grid` `bg-dots` `bg-halftone` `bg-accent` `bg-cork`, or your own CSS.

## Building blocks (kit.css)

Type: `.kicker` (mono label), `.headline` (with `<em>` for red serif-italic accent words), `.display` (tall condensed caps), `.huge`, `.body`, `.note`, `.accent`.
Objects: `.card`, `.polaroid > .photo`, `.sticky`, `.pin`, `.chip` (`.chip.red`), `.step-badge`, `.stamp`, `.sticker`, `.emoji`, `.window > .bar + .body` (app window with `.line.ok` / `.line.run` rows, `.input`), `.phone > .screen`, `.bar-track > .bar-fill`.
Marks driven by `--p`: `.hl` (highlighter), `.strike`, `.circle-mark`, `.bar-fill`.
Layout: `.abs`, `.pad` (absolute, 72px side margins), `.center`, `.center-x`, `.row`, `.stack`, `.center-text`.
Themes on `script.json` `theme`: `paper` (cream, black, red), `ink` (dark), `pop` (yellow/blue), `cork` (bulletin board).

Positioning with `transform` is fine (kit animates with the separate `translate`/`rotate`/`scale` properties, so they stack).

## Custom motion: `Reel.on`

When data attributes aren't enough (charts, canvas, physics, anything computed), register a hook. It runs every frame while the scene is visible and must depend only on time.

```js
Reel.on('numbers', ({ $, t, dur, p, word, prog, lerp, ease, speaking }) => {
  // t = seconds into scene, p = t/dur, word('drop') = when "drop" starts (scene seconds)
  const k = prog(word('drop'), 1.4);                   // 0→1 spring over 1.4s starting at "drop" (default 'spring')
  $('#salt').style.width = lerp(100, 70, k) + '%';
});
Reel.every(({ T }) => { /* runs on every frame, T = reel time */ });
```

`spring(t, stiffness, damping, mass)` is in the hook context (and `Reel.spring`) for anything computed: it returns the spring's position at `t` seconds. Use it, or `prog(…, 'spring-snappy')`, for every moving value.

`<canvas data-fit>` is sized to its CSS box; draw into it from a hook. No `Math.random()` without a seed (use `Reel.noise(x)`), no `Date.now()`, no `setTimeout`.

## Images

Put files in `reels/<slug>/assets/` and reference `assets/name.png`. Transparent PNGs/SVGs look best as cut-outs with `filter: drop-shadow(...)`. A host character (`assets/host.png`) placed in the global layer with `data-loop="talk"` gives the "creator explaining" look.
