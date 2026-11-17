// Child process for speech.mjs: reads one JSON line per clip, { raw: <16 kHz mono f32 file>, language }, and answers each with a JSON line
// { words } or { error }. See "Whisper in its own process" in speech.mjs for why this exists.
import fs from 'node:fs';
import readline from 'node:readline';
import { transcribeWords } from './speech.mjs';

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', raw => {
  chain = chain.then(async () => {
    try {
      const { raw: file, language } = JSON.parse(raw);
      const buf = fs.readFileSync(file);
      const words = await transcribeWords(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), { language });
      process.stdout.write(JSON.stringify({ words }) + '\n');
    } catch (e) { process.stdout.write(JSON.stringify({ error: String(e.message || e) }) + '\n'); }
  });
});
rl.on('close', () => chain.then(() => process.exit(0)));
