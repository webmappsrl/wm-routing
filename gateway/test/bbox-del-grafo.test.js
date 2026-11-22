import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Il rettangolo del grafo non e' una scelta geografica: lo detta il DEM delle
// quote di wm-tiles, perche' fuori dal DEM GraphHopper mette 0 in silenzio.
// Fra i due vincoli - stare dentro il DEM e contenere l'Italia - c'era un
// margine interno di 0,05 gradi che tagliava il Piemonte di 1,8 km e il
// Trentino di 4,7 km: le loro relation non si chiudevano e osmium le scartava,
// cosi' due regioni su venti mancavano da /areas senza che nulla lo dicesse.
const BBOX = readFileSync(resolve(import.meta.dirname, '../../tools/bbox.sh'), 'utf8')
  .match(/WM_GRAPH_BBOX="\$\{WM_GRAPH_BBOX:-([^}]+)\}"/)[1]
  .split(',').map(Number);

const DEM = [6.6, 35.4, 18.6, 47.1];   // bounds letti da terrain.pmtiles
// punti estremi delle due regioni che il margine tagliava
const PIEMONTE_OVEST = 6.6273, TRENTINO_NORD = 47.0921;

it('il rettangolo del grafo sta dentro il DEM, che e\' il vincolo vero', () => {
  const [w, s, e, n] = BBOX;
  expect(w).toBeGreaterThanOrEqual(DEM[0]);
  expect(s).toBeGreaterThanOrEqual(DEM[1]);
  expect(e).toBeLessThanOrEqual(DEM[2]);
  expect(n).toBeLessThanOrEqual(DEM[3]);
});

it('contiene il punto piu\' a ovest del Piemonte', () => {
  expect(BBOX[0]).toBeLessThan(PIEMONTE_OVEST);
});

it('contiene il punto piu\' a nord del Trentino', () => {
  expect(BBOX[3]).toBeGreaterThan(TRENTINO_NORD);
});
