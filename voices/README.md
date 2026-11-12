# Voices

Reference recordings for Chatterbox voice cloning. Put a 10 to 30 second recording of one person speaking clearly here
(any format FFmpeg reads: wav, m4a, mp3), then point a reel at it:

```json
"voice": { "provider": "chatterbox", "chatterbox": { "reference": "voices/me.m4a", "exaggeration": 0.5 } }
```

- **Only clone your own voice, or a voice whose owner has agreed.** Don't use it to impersonate anyone.
- Recordings here are not committed (see .gitignore): a voice sample is personal data.
- Quiet room, no music, one speaker, natural pace. A phone voice memo works.
- `exaggeration` (0.25 to 1) makes delivery flatter or more animated.
