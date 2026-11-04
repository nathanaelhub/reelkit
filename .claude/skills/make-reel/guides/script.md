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
  "format": "9:16",                // 9:16 (1080x1920, default) | 16:9 (1920x1080) | 1:1 (1080x1080)
  "loudness": -14,                 // final mix target in LUFS (render normalises the finished file)
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

Names the voice gets wrong: add `"pronounce": { "Saba": "Sayba", "sabanrealty.com": "Saban Realty dot com" }` to script.json. When a respelling isn't reliable, give a phoneme: `"Saba": { "cmu": "S EY1 B AH0" }` (or `"ipa"`). Phonemes need an ElevenLabs English model: set `voice.elevenlabs.model` to `eleven_turbo_v2` or `eleven_flash_v2`; other providers say the written word. The voice says the replacement; captions and `@word` targets keep the written word (use the written word in `@saba`). Check a doubtful name by listening, or by running speech-to-text on the clip.

Per-scene options: `pause` (silence after the line, default 0.2s, 0.8s on the last scene), `min` (minimum scene length, for a visual that needs time to land).

## Facts

If the reel makes factual claims, they have to be true. Verify what you're unsure of, phrase uncertain numbers as ranges or "up to", and show the source in a small kicker on screen (`// Fraunhofer IBP for Lufthansa, 2010`). A reel that's wrong gets dunked on in the comments.
