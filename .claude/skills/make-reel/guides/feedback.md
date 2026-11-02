# Turning feedback into edits

Treat notes like a real editor would: find the smallest change that fixes the feeling, make it, check, re-render, say what you changed.

| They say | Usually means | Change |
|---|---|---|
| "feels off" / "boring" | dead air or a weak hit | find scenes where the check reports long stills; add a word-synced beat; stronger transition at that point |
| "hook is weak" | first 2s don't create a question | rewrite scene 1 `say` as a question or a claim that sounds wrong; bigger, faster visual hit on the key word |
| "too slow" / "drags" | too many words, long pauses | cut words in `say`, lower `pause`, raise `voice.speed` to 1.1 |
| "too fast" / "can't read it" | text appears and leaves too quickly | add `min` to the scene, fewer on-screen words, bigger type |
| "scene N is confusing" | visual doesn't match narration | redo that scene's hero visual so it shows exactly what's being said |
| "make X bigger / move X" | literal | edit the inline style in reel.html |
| "different voice" | provider/voice setting | change `voice` in script.json, re-voice (all scenes re-voice) |
| "captions in the way" | collision | `data-captions="top"` or move content up |
| "more like <reference>" | style | ask for one concrete thing they like in it if it's unclear; otherwise adjust theme, type scale, motion amount |

After any `script.json` change: `npm run voice -- <slug>` (only changed scenes are re-voiced), then check. After `reel.html`-only changes: just check. Always look at the contact sheets again before rendering.
