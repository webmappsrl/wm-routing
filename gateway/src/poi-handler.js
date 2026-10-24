// Rotta GET /v1/:shard/poi: la stessa ricerca del tool MCP poi_nearby, sulla
// connessione in sola lettura gia' aperta dal server. Lon, lat e raggio
// arrivano in query string: non vanno in nessun log.
import {searchPoiNearby} from './mcp/poi.js';

// numero dalla query string; vuoto o assente diventa NaN (Number('') varrebbe 0,
// cioe' un punto in mare)
const numero = v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

export function makePoiHandler({waysDb}) {
  return (req, res) => {
    const {lon, lat, radiusM} = req.query;
    const result = searchPoiNearby(waysDb, {
      point: [numero(lon), numero(lat)],
      radiusM: radiusM === undefined ? undefined : numero(radiusM),
    });
    res.status(result.stato === 'coordinate_non_valide' ? 400 : 200).json(result);
  };
}
