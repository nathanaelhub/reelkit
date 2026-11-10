export default function ({ bed, sfx }) {
  bed({ mood: 'upbeat', key: 'D' });
  sfx.hit('@hit');
  sfx.scenes('whoosh');
  sfx.ding('two@scene');
}
