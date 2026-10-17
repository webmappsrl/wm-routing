// Il tool poi_nearby: legge la tabella laterale `poi` di ways.sqlite
// (estratta dal pre-passo) e restituisce nome, tipo, quota, osmid e i tag
// wikipedia/wikidata come soli identificatori. Un grafo vecchio senza la
// tabella non e' un errore: si dichiara, e basta rigenerare il grafo.
import Database from 'better-sqlite3';

const MAX_RESULTS = 20;
const SENZA_TABELLA = {poi: [], vuoto: 'dati senza POI: grafo da rigenerare'};

export function makePoiNearbyTool({waysDbPath}) {
  return function poiNearby({point, radiusM = 500}) {
    if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite))
      return {stato: 'coordinate_non_valide'};
    const radius = Math.min(Math.max(Number(radiusM) || 500, 1), 2000);
    let db;
    try { db = new Database(waysDbPath, {readonly: true, fileMustExist: true}); }
    catch { return SENZA_TABELLA; }
    try {
      const [lon, lat] = point;
      const kLat = 111320, kLon = 111320 * Math.cos(lat * Math.PI / 180);
      let rows;
      try {
        rows = db.prepare('select * from poi where lon between ? and ? and lat between ? and ?')
          .all(lon - radius / kLon, lon + radius / kLon, lat - radius / kLat, lat + radius / kLat);
      } catch { return SENZA_TABELLA; }
      const poi = rows
        .map(r => ({...r, distanzaM: Math.round(Math.hypot((r.lon - lon) * kLon, (r.lat - lat) * kLat))}))
        .filter(r => r.distanzaM <= radius)
        .sort((a, b) => a.distanzaM - b.distanzaM)
        .slice(0, MAX_RESULTS)
        .map(r => ({
          name: r.name, kind: r.kind, ele: r.ele, lonLat: [r.lon, r.lat],
          osmId: r.osm_id, distanzaM: r.distanzaM,
          ...(r.wikipedia ? {wikipedia: r.wikipedia} : {}),
          ...(r.wikidata ? {wikidata: r.wikidata} : {}),
        }));
      return poi.length ? {poi} : {poi: [], vuoto: `nessun POI entro ${radius} m`};
    } finally { db.close(); }
  };
}
