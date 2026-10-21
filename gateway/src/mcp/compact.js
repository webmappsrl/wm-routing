// Compatta la risposta di /v1/:shard/route per un modello di linguaggio:
// totali, tappe cumulate, sentieri aggregati per ref, avvisi e un campione
// della geometria. La risposta grezza (geometria integrale, tratti) non
// esce mai da qui, e nessun campo riciclato (horse) viene propagato.

export function compactRoute(j) {
  const coords = j.geometry?.coordinates ?? [];
  // lunghezza cumulata lungo la geometria, per pesare i tratti dei sentieri
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    cum.push(cum[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1) * 111320);
  }
  const trails = new Map();
  for (const s of j.segments ?? []) {
    const key = `${s.ref || '(senza ref)'}|${s.difficulty ?? ''}|${s.roadClass ?? ''}`;
    trails.set(key, (trails.get(key) ?? 0) + cum[s.to] - cum[s.from]);
  }
  const step = Math.max(1, Math.ceil(coords.length / 25));
  const sample = coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
    .map(([x, y, e]) => [+x.toFixed(5), +y.toFixed(5), Math.round(e ?? 0)]);
  const quote = coords.map(c => c[2] ?? 0);
  return {
    profilo: j.profile,
    distanzaKm: +(j.distanceM / 1000).toFixed(2),
    salitaM: Math.round(j.ascendM),
    discesaM: Math.round(j.descendM),
    oreDIN33466: +j.timeH.toFixed(2),
    quotaMinMaxM: coords.length
      ? [Math.round(Math.min(...quote)), Math.round(Math.max(...quote))] : null,
    tappe: (j.waypoints ?? []).map(w => ({
      punto: w.punto,
      kmDallaPartenza: +(w.distanceM / 1000).toFixed(2),
      oreDallaPartenza: +(+w.timeH).toFixed(2),
    })),
    sentieri: [...trails.entries()]
      .map(([k, d]) => {
        const [ref, difficolta, tipo] = k.split('|');
        return {ref, difficolta: difficolta || null, tipo: tipo || null, km: +(d / 1000).toFixed(2)};
      })
      .sort((a, b) => b.km - a.km),
    avvisi: {
      warning: j.warning,
      // tratti riusciti solo con un profilo piu' permissivo (fallback di /v1)
      trattiConAltroProfilo: (j.fallbackLegs ?? [])
        .map(l => ({daPunto: l.from, aPunto: l.to, profilo: l.profile})),
      rischioNeve: j.snowWarning ?? false,
      quotaSentieriSconosciuti: j.unknownShare ?? 0,
      puntiFuoriSentiero: j.offTrailPoints ?? [],
      connettori: j.connectors ?? [],
      suggerimentoProfilo: j.suggerimento ?? null,
    },
    geometriaCampione: sample,
  };
}
