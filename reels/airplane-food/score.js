// Music and sound effects for the example reel, written with engine/score-kit.js.
// Every time below is a word the narrator says, so the hits stay on the words when the voice changes.
export default function ({ bed, sfx }) {
  bed({ mood: 'upbeat', key: 'E', volume: -9 });
  sfx.hit('@bland');                    // the BLAND stamp
  sfx.hit('@dulls');
  sfx.riser('numbers', { dur: 1.2 });   // build into the numbers scene
  sfx.pop('@salty'); sfx.pop('@umami');
  sfx.hit('@roar');
  sfx.scenes('whoosh', { volume: -4 });
  sfx.ding('outro+0.2');
}
