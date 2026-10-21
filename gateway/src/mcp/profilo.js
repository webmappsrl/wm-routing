// Profilo altimetrico disegnato dal server: sagoma riempita, griglia, tappe ed etichette.
// Nessuna libreria grafica: si compone un buffer RGB e lo si passa a encodePng.
import {encodePng} from './png.js';
import {cumulative, scalaProfilo} from '../../../preview/profilo-scala.js';

// Spazio riservato alle etichette: a sinistra le quote ("900 m"), in basso le distanze.
export const MARGINI = {left: 40, bottom: 16, top: 6};

const SFONDO = '#f8f9fa';
const RIEMPIMENTO = '#7a8f5c';
const BORDO = '#465534';
const TAPPA = '#d65a3c';
const ALTEZZA_TAPPA = 14;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// Font bitmap minimo 5x7: cifre, punto, "m", "k" e spazio. Ogni glifo e' un elenco di 7 righe,
// '#' = pixel acceso. I caratteri fuori elenco si saltano.
const GLIFI = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  'm': ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  'k': ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const LARGHEZZA_GLIFO = 5, ALTEZZA_GLIFO = 7, PASSO_GLIFO = 6;

// Larghezza in pixel di `testo` con il font sopra (i caratteri sconosciuti non contano).
const larghezzaTesto = testo =>
  Math.max(0, [...testo].filter(c => GLIFI[c]).length * PASSO_GLIFO - 1);

// Stampa `testo` con l'angolo in alto a sinistra in (x, y).
function disegnaTesto(set, x, y, testo, colore) {
  let cx = x;
  for (const c of testo) {
    const glifo = GLIFI[c];
    if (!glifo) continue;
    for (let r = 0; r < ALTEZZA_GLIFO; r++) {
      for (let k = 0; k < LARGHEZZA_GLIFO; k++) if (glifo[r][k] === '#') set(cx + k, y + r, colore);
    }
    cx += PASSO_GLIFO;
  }
}

function pennello(px, W, H) {
  return (x, y, colore) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    px[o] = colore[0]; px[o + 1] = colore[1]; px[o + 2] = colore[2];
  };
}

// Quota interpolata alla distanza `d`; `cum` e' crescente (o costante se la linea e' un punto).
function quotaA(d, cum, coords) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = coords[i - 1]?.[2] ?? 0, b = coords[i]?.[2] ?? a;
  const span = (cum[i] ?? 0) - (cum[i - 1] ?? 0);
  if (!(span > 0)) return b;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / span));
  return a + (b - a) * t;
}

export function profiloPng({coords, tappeIdx = [], width = 640, height = 200}) {
  const px = Buffer.alloc(width * height * 3);
  const set = pennello(px, width, height);
  const sfondo = rgb(SFONDO);
  for (let i = 0; i < px.length; i += 3) { px[i] = sfondo[0]; px[i + 1] = sfondo[1]; px[i + 2] = sfondo[2]; }

  const {left, bottom, top} = MARGINI;
  const scala = scalaProfilo({coords, width, height, left, bottom, top});
  const cum = cumulative(coords);
  const base = height - bottom;
  const larghezza = width - left - 6; // stesso margine destro del modulo condiviso
  const colonnaX = x => scala.maxD > 0 ? scala.x(((x - left) / larghezza) * scala.maxD) : left;

  // griglia orizzontale alle quote delle tacche
  const griglia = rgb(scala.colori.griglia);
  for (const {valore} of scala.tacche.quote) {
    const y = Math.round(scala.y(valore));
    for (let x = left; x < width - 6; x++) set(x, y, griglia);
  }

  // sagoma: per ogni colonna, dal bordo superiore fino alla base
  const riempimento = rgb(RIEMPIMENTO), bordo = rgb(BORDO);
  const cima = new Array(width).fill(base);
  for (let x = left; x < width - 6; x++) {
    const d = ((x - left) / larghezza) * scala.maxD;
    const y = Math.min(base, Math.max(top, Math.round(scala.y(quotaA(d, cum, coords)))));
    cima[x] = y;
    for (let yy = y; yy <= base; yy++) set(x, yy, riempimento);
  }
  for (let x = left; x < width - 6; x++) {
    // bordo spesso 2 px, raccordato con la colonna vicina perche' la linea non si spezzi
    const da = Math.min(cima[x], cima[Math.max(left, x - 1)]);
    const a = Math.max(cima[x], cima[Math.max(left, x - 1)]);
    for (let y = da; y <= Math.min(a, base); y++) set(x, y, bordo);
    set(x, Math.min(base, cima[x] + 1), bordo);
  }

  // tappe: segmento verticale sopra il profilo
  const tappa = rgb(TAPPA);
  for (const idx of tappeIdx) {
    if (!(Number.isInteger(idx) && idx >= 0 && idx < coords.length)) continue;
    const x = Math.round(scala.maxD > 0 ? scala.x(cum[idx]) : left);
    const y0 = Math.round(scala.y(coords[idx][2] ?? 0));
    for (let dx = 0; dx < 2; dx++) {
      for (let y = Math.max(top, y0 - ALTEZZA_TAPPA); y <= y0; y++) set(x + dx, y, tappa);
    }
  }

  // etichette: quote a sinistra (allineate a destra), distanze sotto il grafico
  const testo = rgb(scala.colori.testo);
  for (const {valore, etichetta} of scala.tacche.quote) {
    const y = Math.round(scala.y(valore)) - Math.floor(ALTEZZA_GLIFO / 2);
    disegnaTesto(set, left - 4 - larghezzaTesto(etichetta), Math.max(0, y), etichetta, testo);
  }
  const yDist = base + 5;
  scala.tacche.distanze.forEach(({etichetta}, i) => {
    const w = larghezzaTesto(etichetta);
    const x = i === 0 ? left : i === 1 ? left + Math.round((larghezza - w) / 2) : left + larghezza - w;
    disegnaTesto(set, x, yDist, etichetta, testo);
  });

  return encodePng(width, height, px);
}
