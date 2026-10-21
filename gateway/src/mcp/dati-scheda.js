// Il payload della scheda stampabile del giro: puro e sincrono. Lo usano la
// rotta /g/scheda.json e, piu' avanti, il tool MCP che compone il documento.
// Non calcola nulla: `route` e' gia' il risultato di compute.
import {compactRoute} from './compact.js';
import {WARNING} from '../route.js';

// nomi e quote dei POI vengono dal database, la nota dal blob firmato.
// Un guasto del database non e' un POI inesistente: si distingue.
export function resolveSchedaPoi(resolvePoi, list) {
  const vuoto = {poi: [], poiMancanti: 0, poiNonDisponibili: false};
  if (!resolvePoi || !list?.length) return vuoto;
  try {
    const r = resolvePoi(list.map(x => x.osmId));
    if (r.errore) return {...vuoto, poiNonDisponibili: true};
    const note = new Map(list.map(x => [x.osmId, x.nota]));
    return {
      poi: r.trovati.map(t => ({osmId: t.osmId, name: t.name, kind: t.kind, ele: t.ele, lonLat: [t.lon, t.lat], nota: note.get(t.osmId),
        ...(t.wikipedia ? {wikipedia: t.wikipedia} : {}), ...(t.wikidata ? {wikidata: t.wikidata} : {})})),
      poiMancanti: (r.mancanti?.length ?? 0) + (r.nonValidi ?? 0),
      poiNonDisponibili: false,
    };
  } catch { return {...vuoto, poiNonDisponibili: true}; }
}

// Il link al GPX lo compone il server dal blob ricevuto, non il client: e'
// l'indirizzo che finisce sul foglio stampato e nel codice QR.
export function linkGpxDi(publicUrl, t) {
  if (!publicUrl || !t) return null;
  return `${String(publicUrl).replace(/\/+$/, '')}/g/gpx?t=${encodeURIComponent(String(t))}`;
}

export function datiScheda({route, blob, resolvePoi, dataStamp, linkGpx = null}) {
  const c = compactRoute(route);
  let stampCorrente = null;
  try { stampCorrente = dataStamp?.().osm ?? null; } catch { /* nessun banner */ }
  return {
    profilo: c.profilo, distanzaKm: c.distanzaKm, salitaM: c.salitaM, discesaM: c.discesaM,
    oreDIN33466: c.oreDIN33466, quotaMinMaxM: c.quotaMinMaxM, tappe: c.tappe, sentieri: c.sentieri,
    geometry: route.geometry, stamp: blob.stamp, stampCorrente,
    avvertenza: WARNING, linkGpx,
    ...resolveSchedaPoi(resolvePoi, blob.poi),
  };
}
