---
name: make-reel
description: Turn a one-line topic into a finished, voiced, captioned, animated vertical reel (1080x1920 MP4) with reelkit. Use when the user asks to make a reel, short, TikTok, explainer video, or animated video about something, or gives feedback on a reel ("make the hook punchier", "slow down scene 3").
---

# make-reel

You are the editor, animator and narrator. The user types one line ("make a reel about why airplane food tastes so bland"); you hand back an MP4 you have already checked yourself.

Everything runs from the repo root with npm scripts. All paths below are relative to the repo root.

## 0 · Setup (first time in a session)

Run `npm run doctor`. If anything shows ✗, run `npm run doctor -- --fix` and re-run doctor.
- If no voice provider is available, tell the user once: reels will be silent drafts until they add `ELEVENLABS_API_KEY` (best, exact word timing) or `OPENAI_API_KEY` to `.env`, or install Piper. On macOS the built-in `say` voice works for free. Then continue; a silent draft is still useful.
- Never print or commit the contents of `.env`.

## 1 · Plan the reel

Pick a short kebab-case slug, then `npm run new -- <slug> "<Title>"`. This creates `reels/<slug>/` with `script.json`, `reel.html`, `assets/`.

Read `.claude/skills/make-reel/guides/script.md` and write `reels/<slug>/script.json`:
- 6–10 scenes, 30–55 seconds total. One idea per scene, 8–20 spoken words per scene.
- Scene 1 is the hook and lands in under 2 seconds.
- Each scene has `id`, `say` (exact narration) and `visual` (what the viewer sees, with the word each visual beat lands on).
- If the topic is factual, get the facts right. Check anything you are not sure of (search if you can) and put the source in a kicker or note on screen. Prefer hedged numbers ("up to 30%") over invented precision.

## 2 · Voice it

`npm run voice -- <slug>`

This makes `voice.mp3` and `timeline.json` (scene start/end + every word's timestamp). Read the printed table: it is the timing you animate against. Clips are cached per scene, so later edits only re-voice changed scenes.

## 3 · Animate it

Read `.claude/skills/make-reel/guides/scenes.md` (the full kit reference) and `.claude/skills/make-reel/guides/style.md` (the look). Then write `reels/<slug>/reel.html`: one `<section class="scene" data-scene="<id>">` per script scene, same ids, same order.

Rules that matter most:
- **Sync motion to words.** Use `data-at="@word"` so things land when they are said. Every scene should have a beat on its key word, not just an entrance at 0.
- **Something moves at all times.** No stretch longer than ~2s with nothing changing. Use word-synced beats, `data-loop`, counters, drawing SVG lines.
- **Layout:** text inside x 72–1008. Headlines from y≈230. Main visual between y≈450 and 1180. Captions sit at y≈1240–1440; keep content out of that band, or set `data-captions="top"` / `"off"` on the scene. Nothing important below y 1700 (app UI covers it).
- Positions are absolute (`class="abs"` + inline `left/top`). Never use CSS animations or transitions; all motion comes from data attributes or `Reel.on()` hooks.
- Visuals: emoji, inline SVG, CSS shapes, the kit's cards/phone/window/stamp/chips, and images in `reels/<slug>/assets/`. Don't download images of real people or use logos/characters you don't own.

## 4 · Check your own work (always, before rendering)

`npm run check -- <slug>`

1. Fix every ✗ error. Fix ⚠ warnings unless you have a reason not to.
2. **Open every contact sheet PNG it lists with the Read tool and actually look.** Lint can't judge taste. Look for: overlapping or cramped elements, text that's hard to read, empty or boring scenes, visuals that don't match the narration, captions covering content, inconsistent style between scenes.
3. Edit, re-run check, look again. Repeat until clean. Usually 1–3 rounds.

## 5 · Render

`npm run render -- <slug>`. Output: `out/<slug>.mp4`. Use `--draft` for a fast half-res preview, `--from 10 --to 18` to render just a section.

After the render, extract 3–4 frames from the MP4 (`ffmpeg -ss <t> -i out/<slug>.mp4 -frames:v 1 f.jpg`) at transitions and word-synced hits and look at them, so you know the MP4 matches what the check showed.

Hand over: the MP4 path, its length, the voice used, and one line on anything you'd still improve. If the user is on their own machine, mention `npm run preview -- <slug>` to watch it with audio in the browser.

## 6 · Feedback loop

Read `.claude/skills/make-reel/guides/feedback.md`. The user will say things like "feels off", "hook is weak", "scene 4 drags", "make the stamp bigger". Map each note to the smallest change:
- Wording, pacing, a scene too long/short → edit `script.json`, then `npm run voice` (only changed scenes re-voice). Word timestamps move, but `@word` references follow automatically.
- Look, layout, motion, timing of a beat → edit `reel.html` only. No re-voice.
- Then check → look at the sheets → render. Say what you changed in one or two lines.
