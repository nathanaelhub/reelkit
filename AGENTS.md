# reelkit: instructions for coding agents

This repo turns a one-line idea into a finished video. When the user asks for a reel, short, TikTok, explainer or animated video, or gives notes on one, follow the workflow in `.claude/skills/make-reel/SKILL.md` exactly, and read its guides when it says to:

- `.claude/skills/make-reel/guides/script.md`: how to write the script
- `.claude/skills/make-reel/guides/scenes.md`: the full kit reference (animations, timing, depth photos, transitions)
- `.claude/skills/make-reel/guides/style.md`: the default look
- `.claude/skills/make-reel/guides/feedback.md`: how to handle notes

Ground rules:
- Run everything from the repo root with the npm scripts (`npm run doctor`, `new`, `voice`, `score`, `check`, `render`).
- Always run `npm run check -- <reel>` and **open the contact sheet images it lists** before rendering. If you can't view images, say so to the user, since the check alone can't judge taste.
- Reels live in `reels/<slug>/`; finished videos go to `out/`.
- Keep the engine deterministic: every frame is a pure function of time. No CSS animations or transitions.
- Never print or commit `.env`.
