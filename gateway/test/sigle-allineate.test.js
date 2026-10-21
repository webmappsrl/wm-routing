import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ratingToCai, ratingToCaiMtb} from '../src/difficulty.js';

// Le tabelle delle sigle vivono in due lingue: prepare/difficulty.py per il
// pre-passo, gateway/src/difficulty.js per chi risponde. Finora nessuno le
// confrontava, e si erano gia' allontanate. Questo test le tiene insieme: una
// divergenza nuova fallisce, una voluta sta nell'elenco qui sotto col motivo.

const PY = readFileSync(new URL('../../prepare/difficulty.py', import.meta.url), 'utf8');

// legge un dizionario `NOME = {...}` dal sorgente Python, in forma sigla -> rating
function tabellaPython(nome) {
  const corpo = PY.match(new RegExp(`^${nome} = \\{([^}]*)\\}`, 'm'))?.[1];
  if (!corpo) throw new Error(`tabella ${nome} non trovata in prepare/difficulty.py`);
  return Object.fromEntries([...corpo.matchAll(/"([^"]+)":\s*(\d+)/g)].map(([, k, v]) => [k, +v]));
}

// Divergenze volute, da tenere corte e motivate.
const AMMESSE = {
  // il pre-passo distingue "TQ" (turistico-qualificato) come sinonimo di T:
  // e' un valore che arriva dai dati, non una sigla da mostrare
  CAI: ['TQ'],
  CAI_MTB: [],
};

it('la scala a piedi dice le stesse cose nel pre-passo e nel gateway', () => {
  const py = tabellaPython('CAI');
  for (const [sigla, rating] of Object.entries(py)) {
    if (AMMESSE.CAI.includes(sigla)) continue;
    expect(ratingToCai(rating), `rating ${rating} (${sigla})`).toBe(sigla);
  }
});

it('la scala MTB dice le stesse cose nel pre-passo e nel gateway', () => {
  const py = tabellaPython('CAI_MTB');
  for (const [sigla, rating] of Object.entries(py)) {
    if (AMMESSE.CAI_MTB.includes(sigla)) continue;
    expect(ratingToCaiMtb(rating), `rating ${rating} (${sigla})`).toBe(sigla);
  }
});

it('ogni rating prodotto dal pre-passo ha una sigla nel gateway', () => {
  // il pre-passo puo' scrivere rating fino a 6 per la scala a piedi (sac_scale
  // oltre EEA): il gateway li schiaccia su EEA, ed e' voluto, ma nessuno deve
  // restare senza sigla
  for (let r = 1; r <= 6; r++) expect(ratingToCai(r), `rating a piedi ${r}`).not.toBe(null);
  const maxMtb = Math.max(...Object.values(tabellaPython('CAI_MTB')));
  for (let r = 1; r <= maxMtb; r++) expect(ratingToCaiMtb(r), `rating mtb ${r}`).not.toBe(null);
});
