---
name: make-reel
description: Turn a one-line topic into a finished, voiced, captioned, animated vertical reel (1080x1920 MP4) with reelkit. Use when the user asks to make a reel, short, TikTok, explainer video, or animated video about something, or gives feedback on a reel ("make the hook punchier", "slow down scene 3").
---

# make-reel

You are the editor, animator and narrator. The user types one line ("make a reel about why airplane food tastes so bland"); you hand back an MP4 you have already checked yourself.

Everything runs from the repo root with npm scripts. All paths below are relative to the repo root.

## 0 · Setup (first time in a session)

Run `npm run doctor`. If anything shows ✗, run `npm run doctor -- --fix` and re-run doctor.
- The free default voice is Kokoro (local, open weights, fine for published reels); `doctor -- --fix` downloads it. `ELEVENLABS_API_KEY` in `.env` is an optional upgrade for the most expressive voice. If doctor reports no voice at all, reels are silent drafts; say so once and continue.
- If the only voice is macOS `say` or a Piper voice, tell the user once that Apple licenses `say` for personal, non-commercial use and many Piper voices are non-commercial, so those reels shouldn't be published or sold.
- Never print or commit the contents of `.env`.

## 1 · Taste first (when there is one)

A reel without a reference comes out generic. If the user gives reference links or files, names a brand, or says "like this one":
1. `npm run ref -- <taste> <links or files>` (a name, or an absolute path for a private brand folder). It downloads, measures and writes contact sheets.
2. Open every `refs/*.sheet.jpg` with the Read tool and look. Then fill in the Notes section of `taste/<taste>/taste.md`: pacing, captions and type, colour, motion, sound, do, don't. Be specific ("white condensed caps, two words at a time, bottom third"), not generic ("modern, clean").
3. Set `"taste": "<taste>"` in `script.json`.

If a taste already exists for this brand, read its `taste.md` and look at its sheets before writing anything. If the user wants a polished look and there is no taste, ask once for 3 to 5 reels they like before building.

Inspired by, never copied: never reuse a reference's footage, music, wording, logos or exact layouts.

## 2 · Plan the reel

Pick a short kebab-case slug, then `npm run new -- <slug> "<Title>"`. This creates `reels/<slug>/` with `script.json`, `reel.html`, `assets/`.

Read `.claude/skills/make-reel/guides/script.md` and write `reels/<slug>/script.json`:
- 6–10 scenes, 30–55 seconds total. One idea per scene, 8–20 spoken words per scene.
- Scene 1 is the hook and lands in under 2 seconds.
- Each scene has `id`, `say` (exact narration) and `visual` (what the viewer sees, with the word each visual beat lands on).
- If the topic is factual, get the facts right. Check anything you are not sure of (search if you can) and put the source in a kicker or note on screen. Prefer hedged numbers ("up to 30%") over invented precision.

## 3 · Voice it

`npm run voice -- <slug>`

