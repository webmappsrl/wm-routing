// GPX generato dal server dalla geometria calcolata dal motore: il modello
// non trascrive mai le coordinate. Specchia la logica client della preview
// (toGpx in preview/preview.js), con in piu' data dei dati e avvertenza.
import {WARNING} from '../route.js';

const esc = s => String(s).replace(/[<>&'"]/g,
  c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'}[c]));

export function toGpx({geometry, points, profile, stamp}) {
  const trkpts = (geometry?.coordinates ?? []).map(([lon, lat, ele]) =>
    `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele ?? 0}</ele></trkpt>`).join('\n');
  const wpts = (points ?? []).map(([lon, lat], i) =>
    `  <wpt lat="${lat}" lon="${lon}"><name>Punto ${i + 1}</name></wpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="wm-routing" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(`Percorso ${profile}`)}</name>
    <desc>${esc(`${WARNING} Dati OpenStreetMap del ${stamp}.`)}</desc>
  </metadata>
${wpts}
  <trk>
    <name>${esc(`Percorso ${profile}`)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
