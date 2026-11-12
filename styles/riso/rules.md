# Risograph

Two spot inks, fluorescent pink and medium blue, overprinted on off-white paper. Cheap, loud, handmade: zines, gig posters, small-press books.

- **Two inks, three at most.** Everything is pink (`fill-a`, `.accent`), blue (`fill-b`, text, `.line`) or the yellow halftone (`fill-c`). Where pink and blue overlap they make purple by themselves (multiply); don't add a purple.
- **Flat shapes, no gradients, no shadows, no photos in full colour.** If you use a photo, make it one ink: `filter: grayscale(1) contrast(1.4)` with `mix-blend-mode: multiply` on a pink or blue block.
- **Big, heavy type.** Headlines are short (two to six words) and huge. The misregistration (the pink shadow offset) is the look: keep it, never "fix" it.
- **Shapes over icons.** Circles, bands, arrows and blobs cut from paper. Draw with `<svg>` using `fill-a`, `fill-b`, `fill-c`, `line`, `label`.
- **Motion:** pop, rise, wipe, stamp: things land like stickers. No smooth 3D moves. Of the gl: transitions, use flat ones (`gl:DirectionalWipe`, or `gl:InkBleed`, which reads as ink).
- **Music:** `bed({ mood: 'lofi' })` or `'upbeat'`.
