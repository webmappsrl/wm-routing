import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {makeDocumentoTool} from '../src/mcp/documento.js';
import {encodeLink} from '../src/mcp/link.js';
import {MAX_MARKDOWN} from '../src/mcp/markdown.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-route.json', import.meta.url)));
const key = 'chiave-di-prova';
const base = 'http://127.0.0.1:8991';
// diverso da gatewayUrl, come in produzione: il foglio non deve mai portare l'indirizzo locale
const PUBBLICO = 'https://r.example';
const previewDir = new URL('../../preview', import.meta.url).pathname;

const fakeFetch = (routeReply = {ok: true, status: 200, json: async () => fixture}) => async url =>
  (String(url).includes('/v1/version')
    ? {ok: true, status: 200, json: async () => ({osm: fixture.data.osm})}
    : routeReply);

const giro = {
  points: [[10.5216, 43.7249], [10.5455, 43.76]], profile: 'escursionista',
  stamp: fixture.data.osm, poi: [{osmId: 1, nota: 'la vetta'}, {osmId: 2, nota: 'la fonte'}],
};
const t = (g = giro) => encodeURIComponent(encodeLink(g, key));

// i POI si risolvono dal database, mai dal testo del modello
const resolvePoi = ids => ({
  trovati: ids.filter(i => i === 1 || i === 2).map(i => ({
    osmId: i, name: i === 1 ? 'Monte Serra' : 'Fonte del Mulino', kind: i === 1 ? 'peak' : 'spring',
    ele: i === 1 ? 917 : 320, lon: 10.55, lat: 43.75,
  })),
  mancanti: ids.filter(i => i !== 1 && i !== 2),
});

const tool = (opts = {}) => makeDocumentoTool({
  gatewayUrl: base, publicUrl: PUBBLICO, linkKey: key, previewDir, resolvePoi,
  fetchFn: fakeFetch(), ...opts,
});

it('compone un documento con i numeri del giro e il testo reso', async () => {
  const r = await tool()({
    t: t(),
    introduzione: 'Un giro **bello** sul monte.',
    luoghi: [{osmId: 1, testo: 'La cima si vede da lontano.'}, {osmId: 2, testo: 'Acqua fresca.'}],
    consigli: '- Parti presto',
    fonti: [{titolo: 'Wikipedia', url: 'https://it.wikipedia.org/wiki/Monte_Serra'}],
  });
  expect(r.stato).toBeUndefined();
  expect(r.luoghiIgnorati).toBe(0);
  expect(r.nomeFile).toMatch(/^giro-[\d.]+km\.html$/);
  expect(r.documento.startsWith('<!doctype html>')).toBe(true);
  // il css e il js sono dentro il file: aperto da file:// non chiede nulla a nessuno
  expect(r.documento).not.toContain('/preview/scheda.css');
  expect(r.documento).not.toContain('/preview/scheda.js');
  expect(r.documento).toContain('<style>');
  expect(r.documento).toContain('<script type="module">');
  // i dati inline ci sono, con i numeri calcolati dal server
  const blocco = r.documento.match(/<script type="application\/json" id="dati-giro">([\s\S]*?)<\/script>/)[1];
  const d = JSON.parse(blocco);
  expect(d.distanzaKm).toBe(+(fixture.distanceM / 1000).toFixed(2));
  expect(d.poi.map(p => p.name)).toEqual(['Monte Serra', 'Fonte del Mulino']);
  expect(d.racconto.introduzione).toContain('<strong>bello</strong>');
  expect(d.racconto.luoghi['1']).toContain('La cima si vede da lontano.');
  expect(d.racconto.consigli).toContain('<li>Parti presto</li>');
  expect(d.racconto.fonti).toEqual([{titolo: 'Wikipedia', url: 'https://it.wikipedia.org/wiki/Monte_Serra'}]);
});

it('blob alterato: firma_non_valida, come uno malformato', async () => {
  const guasto = t().slice(0, -3) + 'xxx';
  expect((await tool()({t: guasto})).stato).toBe('firma_non_valida');
  expect((await tool()({t: 'niente'})).stato).toBe('firma_non_valida');
});

it('un osmId che non sta nel blob non entra nel documento e si conta', async () => {
  const r = await tool()({t: t(), luoghi: [{osmId: 1, testo: 'vera'}, {osmId: 404, testo: 'inventata'}]});
  expect(r.luoghiIgnorati).toBe(1);
  expect(r.documento).not.toContain('inventata');
  const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(Object.keys(d.racconto.luoghi)).toEqual(['1']);
});

it('slot oltre il massimo: dice quale e di quanto, senza rimandare il testo', async () => {
  const lungo = 'a'.repeat(MAX_MARKDOWN + 7);
  const r = await tool()({t: t(), consigli: lungo});
  expect(r.stato).toBe('testo_troppo_lungo');
  expect(r.slot).toBe('consigli');
  expect(r.caratteri).toBe(MAX_MARKDOWN + 7);
  expect(r.massimo).toBe(MAX_MARKDOWN);
  expect(JSON.stringify(r)).not.toContain('aaaa');
  const r2 = await tool()({t: t(), luoghi: [{osmId: 1, testo: lungo}]});
  expect(r2.stato).toBe('testo_troppo_lungo');
  expect(r2.slot).toBe('luoghi[0]');
});

it('markup nel testo non diventa markup, e non chiude il blocco dei dati', async () => {
  const r = await tool()({t: t(), introduzione: 'ciao <script>alert(1)</script> fine'});
  expect(r.documento).not.toContain('<script>alert');
  expect(r.documento).not.toContain('</script> fine');
  const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.racconto.introduzione).toContain('&lt;script&gt;');
});

