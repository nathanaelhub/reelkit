export default function ({ bed, sfx }) {
  bed({ mood: 'cinematic', key: 'D' });
  sfx.hit('@Moon');
  sfx.hit('@Buzz');
}
