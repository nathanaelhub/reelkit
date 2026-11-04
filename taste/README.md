# Tastes

A taste is a folder of 3 to 5 reference videos plus notes on what they have in common: the look a reel
should be inspired by. Everything in here except this README is gitignored, because reference videos
belong to their creators and brand notes are often private.

```bash
npm run ref -- my-brand https://www.instagram.com/reel/… https://youtu.be/… ~/Downloads/ad.mp4
```

That creates `taste/my-brand/`:

| file | what |
|---|---|
| `refs/<video>` | the reference (downloaded with yt-dlp, or copied) |
| `refs/<video>.metrics.json` | length, size, fps, cut times, shot length, motion, loudness, palette |
| `refs/<video>.sheet.jpg` | 12 evenly spaced frames to look at |
| `taste.json` | averages across the references, read by `npm run check` |
| `taste.md` | a measured block (rebuilt each run) and your notes (kept) |

Point a reel at it with `"taste": "my-brand"` in `script.json` (or an absolute path to a taste folder kept
elsewhere). `npm run check` then warns when the reel is much slower than the references and lists their
contact sheets next to the reel's, so the comparison happens before rendering.

Inspired by, never copied: don't reuse their footage, music, wording, logos or exact layouts.
