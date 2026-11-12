# Blueprint

A technical drawing: white line work on cyanotype blue over a drafting grid, with monospaced, upper-case annotations. It says "this is how it works".

- **Line, not fill.** Draw objects as outlines (`line`, `fill-b` washes). Yellow (`fill-a`, `.accent`, `line alt`) marks the one thing that matters in each scene. Nothing else gets colour.
- **Annotate.** Every drawing gets labels (`<text class="label">`), leader lines and, where there's a size or a number, a dimension line with arrowheads. Labels are short nouns: `SUNLIGHT`, `450 NM`.
- **Draw it on.** `data-anim="draw"` on the line work, in the order an engineer would draw it: construction first, then the object, then labels.
- **Type:** everything in Space Mono, upper case for headlines and labels. Headlines short; no italics, no serif accents.
- **Motion:** draw, wipe, type, fade. Slow and exact; nothing bounces. Transitions `cut` or `wipe`.
- **Music:** `bed({ mood: 'cinematic' })` or `'tense'`, soft.
