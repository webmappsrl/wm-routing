import {it, expect} from 'vitest';
import {compareData} from '../../tools/gate-data.mjs';

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
