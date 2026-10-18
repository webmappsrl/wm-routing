import {it, expect} from 'vitest';
import {inflateSync} from 'node:zlib';
import {profiloPng, MARGINI} from '../src/mcp/profilo.js';

// Geometria sintetica: 200 punti che salgono da 100 a 600 m e tornano a 100.
const N = 200;
const coords = Array.from({length: N}, (_, i) => {
  const t = i / (N - 1);
  const quota = 100 + 500 * (1 - Math.abs(2 * t - 1));
  return [10.5 + i * 0.0005, 43.7, quota];
});
const tappeIdx = [0, 100, 199];

// Decodifica minima: l'encoder usa solo il filtro 0, quindi basta togliere il byte di filtro.
const decodifica = png => {
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  let o = 8, idat = Buffer.alloc(0);
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    if (png.toString('latin1', o + 4, o + 8) === 'IDAT') idat = Buffer.concat([idat, png.subarray(o + 8, o + 8 + len)]);
    o += 12 + len;
  }
  const raw = inflateSync(idat), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return {w, h, pixel: (x, y) => [...px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)]};
};
const esadecimale = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

it('e un PNG valido di 640x200 per default', () => {
  const png = profiloPng({coords, tappeIdx});
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(640);
  expect(png.readUInt32BE(20)).toBe(200);
});

it('e deterministico', () => {
  expect(profiloPng({coords, tappeIdx}).equals(profiloPng({coords, tappeIdx}))).toBe(true);
});

it('rispetta width e height richiesti', () => {
  const png = profiloPng({coords, tappeIdx, width: 320, height: 120});
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 120]);
});

it('in basso a sinistra del grafico (poco dopo la partenza, dove il profilo sale) c e la sagoma, in alto a destra lo sfondo', () => {
  const {pixel, w} = decodifica(profiloPng({coords, tappeIdx}));
  expect(esadecimale(pixel(MARGINI.left + 30, 200 - MARGINI.bottom - 2))).toBe('#7a8f5c');
  expect(esadecimale(pixel(w - 2, 2))).toBe('#f8f9fa');
});

it('una colonna in corrispondenza di una tappa contiene il colore della tappa', () => {
  const {pixel, h} = decodifica(profiloPng({coords, tappeIdx}));
  // la tappa a meta del giro cade sul picco, circa a meta della larghezza utile
  const x = Math.round(MARGINI.left + (640 - MARGINI.left - 6) * 100 / 199);
  const colori = new Set();
  for (let y = 0; y < h; y++) colori.add(esadecimale(pixel(x, y)));
  expect(colori.has('#d65a3c')).toBe(true);
});

it('quote tutte a zero: PNG valido delle dimensioni attese', () => {
  const piatta = coords.map(([x, y]) => [x, y, 0]);
  const png = profiloPng({coords: piatta, tappeIdx});
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 200]);
  expect(() => decodifica(png)).not.toThrow();
});

it('pesa meno di 20 KB sulla geometria sintetica', () => {
  expect(profiloPng({coords, tappeIdx}).length).toBeLessThan(20 * 1024);
});

it('l etichetta della quota massima ("600 m") e disegnata nel margine sinistro', () => {
  // la quota massima e 600 m: la scala arriva a 600; l'etichetta cade attorno a y(hi) = margine alto
  const {pixel} = decodifica(profiloPng({coords, tappeIdx}));
  let trovati = 0;
  for (let y = 0; y <= MARGINI.top + 10; y++) {
    for (let x = 0; x < MARGINI.left; x++) if (esadecimale(pixel(x, y)) === '#5f6b76') trovati++;
  }
  expect(trovati).toBeGreaterThan(10);
});

it('le etichette delle distanze sono disegnate sotto il grafico', () => {
  const {pixel, w, h} = decodifica(profiloPng({coords, tappeIdx}));
  let trovati = 0;
  for (let y = h - MARGINI.bottom + 1; y < h; y++) {
    for (let x = 0; x < w; x++) if (esadecimale(pixel(x, y)) === '#5f6b76') trovati++;
  }
  expect(trovati).toBeGreaterThan(30);
});

it('la tappa sul picco non esce dall area di disegno: nessun pixel tappa sulla riga 0', () => {
  // il picco sintetico (indice 100, 600 m) coincide con una tappa e con la quota massima della scala
  const {pixel, w} = decodifica(profiloPng({coords, tappeIdx}));
  for (let x = 0; x < w; x++) expect(esadecimale(pixel(x, 0))).not.toBe('#d65a3c');
});

it('un indice di tappa non intero viene ignorato, senza eccezioni', () => {
  const png = profiloPng({coords, tappeIdx: [1.5, 0, 100.25]});
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});
