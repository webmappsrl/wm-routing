// Rotte GET /v1/:shard/places e /v1/:shard/areas: la ricerca per bbox del modulo
// bbox-search, sulla connessione in sola lettura gia' aperta dal server. Il bbox
// e gli altri parametri arrivano in query string: non vanno in nessun log.
import {parseBbox, searchPlacesInBbox, searchAreasInBbox} from './bbox-search.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const AREA_KINDS = ['region', 'zone'];

// intero dalla query string, con default e tetto; vuoto o non numerico vale il default
function parseLimit(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function makePlacesHandler({waysDb}) {
  return (req, res) => {
    const parsed = parseBbox(req.query.bbox);
    if (parsed.stato) return res.status(400).json(parsed);
    const {kinds} = req.query;
    const kindList = typeof kinds === 'string'
      ? kinds.split(',').map(k => k.trim()).filter(Boolean)
      : undefined;
    const result = searchPlacesInBbox(waysDb, {
      bbox: parsed.bbox, kinds: kindList, limit: parseLimit(req.query.limit),
    });
    res.status(result.stato ? 400 : 200).json(result);
  };
}

export function makeAreasHandler({waysDb}) {
  return (req, res) => {
    const {kind, bbox} = req.query;
    if (!AREA_KINDS.includes(kind)) return res.status(400).json({stato: 'kind_non_valido'});
    let box;
    if (bbox !== undefined) {
      const parsed = parseBbox(bbox);
      if (parsed.stato) return res.status(400).json(parsed);
      box = parsed.bbox;
    }
    const result = searchAreasInBbox(waysDb, {kind, bbox: box, limit: parseLimit(req.query.limit)});
    res.status(result.stato ? 400 : 200).json(result);
  };
}