This makes `voice.mp3` and `timeline.json` (scene start/end + every word's timestamp). Read the printed table: it is the timing you animate against. Clips are cached per scene, so later edits only re-voice changed scenes.

- Each scene line says how it was timed: `voice` (ElevenLabs), `aligned` (Whisper heard the clip; exact) or `estimated` (spread by word length; `@word` beats may be off by a few tenths). If a scene says estimated, say so when handing over.
- Kokoro (`"voice": { "provider": "kokoro", "kokoro": { "voice": "am_michael" } }`) says numbers, money, years and compound words itself, but stops with "Kokoro doesn't know how to say: …" for words outside its dictionary (names, brands). Add each one to `"pronounce"` as a respelling from ordinary words (`"Zylqorb": "zil corb"`) or a phoneme (`{ "cmu": "Z IH1 L K AO0 R B" }` / `{ "ipa": "…" }`), then re-run. English voices: `af_heart af_bella af_nicole af_sarah af_nova am_michael am_adam am_eric am_liam am_onyx am_puck bf_emma bf_isabella bm_george bm_daniel bm_lewis` (a = American, b = British, f/m).

## 3b · Score it

`reels/<slug>/score.js` is the music and sound design, written in code (`npm run new` scaffolds one; `engine/score-kit.js` documents the kit). Render runs it automatically.
- `bed({ mood, key, bpm, volume })`: a full backing track. Pick the mood from the topic: `upbeat` for tips and lists, `warm` for stories, `tense` for myths and warnings, `lofi` for calm explainers, `cinematic` for big reveals. Default level sits under the voice; the render also ducks it whenever someone talks.
- Sound effects land on words, the same way animations do: `sfx.hit('@bland')` under a stamp, `sfx.pop('@word')` for things popping on, `sfx.riser('scene-id')` into a reveal, `sfx.tick({ from: '@start', to: '@stop' })` under typing, `sfx.ding('outro')`, `sfx.scenes('whoosh')` on scene changes. Put a sound under every big visual hit and nowhere else.
- `npm run score -- <slug>` renders it alone and prints the peak; fix any clipping warning by lowering a `volume`. `"duck": false` in script.json turns ducking off; `"scoreVolume"` scales the whole score. If the user brings their own track, drop it in as `music.mp3` (and delete score.js if it should be the only music).

## 4 · Animate it

Read `.claude/skills/make-reel/guides/scenes.md` (the full kit reference) and `.claude/skills/make-reel/guides/style.md` (the look). Then write `reels/<slug>/reel.html`: one `<section class="scene" data-scene="<id>">` per script scene, same ids, same order.

Rules that matter most:
- **Sync motion to words.** Use `data-at="@word"` so things land when they are said. Every scene should have a beat on its key word, not just an entrance at 0.
- **Something moves at all times.** No stretch longer than ~2s with nothing changing. Use word-synced beats, `data-loop`, counters, drawing SVG lines.
- **Layout:** text inside x 72–1008. Headlines from y≈230. Main visual between y≈450 and 1180. Captions sit at y≈1240–1440; keep content out of that band, or set `data-captions="top"` / `"off"` on the scene. Nothing important below y 1700 (app UI covers it).
- Positions are absolute (`class="abs"` + inline `left/top`). Never use CSS animations or transitions; all motion comes from data attributes or `Reel.on()` hooks, and all of it runs on springs (`spring`, `spring-snappy`, `spring-bouncy`, `spring:k,c,m`). The check fails otherwise.
- No all-caps centred text on a colour gradient (the check fails on it).
- Visuals: emoji, inline SVG, CSS shapes, the kit's cards/phone/window/stamp/chips, and images in `reels/<slug>/assets/`. Photos should move in depth, not slide: use a depth photo (`<canvas data-depth="assets/x.jpg" data-move="push">`, see the end of scenes.md). Don't download images of real people or use logos/characters you don't own.

## 5 · Check your own work (always, before rendering)

`npm run check -- <slug>`

1. Fix every ✗ error. Fix ⚠ warnings unless you have a reason not to.
2. **Open every contact sheet PNG it lists with the Read tool and actually look.** Lint can't judge taste. Look for: overlapping or cramped elements, text that's hard to read, empty or boring scenes, visuals that don't match the narration, captions covering content, inconsistent style between scenes.
3. If the reel has a taste, the check prints its reference sheets. Look at them beside the reel's sheets and name the three biggest differences (pacing, type, colour, motion). Fix the ones that matter, or say why not.
4. Edit, re-run check, look again. Repeat until clean. Usually 1–3 rounds.

## 6 · Render

`npm run render -- <slug>`. Output: `out/<slug>.mp4`. Use `--draft` for a fast half-res preview, `--from 10 --to 18` to render just a section.

After the render, extract 3–4 frames from the MP4 (`ffmpeg -ss <t> -i out/<slug>.mp4 -frames:v 1 f.jpg`) at transitions and word-synced hits and look at them, so you know the MP4 matches what the check showed.

Hand over: the MP4 path, its length, the voice used, and one line on anything you'd still improve. If the user is on their own machine, mention `npm run preview -- <slug>` to watch it with audio in the browser.

## 7 · Feedback loop

Read `.claude/skills/make-reel/guides/feedback.md`. The user will say things like "feels off", "hook is weak", "scene 4 drags", "make the stamp bigger". Map each note to the smallest change:
- Wording, pacing, a scene too long/short → edit `script.json`, then `npm run voice` (only changed scenes re-voice). Word timestamps move, but `@word` references follow automatically.
- Look, layout, motion, timing of a beat → edit `reel.html` only. No re-voice.
- Then check → look at the sheets → render. Say what you changed in one or two lines.
