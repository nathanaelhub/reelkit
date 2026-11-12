// Soft cinematic bed (blueprint pack), a low thump as each heart idea lands, a riser into the stop.
export default function ({ bed, sfx }) {
  bed({ mood: 'cinematic', key: 'D', volume: -9 });
  sfx.hit('hook@three', { volume: -4 });
  sfx.pop('blood@blue');
  sfx.pop('less@less');
  sfx.hit('gills@two', { volume: -6 });
  sfx.hit('body@third', { volume: -4 });
  sfx.riser('swim@stops', { dur: 1.6, volume: -6 });
  sfx.hit('swim@stops');
  sfx.pop('crawl@crawl');
  sfx.ding('outro@follow', { volume: -4 });
}
