# Style: what makes these reels look good

The default look is "editorial explainer": warm off-white paper, black type, one red accent, a red serif-italic word in every headline, tall condensed caps for punches, cut-out objects with soft shadows.

## Every scene has three layers

1. **Kicker + headline** at the top (y 170 / 230). The kicker is a tiny mono label: `// 03 · cabin pressure`. The headline restates the scene's idea in ≤ 6 words with one `<em>` accent word.
2. **One hero visual** in the middle (y 450–1180). One object, chart, mockup or number. Not three things fighting.
3. **Captions** (automatic, y ≈ 1240), big condensed caps, active word in red.

## Rules of thumb

- One accent colour. Red means "this is the point": the stamp, the key bar, the accent word.
- Big. Hero numbers 200–300px. Emoji as objects 150–260px. Anything under 30px is decoration.
- Contrast between scenes: alternate background (paper / grid / halftone / accent), alternate composition (centered object / left-right pair / chart / phone mockup).
- Motion is spring physics, never CSS transitions or plain easing curves (enforced by `npm run check`). Snappy for UI elements, bouncy for playful hits, critically damped for big moves.
- No all-caps centred text on a colour gradient: it's the most generic look there is (also enforced).
- Motion with purpose: entrance on the scene start, a **hit** on the key word (stamp, pop, counter, strike), and something gently alive the rest of the time (float, sway, a drawing line).
- Every 3–4 scenes use a stronger transition (flash, iris, zoom) to reset attention. Cuts otherwise.
- The outro is a full accent-colour slide with one big word.
- Don't put text on top of text. Stamps on top of objects are fine.
- Keep it honest: on-screen numbers match what the narrator says.

## Common scene recipes

- **Big number:** `.huge.accent` with `data-anim="count"` on the word that says it + a small card below that explains the unit.
- **Before / after:** two `.card`s side by side, left one gets an SVG X drawn on its key word, right one pops with `.circle-mark`.
- **Comparison bars:** `.bar-track > .bar-fill` rows, widths driven in a `Reel.on` hook from the word that names the change.
- **Process / steps:** `.window` mockup with `.line.ok` rows appearing via `data-stagger`, or `.step-badge` + headline.
- **Product / app:** `.phone > .screen` flying up, with a sticker or stamp landing on it.
- **Myth busting:** `.sticky` or `.polaroid` pinned on `bg-cork`, then a `.stamp` "MYTH" on the word.
