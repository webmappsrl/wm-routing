// Ricerca dentro un bbox: e' il modo in cui si chiede «quali paesi e quali zone
// stanno qui», cosa che il raggio attorno a un punto (searchPoiNearby) non sa dire.
// Come quella, lavora su una connessione better-sqlite3 gia' aperta in sola
// lettura: non la apre e non la chiude, e' chi chiama a gestirla. Nessun log.
const DEFAULT_LIMIT = 100;
const NO_POI_TABLE = {places: [], vuoto: 'dati senza POI: grafo da rigenerare'};
const NO_AREA_TABLE = {areas: [], vuoto: 'dati senza aree: grafo da rigenerare'};
const INVALID_BBOX = {stato: 'bbox_non_valido'};

const isValidBbox = b =>
  Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1];

// "w,s,e,n" -> {bbox: [w, s, e, n]}. Una voce vuota non e' lo zero: si rifiuta.
export function parseBbox(text) {
  if (typeof text !== 'string') return INVALID_BBOX;
  const parts = text.split(',').map(s => s.trim());
  if (parts.length !== 4 || parts.some(s => s === '')) return INVALID_BBOX;
  const bbox = parts.map(Number);
  return isValidBbox(bbox) ? {bbox} : INVALID_BBOX;
}

// I luoghi dentro il bbox, filtrabili per tipo. Il taglio per `limit` non e'
// silenzioso: si chiede una riga in piu' per sapere se c'era altro, e si dichiara.
export function searchPlacesInBbox(db, {bbox, kinds, limit = DEFAULT_LIMIT} = {}) {
  if (!isValidBbox(bbox)) return INVALID_BBOX;
  const [w, s, e, n] = bbox;
  const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const kindList = Array.isArray(kinds) && kinds.length ? kinds : null;
  const sql = 'select osm_id, name, kind, ele, lon, lat from poi where lon between ? and ? and lat between ? and ?' +
    (kindList ? ` and kind in (${kindList.map(() => '?').join(',')})` : '') +
    ' order by name, osm_id limit ?';
  let rows;
  try { rows = db.prepare(sql).all(w, e, s, n, ...(kindList ?? []), max + 1); }
  catch { return NO_POI_TABLE; }
  if (!rows.length) return {places: [], vuoto: 'nessun luogo nel bbox'};
  const places = rows.slice(0, max).map(r => ({
    name: r.name, kind: r.kind, lonLat: [r.lon, r.lat], ele: r.ele, osmId: r.osm_id,
  }));
  return rows.length > max ? {places, troncato: true} : {places};
}

// Le aree di un tipo ('region' o 'zone'). Con il bbox, quelle che lo intersecano
// (due rettangoli si intersecano quando non sono separati su nessun asse; il
// bordo in comune conta); senza, tutto quello che il dato contiene per quel tipo.
// Il taglio per `limit` si dichiara come per i luoghi: le aree oggi sono poche
// centinaia, ma una risposta senza tetto cresce con il dato e non con il codice.
export function searchAreasInBbox(db, {kind, bbox, limit = DEFAULT_LIMIT} = {}) {
  const filterByBbox = bbox !== undefined && bbox !== null;
  if (filterByBbox && !isValidBbox(bbox)) return INVALID_BBOX;
  const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  let sql = 'select osm_type, osm_id, name, kind, min_lon, min_lat, max_lon, max_lat from area where kind = ?';
  const args = [kind];
  if (filterByBbox) {
    const [w, s, e, n] = bbox;
    sql += ' and min_lon <= ? and max_lon >= ? and min_lat <= ? and max_lat >= ?';
    args.push(e, w, n, s);
  }
  sql += ' order by name, osm_id limit ?';
  args.push(max + 1);
  let rows;
  try { rows = db.prepare(sql).all(...args); }
  catch { return NO_AREA_TABLE; }
  if (!rows.length) return {areas: [], vuoto: filterByBbox ? 'nessuna area nel bbox' : 'nessuna area di questo tipo'};
  const areas = rows.slice(0, max).map(r => ({
    name: r.name, kind: r.kind, bbox: [r.min_lon, r.min_lat, r.max_lon, r.max_lat],
    osmType: r.osm_type, osmId: r.osm_id,
  }));
  return rows.length > max ? {areas, troncato: true} : {areas};
}