// I pattern $&, $`, $' e $$ hanno un significato nella STRINGA DI SOSTITUZIONE
// di String.replace: un "$&" scritto dall'assistente, senza difesa, rimette
// nel documento il testo trovato (il tag non escapato) e rompe il blocco.
it('i pattern con $ nel testo non vengono interpretati dalla sostituzione', async () => {
  for (const veleno of ['PRIMA $& DOPO', "PRIMA $' DOPO", 'PRIMA $` DOPO', 'PRIMA $$ DOPO']) {
    const r = await tool()({t: t(), introduzione: veleno, consigli: veleno,
      fonti: [{titolo: veleno, url: 'https://x.test/'}]});
    const blocchi = r.documento.match(/id="dati-giro"/g) ?? [];
    expect(blocchi).toHaveLength(1);
    expect(r.documento.match(/<script type="module">/g)).toHaveLength(1);
    const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
    expect(d.racconto.introduzione).toContain('DOPO');
  }
});

// titolo e url delle fonti non passano dal renderer Markdown: sono l'unico
// testo che arriva al blocco inline col "<" ancora crudo.
it('il titolo di una fonte non puo\' chiudere il blocco dei dati', async () => {
  const r = await tool()({t: t(),
    fonti: [{titolo: '</script><img src=x onerror=alert(1)>', url: 'https://x.test/'}]});
  expect(r.documento).not.toContain('<img src=x');
  expect(r.documento).not.toContain('</script><img');
  const blocco = r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1];
  const d = JSON.parse(blocco);
  expect(d.racconto.fonti[0].titolo).toBe('</script><img src=x onerror=alert(1)>');
});

it('il blocco modulo e\' JavaScript valido e non ha import residui', async () => {
  const r = await tool()({t: t()});
  const js = r.documento.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  expect(js).not.toMatch(/^\s*import\s/m);
  expect(() => new Function(js)).not.toThrow();   // un bundle rotto non parsa
  expect(js).toContain('disegnaProfilo');          // i moduli importati ci sono davvero
  expect(js).toContain('scalaProfilo');
});

it('testo vuoto, osmId estraneo e doppione si contano a parte', async () => {
  const r = await tool()({t: t(), luoghi: [
    {osmId: 1, testo: '   '}, {osmId: 404, testo: 'estranea'},
    {osmId: 2, testo: 'buona'}, {osmId: 2, testo: 'doppione'},
  ]});
  expect(r.luoghiIgnorati).toBe(1);      // solo l'osmId che non e' nel giro
  expect(r.luoghiSenzaTesto).toBe(1);
  expect(r.luoghiDuplicati).toBe(1);
  const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.racconto.luoghi['2']).toContain('buona');   // vince il primo
  expect(r.documento).not.toContain('doppione');
});

it('le fonti si filtrano prima di tagliare: una buona in fondo non si perde', async () => {
  const fonti = [...Array.from({length: 40}, () => ({titolo: 'rotta', url: 'ftp://x.test/'})),
    {titolo: 'buona', url: 'https://x.test/'}];
  const r = await tool()({t: t(), fonti});
  const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.racconto.fonti).toEqual([{titolo: 'buona', url: 'https://x.test/'}]);
});

it('l\'url di una fonte ha un tetto: 30 url enormi non fanno un documento enorme', async () => {
  const fonti = Array.from({length: 30}, () => ({titolo: 'x', url: 'https://x.test/' + 'a'.repeat(50000)}));
  const r = await tool()({t: t(), fonti});
  const d = JSON.parse(r.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.racconto.fonti).toHaveLength(30);
  expect(d.racconto.fonti.every(f => f.url.length === 500)).toBe(true);
  expect(r.documento.length).toBeLessThan(400000);
});

it('la libreria del QR e\' dentro il documento, non da CDN', async () => {
  const r = await tool()({t: t()});
  expect(r.documento).toContain('QR Code Generator for JavaScript');
  expect(r.documento).not.toMatch(/<script[^>]+qrcode/);
});

it('database dei POI guasto: dati_non_disponibili, non POI inesistenti', async () => {
  const r = await tool({resolvePoi: () => { throw new Error('db'); }})({t: t()});
  expect(r.stato).toBe('dati_non_disponibili');
});

it('gateway irraggiungibile: lo dice', async () => {
  const r = await tool({fetchFn: async () => { throw new Error('rete'); }})({t: t()});
  expect(r.stato).toBe('gateway_non_raggiungibile');
});

it('niente di scritto dal modello resta sul server fra due chiamate', async () => {
  const f = tool();
  await f({t: t(), introduzione: 'primo testo'});
  const r = await f({t: t()});
  expect(r.documento).not.toContain('primo testo');
});

it('i dati inline portano il link al GPX, composto dal server sul blob ricevuto', async () => {
  const r = await tool()({t: t()});
  const d = JSON.parse(r.documento.match(/<script type="application\/json" id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.linkGpx).toBe(`${PUBBLICO}/g/gpx?t=${t()}`);
  // anche se l'assistente passa il blob gia' decodificato
  const r2 = await tool()({t: decodeURIComponent(t())});
  expect(JSON.parse(r2.documento.match(/<script type="application\/json" id="dati-giro">([\s\S]*?)<\/script>/)[1]).linkGpx).toBe(`${PUBBLICO}/g/gpx?t=${t()}`);
});

it('linkGpx e\' l\'indirizzo pubblico, mai quello del gateway, e senza doppio slash', async () => {
  const r = await tool({publicUrl: 'https://x.it/'})({t: t()});
  const d = JSON.parse(r.documento.match(/<script type="application\/json" id="dati-giro">([\s\S]*?)<\/script>/)[1]);
  expect(d.linkGpx).toBe(`https://x.it/g/gpx?t=${t()}`);
  expect(d.linkGpx).not.toContain('127.0.0.1');
});
