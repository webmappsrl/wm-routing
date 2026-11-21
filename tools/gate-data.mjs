// Confronto dei riassunti del pre-passo (prepare.json) prima dello scambio.
// Modulo puro: niente che giri da solo all'import, cosi' si prova dal gateway.
// Il dato che il pre-passo produce puo' mancare in silenzio (es. estrazione POI
// fallita) mentre il grafo resta valido: qui lo si controlla.
const THRESHOLD = 0.05;

const isFull = (v) => Number.isFinite(v) && v > 0;

const sum = (o) => Object.values(o && typeof o === 'object' ? o : {})
  .filter(Number.isFinite).reduce((t, n) => t + n, 0);

// Conteggi da confrontare, come coppie [nome, valore]: ways, pois e, se
// withAreas, un elemento per ogni kind di areas_built. Valori non numerici
// valgono NaN.
function counts(r, withAreas) {
  const out = new Map([['ways', r?.ways], ['pois', r?.pois]]);
  const areaCounts = r?.areas_built;
  if (withAreas && areaCounts && typeof areaCounts === 'object') {
    for (const [kind, n] of Object.entries(areaCounts)) out.set(`areas_built.${kind}`, n);
  }
  return out;
}

// next, current: riassunti gia' decodificati; current indefinito al primo build.
// Se una chiave del grafo in uso manca o e' a zero non c'e' base di confronto: si
// pretende solo che quella del nuovo sia piena. E' lo stesso comportamento di
// gate.mjs coi nodi (senza stamp in uso, drop vale 0) e copre il primo build.
//
// Le aree si pretendono solo se il pre-passo ne ha viste (areas_seen pieno):
// su un estratto ritagliato (la cella di prova) le relazioni perdono i membri
// fuori dal rettangolo, osmium non assembla niente e areas_built vuoto e' il
// risultato giusto. Con areas_seen pieno, invece, areas_built vuoto vuol dire
// che le aree c'erano e si sono perse.
// Limite residuo: al primo build su una macchina senza grafo in uso il gate non
// distingue un estratto senza aree da un filtro rotto, perche' guarda solo i
// conteggi. Senza una modalita' esplicita (build-graph.sh sa se ritaglia una
// cella o costruisce il nazionale) non puo' farlo; la modalita' e' lavoro
// successivo.
// Non c'e' una soglia sulla quota di aree perse (seen contro built): la perdita
// sul ritaglio e' strutturale (88 viste, 70 assemblate sulla cella) e una soglia
// assoluta bloccherebbe build validi. Il calo rispetto al grafo in uso, per kind,
// intercetta invece una regressione del pre-passo.
export function compareData(next, current) {
  const areasSeen = sum(next?.areas_seen);
  const withAreas = areasSeen > 0;
  const now = counts(next, withAreas);
  const reasons = [];
  if (withAreas && sum(next?.areas_built) === 0) {
    reasons.push(`areas_built vuoto: ${areasSeen} aree nel file e nessuna assemblata`);
  }
  // il grafo in uso aveva aree e il pre-passo adesso non ne vede nessuna: non e'
  // un estratto senza aree, e' una regressione (es. il filtro che le estrae si e' rotto)
  const areasBefore = sum(current?.areas_built);
  if (!withAreas && areasBefore > 0) {
    reasons.push(`il grafo in uso aveva ${areasBefore} aree assemblate e il pre-passo adesso non ne vede nessuna`);
  }
  for (const [key, n] of now) {
    if (!isFull(n)) reasons.push(`${key} mancante o a zero`);
  }
  if (current) {
    for (const [key, before] of counts(current, withAreas)) {
      if (!isFull(before)) continue; // niente da cui calare: basta il controllo sopra
      if (!now.has(key)) { reasons.push(`${key} mancante, nel grafo in uso era ${before}`); continue; }
      const after = now.get(key);
      if (isFull(after) && (before - after) / before > THRESHOLD) {
        reasons.push(`${key} calato da ${before} a ${after}`);
      }
    }
  }
  return reasons.length ? {ok: false, reason: reasons.join('; ')} : {ok: true};
}
