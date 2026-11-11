# reelkit

This repo turns a one-line idea into a finished vertical reel (voice, score, animation, captions). When the user asks for a reel, short, TikTok or animated explainer, or gives feedback on one, follow the `make-reel` skill in `.claude/skills/make-reel/SKILL.md`.

- Reels live in `reels/<slug>/` (script.json, reel.html, timeline.json, voice.mp3, assets/). Finished videos go to `out/`.
- The engine is `engine/kit.js` + `engine/kit.css`; scripts are in `scripts/`. Change the engine only if the user asks for a new capability, and keep it deterministic (every frame a pure function of time).
- `reels/airplane-food/` (animated explainer), `reels/grand-canyon/` (photo story with depth moves, shader transitions and a score) and `reels/space-dangers/` (an interview cut into a talk and reframed around the speaker's face) are complete worked examples. Read one before your first reel.
- Never print or commit `.env`.
