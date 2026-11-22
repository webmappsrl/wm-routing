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
// Sulla quota di aree perse (seen contro built) non c'e' una soglia assoluta: la
// perdita sul ritaglio e' strutturale (88 viste, 70 assemblate sulla cella) e un
// valore fisso bloccherebbe build validi. Si confronta invece con la quota del
// grafo in uso: se prima se ne perdeva il 9% e adesso il 50%, qualcosa nel
// pre-passo ha smesso di assemblare, e il calo di areas_built da solo non lo
// mostra quando il file ne contiene di piu'.
// Quota di aree che il pre-passo vede nel file e non riesce ad assemblare,
// per kind. Senza viste non c'e' quota: vale null, e non si confronta.
function lostShare(r, kind) {
  const seen = r?.areas_seen?.[kind], built = r?.areas_built?.[kind] ?? 0;
  if (!isFull(seen) || !Number.isFinite(built)) return null;
  return (seen - built) / seen;
}

// Motivi per i kind la cui quota di perdita e' peggiorata oltre la soglia
// rispetto al grafo in uso. Senza grafo in uso non c'e' da cosa peggiorare.
function lostGrown(next, current, accepted) {
  if (!current) return [];
  const out = [];
  for (const kind of Object.keys(next?.areas_seen ?? {})) {
    // chi dichiara il calo di un kind dichiara la stessa causa: cambiare il
    // criterio con cui si conta sposta insieme assemblate e perse
    if (accepted.has(`areas_built.${kind}`)) continue;
    const now = lostShare(next, kind), before = lostShare(current, kind);
    if (now === null || before === null || now - before <= THRESHOLD) continue;
    out.push(`areas ${kind}: ${next.areas_seen[kind]} viste e ${next.areas_built?.[kind] ?? 0} assemblate, `
      + `il grafo in uso ne perdeva il ${Math.round(before * 100)}% e questo il ${Math.round(now * 100)}%`);
  }
  return out;
}

// Riga leggibile su quante aree il pre-passo ha visto nel file e quante ne ha
// assemblate, per kind. La si stampa a ogni build riuscito: il conteggio stava
// gia' in prepare.json, ed e' li' che mancavano Piemonte e Trentino senza che
// nessuno se ne accorgesse.
export function describeAreas(r) {
  const parts = [];
  for (const [kind, seen] of Object.entries(r?.areas_seen ?? {})) {
    if (!Number.isFinite(seen)) continue;
    const built = r?.areas_built?.[kind] ?? 0;
    const lost = seen - built;
    parts.push(`${kind} ${seen} viste, ${built} assemblate` + (lost > 0 ? `, ${lost} perse` : ''));
  }
  return parts.length ? `aree: ${parts.join('; ')}` : 'aree: nessuna vista nel file';
}

// accept: chiavi (`areas_built.region`, `pois`, ...) per cui un calo rispetto al
// grafo in uso e' voluto e non ferma lo scambio. Serve quando cambia il criterio
// con cui si conta, non quando il dato peggiora: dichiararne una lascia acceso
// il gate su tutte le altre, e non copre comunque una chiave sparita o a zero,
// che resta un guasto qualunque motivo si adduca.
export function compareData(next, current, {accept = []} = {}) {
  const accepted = new Set(Array.isArray(accept) ? accept : []);
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
  for (const r of lostGrown(next, current, accepted)) reasons.push(r);
  if (current) {
    for (const [key, before] of counts(current, withAreas)) {
      if (!isFull(before)) continue; // niente da cui calare: basta il controllo sopra
      if (!now.has(key)) { reasons.push(`${key} mancante, nel grafo in uso era ${before}`); continue; }
      const after = now.get(key);
      if (isFull(after) && (before - after) / before > THRESHOLD) {
        if (accepted.has(key)) { console.error(`   ${key} calato da ${before} a ${after}: calo dichiarato`); continue; }
        reasons.push(`${key} calato da ${before} a ${after}`);
      }
    }
  }
  return reasons.length ? {ok: false, reason: reasons.join('; ')} : {ok: true};
}
