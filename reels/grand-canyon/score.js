// Cinematic bed with hits on the big numbers. Times are spoken words, so they follow the voice.
export default function ({ bed, sfx }) {
  bed({ mood: 'cinematic', key: 'D', volume: -7 });
  sfx.hit('@deep');
  sfx.pop('@young', { pitch: 'D5' });
  sfx.whoosh('river', { dur: 0.4 });
  sfx.riser('sea', { dur: 1.4 });
  sfx.hit('@340');
  sfx.hit('@1.8');
  sfx.whoosh('clouds', { dur: 0.8, volume: -3 });
  sfx.ding('outro+0.3', { note: 'A5' });
}
