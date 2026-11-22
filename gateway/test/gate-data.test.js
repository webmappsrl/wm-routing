import {it, expect} from 'vitest';
import {compareData, describeAreas} from '../../tools/gate-data.mjs';

const current = {ways: 1000, pois: 1000, areas_seen: {region: 110, zone: 250}, areas_built: {region: 100, zone: 200}};
const withOver = (over, base = current) => ({...base, areas_seen: {...base.areas_seen}, areas_built: {...base.areas_built}, ...over});
const without = (key, base = current) => { const {[key]: _, ...rest} = withOver({}, base); return rest; };
const blocked = (r, ...names) => {
  expect(r.ok).toBe(false);
  for (const n of names) expect(r.reason).toContain(n);
};

it('un kind di aree che il grafo in uso aveva e il nuovo non ha ferma lo scambio', () => {
  blocked(compareData(withOver({areas_built: {zone: 200}}), current), 'region');
});
it('un kind di aree in calo oltre il 5% senza sparire ferma lo scambio', () => {
  blocked(compareData(withOver({areas_built: {region: 80, zone: 200}}), current), 'areas_built.region');
});
it('pois calati dell\'1% passano', () => {
  expect(compareData(withOver({pois: 990}), current)).toEqual({ok: true});
});
it('pois calati del 20% fermano lo scambio e il motivo nomina la chiave', () => {
  blocked(compareData(withOver({pois: 800}), current), 'pois');
});
it('pois a zero con un grafo in uso che li aveva ferma lo scambio (il caso reale)', () => {
  blocked(compareData(withOver({pois: 0}), current), 'pois');
});
it('pois a zero al primo build fermano lo scambio', () => {
  blocked(compareData(withOver({pois: 0}), undefined), 'pois');
});
it('nessun grafo in uso e chiavi piene: passa', () => {
  expect(compareData(withOver({}), undefined)).toEqual({ok: true});
});
it('ways mancante ferma lo scambio e il motivo lo nomina', () => {
  blocked(compareData(without('ways'), current), 'ways');
});
it('ways in calo oltre il 5% ferma lo scambio', () => {
  blocked(compareData(withOver({ways: 900}), current), 'ways');
});
it('pois mancante ferma lo scambio e il motivo lo nomina', () => {
  blocked(compareData(without('pois'), undefined), 'pois');
});
it('areas_seen pieno e areas_built vuoto o assente: le aree c\'erano e non sono state assemblate', () => {
  for (const r of [compareData(withOver({areas_built: {}}), undefined), compareData(without('areas_built'), undefined)]) {
    blocked(r, 'areas_built vuoto', 'nessuna assemblata');
  }
});
it('areas_seen vuoto o assente e areas_built vuoto: passa (estratto ritagliato, niente da assemblare)', () => {
  expect(compareData(withOver({areas_seen: {}, areas_built: {}}), undefined)).toEqual({ok: true});
  const cellCurrent = withOver({areas_seen: {}, areas_built: {}});
  expect(compareData(withOver({areas_seen: {}, areas_built: {}}), cellCurrent)).toEqual({ok: true});
  expect(compareData(without('areas_seen', withOver({areas_built: {}})), undefined)).toEqual({ok: true});
});
it('areas_seen vuoto non scusa il resto: pois a zero blocca lo stesso', () => {
  blocked(compareData(withOver({areas_seen: {}, areas_built: {}, pois: 0}), undefined), 'pois');
});
it('aree perse in parte (come sulla cella: 70 assemblate su 88) non bloccano da sole', () => {
  expect(compareData(withOver({areas_seen: {region: 100, zone: 250}, areas_built: {region: 100, zone: 200}}), current))
    .toEqual({ok: true});
  expect(compareData(withOver({areas_seen: {zone: 88}, areas_built: {zone: 70}}), undefined)).toEqual({ok: true});
});
it('il confine del 5%: appena sotto passa, appena sopra blocca', () => {
  expect(compareData(withOver({pois: 950}), current)).toEqual({ok: true});
  blocked(compareData(withOver({pois: 949}), current), 'pois');
});
it('grafo in uso con una chiave a zero o mancante: basta che il nuovo sia pieno', () => {
  expect(compareData(withOver({}), withOver({pois: 0}))).toEqual({ok: true});
  expect(compareData(withOver({}), without('pois'))).toEqual({ok: true});
  expect(compareData(withOver({}), without('areas_built'))).toEqual({ok: true});
  blocked(compareData(withOver({pois: 0}), withOver({pois: 0})), 'pois');
});
it('pois a zero: il motivo e\' "a zero", non un calo contato due volte', () => {
  const r = compareData(withOver({pois: 0}), current);
  expect(r.reason).toContain('pois mancante o a zero');
  expect(r.reason).not.toContain('calato');
});
it('un kind a zero nel grafo in uso e assente nel nuovo non ferma niente', () => {
  expect(compareData(withOver({areas_built: {zone: 200}}), withOver({areas_built: {region: 0, zone: 200}})))
    .toEqual({ok: true});
});
it('il grafo in uso aveva aree e il nuovo non ne vede nessuna: regressione, blocca', () => {
  const r = compareData(withOver({areas_seen: {}, areas_built: {}}), current);
  blocked(r, 'il grafo in uso aveva 300 aree', 'non ne vede nessuna');
  blocked(compareData(without('areas_seen', withOver({areas_built: {}})), current), 'non ne vede nessuna');
});
it('grafo in uso senza aree o assente e nuovo senza aree viste: passa (la cella di prova)', () => {
  const none = withOver({areas_seen: {}, areas_built: {}});
  expect(compareData(none, undefined)).toEqual({ok: true});
  expect(compareData(none, withOver({areas_seen: {}, areas_built: {}}))).toEqual({ok: true});
  expect(compareData(none, without('areas_built'))).toEqual({ok: true});
});

