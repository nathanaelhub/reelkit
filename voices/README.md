# Voices

Your own voices, for Chatterbox voice cloning. Nothing in this folder except this README is committed: a voice
recording is personal data.

**Easiest:** `npm start`, then **Record a voice…** in the studio. Tick "this is my own voice", read the paragraph on
screen (about 20 seconds), and save. The studio checks the take, cleans it, and saves it here as `<name>.wav`.

**From a terminal:**

```bash
npm run my-voice -- add recording.m4a --name me --mine   # any format FFmpeg reads
npm run my-voice -- sample me                            # hear it say a line (first time downloads ~1.5 GB)
npm run my-voice -- list
```

Then in a reel's script.json:

```json
"voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/me.wav", "exaggeration": 0.5 } }
```

- **Only clone your own voice.** Someone else (a co-host, a parent) should record their own, under their own name.
  The studio only keeps a take in which the speaker reads a paragraph that starts "This is my own voice". That's a
  nudge, not a lock: please don't use reelkit to imitate anyone.
- A good take: a quiet room, no music, one speaker, natural pace, a hand's width from the microphone.
- `exaggeration` (0.25 to 1) makes the delivery calmer or livelier; the studio calls it Delivery.
