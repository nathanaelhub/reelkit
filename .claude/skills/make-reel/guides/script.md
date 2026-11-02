# Writing the script

A reel script is spoken language for a thumb that wants to keep scrolling. It is not an essay read aloud.

## Shape

| Beat | Scenes | Job |
|---|---|---|
| Hook | 1 | A question, a claim that sounds wrong, or a surprising number. Under 2 seconds. No "hey guys", no "in this video". |
| Turn | 1 | Flip the expectation ("It's not the chef. It's your tongue."). |
| Body | 3–6 | One reason / step / fact per scene, each one a little more surprising than the last. |
| Payoff | 1 | The thing they'll repeat to a friend. |
| Outro | 1 | Short CTA, 4–8 words. Optional loop back to the hook. |

## Sentences

- 8–20 words per scene. If a scene needs more, split it.
- Short words. Concrete nouns. Numbers spoken the way people say them ("about eight thousand feet", not "8,000 ft"); the screen can show the digits.
- Put the key word last in the sentence. That's where the voice lands and where your visual beat goes.
- Read it out loud in your head. If you'd run out of breath, cut.
- Words you'll sync to (`@bland`) must appear exactly in `say`. Avoid hyphenated words for sync targets; they're split differently by voices.

## script.json

```json
{
  "title": "Why airplane food tastes so bland",
  "theme": "paper",                // paper | ink | pop | cork
  "fps": 30,
  "voice": {
    "provider": "auto",            // auto | elevenlabs | openai | say | piper | none
    "speed": 1.05,
    "elevenlabs": { "voiceId": "JBFqnCBsd6RMkjVDRZzb", "model": "eleven_multilingual_v2" },
    "openai": { "voice": "ash", "instructions": "Energetic, warm narrator" },
    "say": { "voice": "Samantha" }
  },
  "captions": true,
  "music": "assets/bed.mp3",       // optional; or drop music.mp3 in the reel folder
  "musicVolume": 0.12,
  "scenes": [
    { "id": "hook", "say": "Why does airplane food taste so bland?", "visual": "tray drops in; BLAND stamp on 'bland'" },
    { "id": "numbers", "say": "...", "min": 4.2, "pause": 0.3 }
  ]
}
```

Per-scene options: `pause` (silence after the line, default 0.2s, 0.8s on the last scene), `min` (minimum scene length, for a visual that needs time to land).

## Facts

If the reel makes factual claims, they have to be true. Verify what you're unsure of, phrase uncertain numbers as ranges or "up to", and show the source in a small kicker on screen (`// Fraunhofer IBP for Lufthansa, 2010`). A reel that's wrong gets dunked on in the comments.
