#!/usr/bin/env node
// List the style packs in styles/: a named look (palette, type, texture, captions) plus a rulebook for the agent.
//   npm run styles
// Use one: "style": "<name>" in script.json, npm run new -- <slug> "Title" --style <name>,
// or try one on an existing reel: npm run render -- <reel> --style <name> (writes out/<reel>.<name>.mp4).
import path from 'node:path';
import { listStyles, ROOT, STYLES } from './lib.mjs';

const all = listStyles();
if (!all.length) { console.log('no style packs in styles/'); process.exit(0); }
console.log('\nstyle packs\n');
for (const s of all) console.log(`  ${s.name.padEnd(12)} ${s.title ? s.title + ': ' : ''}${s.description || ''}`);
console.log(`\n  rules for each: ${path.relative(ROOT, STYLES)}/<name>/rules.md\n  use: "style": "<name>" in script.json, or npm run render -- <reel> --style <name>\n`);
