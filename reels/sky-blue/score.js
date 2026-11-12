// One score for every style: a soft bed and a tick as each idea lands.
export default function ({ bed, sfx }) {
  bed({ mood: 'lofi', key: 'D' });
  sfx.pop('@red');
  sfx.pop('@five');
  sfx.whoosh('@crosses');
}
