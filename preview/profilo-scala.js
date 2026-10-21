// Scala del profilo altimetrico, condivisa da preview, scheda stampabile e server.
// Modulo ESM puro: nessun riferimento a window o al DOM, perche' lo importa anche Node.
// Si condividono scala, tacche ed etichette, non il tratto (la preview traccia linee
// colorate per criterio, il server riempie una sagoma).

// Distanze cumulate in metri lungo una linea di coordinate [lon, lat, ...].
export function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
    const k = Math.cos((y1 + y2) / 2 * Math.PI / 180);
    out.push(out[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1) * 111320);
  }
  return out;
}

const PASSO_QUOTA = 50;
const MARGINE_DESTRO = 6;
const MARGINE_ALTO = 6;

// `coords` e' una linea; `linee` (facoltativo) e' un elenco di linee che condividono la
// stessa scala (serie e alternative della preview) e prevale su `coords`.
export function scalaProfilo({coords, linee, width, height, left, bottom, top = MARGINE_ALTO}) {
  const tutte = linee ?? [coords];
  const quote = tutte.flatMap(l => l.map(p => p[2] ?? 0));
  const lo = Math.floor(Math.min(...quote) / PASSO_QUOTA) * PASSO_QUOTA;
  const hi = Math.ceil(Math.max(lo + PASSO_QUOTA, ...quote) / PASSO_QUOTA) * PASSO_QUOTA;
  const maxD = Math.max(...tutte.map(l => cumulative(l).at(-1)));
  const x = d => left + (d / maxD) * (width - left - MARGINE_DESTRO);
  const y = e => height - bottom - ((e - lo) / (hi - lo)) * (height - bottom - top);
  return {
    lo, hi, maxD, x, y,
    tacche: {
      quote: [lo, (lo + hi) / 2, hi].map(valore => ({valore, etichetta: `${Math.round(valore)} m`})),
      distanze: [0, 0.5, 1].map(f => ({valore: maxD * f, etichetta: `${(maxD * f / 1000).toFixed(1)} km`})),
    },
    colori: {griglia: '#d8dde2', testo: '#5f6b76'},
  };
}
