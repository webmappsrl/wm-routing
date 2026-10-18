import {describe, it, expect} from 'vitest';
import {cumulative, scalaProfilo} from '../../preview/profilo-scala.js';

const linea = quote => quote.map((e, i) => [10 + i * 0.001, 44, e]);
const dim = {width: 300, height: 120, left: 42, bottom: 18};

describe('profilo-scala', () => {
  it('cumulative: 0.01 gradi di longitudine a 44 gradi sono ~800 m', () => {
    const d = cumulative([[10, 44], [10.01, 44]]);
    expect(d[0]).toBe(0);
    expect(Math.abs(d[1] - 800) / 800).toBeLessThan(0.05);
  });

  it('quote 31..870: lo 0, hi 900, etichette di quota', () => {
    const s = scalaProfilo({coords: linea([31, 500, 870]), ...dim});
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(900);
    expect(s.tacche.quote.map(t => t.etichetta)).toEqual(['0 m', '450 m', '900 m']);
  });

  it('percorso piatto: hi - lo = 50 e nessun NaN', () => {
    const s = scalaProfilo({coords: linea([100, 100, 100]), ...dim});
    expect(s.hi - s.lo).toBe(50);
    expect(Number.isNaN(s.y(100))).toBe(false);
  });

  it('x e y agli estremi', () => {
    const s = scalaProfilo({coords: linea([31, 870]), ...dim});
    expect(s.x(0)).toBe(dim.left);
    expect(s.x(s.maxD)).toBe(dim.width - 6);
    expect(s.y(s.lo)).toBe(dim.height - dim.bottom);
  });

  it('etichette di distanza su 20560 m', () => {
    const s = scalaProfilo({coords: [[10, 0, 0], [10 + 20560 / 111320, 0, 10]], ...dim});
    expect(s.tacche.distanze.map(t => t.etichetta)).toEqual(['0.0 km', '10.3 km', '20.6 km']);
  });

  it('colori e scala condivisa fra piu linee', () => {
    const s = scalaProfilo({linee: [linea([10, 20]), linea([10, 20, 30, 400])], ...dim});
    expect(s.colori).toEqual({griglia: '#d8dde2', testo: '#5f6b76'});
    expect(s.hi).toBe(400);
  });
});