const cellCurrent = () => withOver({areas_seen: {}, areas_built: {}});
const cellNext = (over) => withOver({areas_seen: {}, areas_built: {}, ...over});
it('senza aree viste, ways e pois restano obbligatori', () => {
  blocked(compareData(cellNext({ways: 0}), undefined), 'ways');
  blocked(compareData(without('ways', cellNext({})), undefined), 'ways');
  blocked(compareData(without('pois', cellNext({})), undefined), 'pois');
});
it('senza aree viste, il confronto col grafo in uso vale ancora per ways e pois', () => {
  expect(compareData(cellNext({pois: 960, ways: 960}), cellCurrent())).toEqual({ok: true});
  blocked(compareData(cellNext({pois: 800}), cellCurrent()), 'pois');
  blocked(compareData(cellNext({ways: 800}), cellCurrent()), 'ways');
  blocked(compareData(cellNext({pois: 949}), cellCurrent()), 'pois');
  blocked(compareData(cellNext({ways: 949}), cellCurrent()), 'ways');
});
it('una sola area vista basta a pretendere areas_built', () => {
  blocked(compareData(withOver({areas_seen: {zone: 1}, areas_built: {}}), undefined), 'nessuna assemblata');
});

// Perdita di aree: quante il pre-passo ne vede nel file e quante ne assembla
// davvero. Una quota di perdita c'e' sempre (le relazioni tagliate dal
// ritaglio non si chiudono), quindi non c'e' un valore giusto in assoluto: si
// guarda se la quota peggiora rispetto al grafo in uso.
it('una perdita di aree che resta come quella del grafo in uso passa', () => {
  // 10 su 110 perse prima, 10 su 110 adesso
  expect(compareData(withOver({}), current)).toEqual({ok: true});
});
// Il caso va costruito con areas_built invariato: se cala anche quello, a
// fermare lo scambio basta il calo, e il test passerebbe senza provare niente.
it('una perdita peggiorata ferma lo scambio anche se le aree assemblate non calano', () => {
  const r = compareData(withOver({areas_seen: {region: 200, zone: 250}, areas_built: {region: 100, zone: 200}}), current);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/200/);
  expect(r.reason).toMatch(/100/);
});
it('senza grafo in uso la perdita non si giudica: non c\'e\' da cosa', () => {
  expect(compareData(withOver({areas_seen: {region: 110, zone: 250}, areas_built: {region: 55, zone: 200}}), undefined))
    .toEqual({ok: true});
});

// La perdita di aree va detta a ogni build, non solo quando peggiora: e' il
// numero da cui si e' visto che mancavano Piemonte e Trentino, ed era scritto
// in prepare.json dove nessuno lo leggeva.
it('il riassunto delle aree dice viste, assemblate e perse per kind', () => {
  const r = describeAreas({areas_seen: {region: 20, zone: 218}, areas_built: {region: 18, zone: 180}});
  expect(r).toContain('region 20 viste, 18 assemblate, 2 perse');
  expect(r).toContain('zone 218 viste, 180 assemblate, 38 perse');
});
it('senza aree viste il riassunto lo dice invece di tacere', () => {
  expect(describeAreas({})).toBe('aree: nessuna vista nel file');
});
it('un kind senza perdite non si porta dietro un numero di perse', () => {
  expect(describeAreas({areas_seen: {region: 20}, areas_built: {region: 20}}))
    .toBe('aree: region 20 viste, 20 assemblate');
});

// Un calo voluto esiste: cambiare il criterio con cui si riconosce una regione
// fa calare il conteggio apposta. Va dichiarato chiave per chiave, cosi' il
// gate resta acceso per tutto il resto invece di essere spento in blocco.
it('un calo dichiarato non ferma lo scambio', () => {
  expect(compareData(withOver({areas_built: {region: 20, zone: 200}}), current,
                     {accept: ['areas_built.region']})).toEqual({ok: true});
});
it('dichiarare una chiave non copre le altre', () => {
  blocked(compareData(withOver({areas_built: {region: 20, zone: 50}}), current,
                      {accept: ['areas_built.region']}), 'areas_built.zone');
});
it('dichiarare un calo non zittisce una chiave sparita del tutto', () => {
  blocked(compareData(withOver({areas_built: {zone: 200}}), current,
                      {accept: ['areas_built.region']}), 'region');
});
it('dichiarare un calo non zittisce pois a zero', () => {
  blocked(compareData(withOver({pois: 0}), current, {accept: ['pois']}), 'pois');
});
