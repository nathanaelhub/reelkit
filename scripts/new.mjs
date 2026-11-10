#!/usr/bin/env node
// Scaffold a new reel folder.
//   npm run new -- <slug> ["Optional title"]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, REELS, ROOT, die, writeJSON } from './lib.mjs';

const args = parseArgs();
const slug = (args._[0] || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
if (!slug) die('Usage: npm run new -- <slug> ["Title"]');
const dir = path.join(REELS, slug);
if (fs.existsSync(dir)) die(`reels/${slug} already exists`);
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
const title = args._[1] || slug.replace(/-/g, ' ');

writeJSON(path.join(dir, 'script.json'), {
  title,
  theme: 'paper',
  fps: 30,
  voice: { provider: 'auto', speed: 1.05, elevenlabs: { voiceId: 'JBFqnCBsd6RMkjVDRZzb' }, openai: { voice: 'ash' } },
  captions: true,
  scenes: [
    { id: 'hook', say: 'Replace this with a hook that makes people stop scrolling.', visual: 'What the viewer sees' },
    { id: 'point', say: 'One idea per scene. Short sentences.', visual: '' },
    { id: 'outro', say: 'Follow for more.', visual: '' },
  ],
});

fs.writeFileSync(path.join(dir, 'reel.html'), `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="../../engine/kit.css">
<style>
  /* reel-specific styles */
</style>
</head>
<body>
<div id="stage">

  <section class="scene bg-paper" data-scene="hook">
    <div class="pad kicker" style="top:170px" data-anim="fade">// 01 · the hook</div>
    <h1 class="pad headline" style="top:230px" data-anim="rise" data-at="0.1">Replace this <em>hook</em></h1>
  </section>

  <section class="scene bg-paper" data-scene="point">
    <h1 class="pad headline" style="top:230px" data-anim="rise">One <em>idea</em></h1>
  </section>

  <section class="scene bg-paper" data-scene="outro" data-transition="zoom">
    <h1 class="pad display center-text" style="top:520px" data-anim="stamp" data-at="@follow">Follow</h1>
  </section>

</div>
<script src="../../engine/kit.js"></script>
<script>
  Reel.init();
</script>
</body>
</html>
`);
fs.writeFileSync(path.join(dir, 'score.js'), `// Music and sound effects, written in code (see engine/score-kit.js). Times can be words: '@word'.
export default function ({ bed, sfx }) {
  bed({ mood: 'warm' });          // warm · upbeat · tense · lofi · cinematic; also bpm, key, volume
  sfx.scenes('whoosh');           // a whoosh into every scene after the first
  // sfx.hit('@word');            // a thump when a word is said (stamps, numbers)
}
`);
console.log(`✓ created reels/${slug}/ (script.json, reel.html, score.js, assets/)`);
