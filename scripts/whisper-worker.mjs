// Child process for speech.mjs: reads paths of 16 kHz mono f32 files, one per line, and answers each with a JSON line
// { words } or { error }. See "Whisper in its own process" in speech.mjs for why this exists.
import fs from 'node:fs';
import readline from 'node:readline';
import { transcribeWords } from './speech.mjs';

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', raw => {
  chain = chain.then(async () => {
    try {
      const buf = fs.readFileSync(raw.trim());
      const words = await transcribeWords(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
      process.stdout.write(JSON.stringify({ words }) + '\n');
    } catch (e) { process.stdout.write(JSON.stringify({ error: String(e.message || e) }) + '\n'); }
  });
});
rl.on('close', () => chain.then(() => process.exit(0)));
