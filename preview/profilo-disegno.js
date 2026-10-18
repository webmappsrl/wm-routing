// Disegno del profilo altimetrico su <canvas>, condiviso da preview e scheda stampabile:
// le due pagine mostrano lo stesso profilo perche' lo disegna lo stesso codice.
// serie:        [{c: coords, colore, tratteggio, segmenti?}] (segmenti: tratti da colorare a parte)
// alternative:  [{c: coords}] disegnate in grigio sotto le serie
// opzioni:      coloreSegmento(seg) per i tratti colorati, sinistra/basso per i margini.
import {cumulative, scalaProfilo} from './profilo-scala.js';

export function disegnaProfilo(cv, serie, alternative = [], {coloreSegmento, sinistra = 42, basso = 18} = {}) {
  const ctx = cv.getContext('2d');
  const dpr = globalThis.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cv.clientWidth, H = cv.clientHeight, L = sinistra, B = basso;
  ctx.clearRect(0, 0, W, H);
  const linee = serie.map(s => ({...s, d: cumulative(s.c)}));
  const alt = alternative.map(a => ({c: a.c, d: cumulative(a.c)}));
  if (!linee.length) return null;
  const scala = scalaProfilo({linee: [...linee, ...alt].map(s => s.c), width: W, height: H, left: L, bottom: B});
  const {lo, maxD, x, y} = scala;
  ctx.strokeStyle = scala.colori.griglia; ctx.fillStyle = scala.colori.testo; ctx.font = '10px system-ui';
  for (const t of scala.tacche.quote) {
    ctx.beginPath(); ctx.moveTo(L, y(t.valore)); ctx.lineTo(W - 6, y(t.valore)); ctx.stroke();
    ctx.fillText(t.etichetta, 2, y(t.valore) + 3);
  }
  scala.tacche.distanze.forEach((t, i, tutte) =>
    ctx.fillText(t.etichetta, x(t.valore) - (i === tutte.length - 1 ? 30 : i ? 14 : 0), H - 4));
  // le alternative in grigio sotto tutto, come GraphHopper Maps
  for (const a of alt) {
    ctx.strokeStyle = '#b9c2cb'; ctx.lineWidth = 1.5; ctx.beginPath();
    a.c.forEach((p, i) => (i ? ctx.lineTo(x(a.d[i]), y(p[2] ?? lo)) : ctx.moveTo(x(a.d[i]), y(p[2] ?? lo))));
    ctx.stroke();
  }
  for (const s of linee) {
    if (s.segmenti?.length && coloreSegmento) {
      ctx.lineWidth = 3;
      for (const seg of s.segmenti) {
        ctx.strokeStyle = coloreSegmento(seg); ctx.beginPath();
        for (let i = seg.from; i <= seg.to && i < s.c.length; i++) {
          const px = x(s.d[i]), py = y(s.c[i][2] ?? lo);
          i === seg.from ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      continue;
    }
    ctx.strokeStyle = s.colore; ctx.lineWidth = 2;
    ctx.setLineDash(s.tratteggio ? [6, 4] : []); ctx.beginPath();
    s.c.forEach((p, i) => (i ? ctx.lineTo(x(s.d[i]), y(p[2] ?? lo)) : ctx.moveTo(x(s.d[i]), y(p[2] ?? lo))));
    ctx.stroke(); ctx.setLineDash([]);
  }
  return {L, W, maxD, linee, alt};
}
