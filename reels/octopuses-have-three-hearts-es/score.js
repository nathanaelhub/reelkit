// Soft cinematic bed (blueprint pack), a low thump as each heart idea lands, a riser into the stop.
export default function ({ bed, sfx }) {
  bed({ mood: 'cinematic', key: 'D', volume: -9 });
  sfx.hit('hook@tres', { volume: -4 });
  sfx.pop('blood@azul');
  sfx.pop('less@menos');
  sfx.hit('gills@dos', { volume: -6 });
  sfx.hit('body@tercer', { volume: -4 });
  sfx.riser('swim@detiene', { dur: 1.6, volume: -6 });
  sfx.hit('swim@detiene');
  sfx.pop('crawl@arrastrarse');
  sfx.ding('outro@siguenos', { volume: -4 });
}
