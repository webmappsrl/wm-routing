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

// Risolve gli osmId nei POI del database: nome, tipo, quota e posizione si
// leggono solo dalla tabella `poi`, mai da cio' che manda il chiamante (la
// firma dei link non deve certificare dati trascritti dal modello). Un id
// valido non trovato non si salta: finisce in `mancanti`, cosi' a valle lo si
// puo' dire all'utente. Gli input che non sono interi sicuri non vengono mai
// rimandati indietro (sarebbe testo del modello che rientra nella chat): si
// contano in `nonValidi`. Gli id ripetuti si risolvono una volta sola, alla
// prima occorrenza. Tabella o file assenti: tutti mancanti con `errore: true`,
// nessuna eccezione.
export function makeResolvePoi({waysDbPath}) {
  return function resolvePoi(osmIds) {
    const input = Array.isArray(osmIds) ? osmIds : [];
    const ids = [];
    const visti = new Set();
    let nonValidi = 0;
    for (const id of input) {
      if (!Number.isSafeInteger(id)) { nonValidi++; continue; }
      if (visti.has(id)) continue;
      visti.add(id);
      ids.push(id);
    }
    // database che non si apre o tabella assente: guasto nostro, non POI spariti.
    // Gli id restano fra i mancanti; `errore` permette a chi legge di distinguere.
    const tuttiMancanti = () => ({trovati: [], mancanti: [...ids], nonValidi, errore: true});
    let db;
    try { db = new Database(waysDbPath, {readonly: true, fileMustExist: true}); }
    catch { return tuttiMancanti(); }
    try {
      let stmt;
      try { stmt = db.prepare('select osm_id, name, kind, ele, lon, lat, wikipedia, wikidata from poi where osm_id = ?'); }
      catch { return tuttiMancanti(); }
      const trovati = [], mancanti = [];
      for (const id of ids) {
        const r = stmt.get(id);
        if (r) // i tag wiki sono solo identificatori copiati da OSM: la pagina li usa per
        // chiedere la miniatura; se mancano, i campi non ci sono
        trovati.push({osmId: r.osm_id, name: r.name, kind: r.kind, ele: r.ele, lon: r.lon, lat: r.lat,
          ...(r.wikipedia ? {wikipedia: r.wikipedia} : {}),
          ...(r.wikidata ? {wikidata: r.wikidata} : {})});
        else mancanti.push(id);
      }
      return {trovati, mancanti, nonValidi};
    } finally { db.close(); }
  };
}
