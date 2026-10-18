// GPX generato dal server dalla geometria calcolata dal motore: il modello
// non trascrive mai le coordinate. Specchia la logica client della preview
// (toGpx in preview/preview.js), con in piu' data dei dati e avvertenza.
import {WARNING} from '../route.js';

const esc = s => String(s).replace(/[<>&'"]/g,
  c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'}[c]));

// il testo dei POI viene dal database e dal modello: i caratteri di controllo
// non sono ammessi in XML 1.0 nemmeno come entita', quindi si tolgono
const clean = s => esc(String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ''));

// poi: [{name, lon, lat, ele, nota}], opzionale. Solo la nota di una riga
// entra in <desc>: i navigatori mostrano male i testi lunghi.
const poiWpt = ({name, lon, lat, ele, nota}) =>
  `  <wpt lat="${lat}" lon="${lon}">` +
  (Number.isFinite(ele) ? `<ele>${ele}</ele>` : '') +
  `<name>${clean(name)}</name>` +
  (nota ? `<desc>${clean(nota)}</desc>` : '') + '</wpt>';

// il testo dei POI e' l'unico scritto dall'assistente: lo si dichiara una volta
// nel metadata (non su ogni <desc>, lo schermo di un GPS e' piccolo)
const NOTE_ASSISTENTE = 'Le note dei punti sono scritte dall’assistente, non da Webmapp.';
const POI_NON_DISPONIBILI = 'I punti di interesse non erano disponibili al momento della generazione di questo file.';

export function toGpx({geometry, points, profile, stamp, poi, poiNonDisponibili}) {
  const trkpts = (geometry?.coordinates ?? []).map(([lon, lat, ele]) =>
    `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele ?? 0}</ele></trkpt>`).join('\n');
  const wpts = (points ?? []).map(([lon, lat], i) =>
    `  <wpt lat="${lat}" lon="${lon}"><name>Punto ${i + 1}</name></wpt>`).join('\n');
  const named = (poi ?? []).map(poiWpt).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="wm-routing" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(`Percorso ${profile}`)}</name>
    <desc>${esc([`${WARNING} Dati OpenStreetMap del ${stamp}.`,
      (poi ?? []).some(p => p.nota) ? NOTE_ASSISTENTE : '',
      poiNonDisponibili ? POI_NON_DISPONIBILI : ''].filter(Boolean).join(' '))}</desc>
  </metadata>
${wpts}${named ? `\n${named}` : ''}
  <trk>
    <name>${esc(`Percorso ${profile}`)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
