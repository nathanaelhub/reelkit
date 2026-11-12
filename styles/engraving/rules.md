# Copperplate engraving

A plate from a 19th-century encyclopedia: black ink hatching on cream paper inside a ruled border, old-style serif type, a deep red for the one thing that matters.

- **Tone is hatching.** Dark = `fill-a` (cross-hatch), mid = `fill-b`, light = `fill-c`. No flat fills, no gradients, no colour except the red (`.accent`, `line alt`).
- **Label like a plate.** Small italic labels (`<text class="label">`), "Fig. 1", letters keyed to a legend. Headlines are full sentences in sentence case, set in IM Fell English.
- **Draw it on.** `data-anim="draw"` for outlines, then the hatched shapes `fade` in under them, as if inked.
- **Captions** are quiet: serif, sentence case, the spoken word in red italic.
- **Motion:** draw, fade, mark (underline). Slow. No pops, no bounces, no stamps except the round seal for one key fact. Transitions `fade`, or `gl:InkBleed`.
- **Music:** `bed({ mood: 'warm' })`, or `'cinematic'` for a serious topic.
