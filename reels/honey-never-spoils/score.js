// Music and sound effects, written in code (see engine/score-kit.js). Times can be words: '@word'.
export default function ({ bed, sfx }) {
  bed({ mood: 'warm' });
  sfx.scenes('whoosh');
  sfx.pop('@edible');
  sfx.hit('@nothing');
  sfx.ding('payoff');
}
