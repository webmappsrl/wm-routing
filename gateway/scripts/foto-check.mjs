// Le foto dei luoghi: la pagina le chiede a Wikipedia solo per identificatore, le
// mostra solo con autore e licenza, e non parla con nessun altro server.
// Wikimedia e' simulata (nessuna rete) con le forme delle risposte vere: le
// miniature vengono da thumb.wikimedia.org. Il documento e' quello del tool,
// aperto da file:// come lo apre l'utente.
// Uso, dalla cartella gateway, con il gateway acceso: node scripts/foto-check.mjs [base-url]
// WM_PREVIEW=<cartella> prova una copia modificata della preview (mutazioni).
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {encodeLink} from '../src/mcp/link.js';
import {makeDocumentoTool} from '../src/mcp/documento.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8991';
const key = process.env.WM_LINK_KEY
  ?? readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^WM_LINK_KEY=(.*)$/m)?.[1];
const {osm: stamp} = await (await fetch(`${base}/v1/version`)).json();

// host ammessi: solo Wikimedia (API e miniature) e il CDN della libreria della mappa
const HOST_WIKI = ['it.wikipedia.org', 'commons.wikimedia.org', 'www.wikidata.org', 'thumb.wikimedia.org', 'upload.wikimedia.org'];
const HOST_MAPPA = ['cdn.jsdelivr.net', 'tiles.maphub.it'];

const poi = (osmId, name, extra = {}) => ({osmId, name, kind: 'peak', ele: 900, lon: 10.55, lat: 43.75, ...extra});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Commons: l'extmetadata di ogni file, scelto dal titolo. Il resto e' attribuzione valida.
const LIC = {LicenseShortName: {value: 'CC BY-SA 4.0'}};
const META = {
  'Con attribuzione': {Artist: {value: '<a href="x"><b>Mario Rossi</b></a><script>1</script>'}, ...LIC},
  'Senza autore': LIC,
  'Senza licenza': {Artist: {value: 'Mario Rossi'}},
  'Autore vuoto': {Artist: {value: ''}, ...LIC},
  'Licenza vuota': {Artist: {value: 'Mario Rossi'}, LicenseShortName: {value: ''}},
  'Autore di soli tag': {Artist: {value: '<b></b><i> </i><span></span>'}, ...LIC},
  'Licenza di soli tag': {Artist: {value: 'Mario Rossi'}, LicenseShortName: {value: '<b> </b>'}},
  'Autore invisibile': {Artist: {value: '&#8203;​﻿'}, ...LIC},
  'Da wikidata': {Artist: {value: 'Anna Verdi'}, ...LIC},
  'Host dirottato': {Artist: {value: 'Mario Rossi'}, ...LIC},
  'Immagine rotta': {Artist: {value: 'Mario Rossi'}, ...LIC},
  'Markup ostile': {Artist: {value: 'Carla <style>x{color:red}</style><img src=x onerror="window.__xss=1">&lt;b&gt;Neri&lt;/b&gt;'}, ...LIC},
};
const SCENARI = [
  {nome: 'attribuzione', db: [
    poi(1, 'Con attribuzione', {wikipedia: 'it:Con attribuzione'}),
    poi(2, 'Senza autore', {wikipedia: 'it:Senza autore'}),
    poi(3, 'Senza licenza', {wikipedia: 'it:Senza licenza'}),
    poi(4, 'Autore vuoto', {wikipedia: 'it:Autore vuoto'}),
    poi(5, 'Licenza vuota', {wikipedia: 'it:Licenza vuota'}),
    poi(6, 'Autore di soli tag', {wikipedia: 'it:Autore di soli tag'}),
    poi(7, 'Licenza di soli tag', {wikipedia: 'it:Licenza di soli tag'}),
    poi(8, 'Autore invisibile', {wikipedia: 'it:Autore invisibile'}),
    poi(9, 'Senza identificatore'),
  ], foto: ['Con attribuzione'], senzaRichiesta: ['Senza identificatore'], ritardo: 400, stampaSubito: true},
  {nome: 'wikidata e ostile', db: [
    poi(11, 'Solo wikidata', {wikidata: 'Q42'}),
    poi(12, 'Wikidata vuoto', {wikidata: 'Q43'}),
    poi(13, 'Immagine rotta', {wikipedia: 'it:Immagine rotta'}),
    poi(14, 'Markup ostile', {wikipedia: 'it:Markup ostile'}),
    poi(15, 'Host dirottato', {wikipedia: 'it:Host dirottato'}),   // la miniatura punta fuori da Wikimedia
  ], foto: ['Solo wikidata', 'Markup ostile']},
  // l'unica foto non si scarica: ne' figura ne' riga sulle foto nel piede
  {nome: 'solo immagine rotta', db: [poi(21, 'Immagine rotta', {wikipedia: 'it:Immagine rotta'})], foto: []},
];

let failed = 0;
const check = (c, l) => { console.log(`${c ? 'ok' : '!!'} ${l}`); if (!c) failed = 1; };
const browser = await chromium.launch();

async function scenario({nome, db, foto, senzaRichiesta = [], ritardo = 0, stampaSubito = false}) {
  console.log(`-- ${nome}`);
  const resolvePoi = ids => ({trovati: ids.map(i => db.find(p => p.osmId === i)).filter(Boolean), mancanti: []});
  const t = encodeLink({profile: 'escursionista', stamp,
    points: [[10.5208, 43.7246], [10.5547387, 43.7441146]], poi: db.map(p => ({osmId: p.osmId, nota: 'n'}))}, key);
  const doc = await makeDocumentoTool({gatewayUrl: base, publicUrl: base, linkKey: key, resolvePoi,
    ...(process.env.WM_PREVIEW ? {previewDir: process.env.WM_PREVIEW} : {})})({t});
  if (doc.stato) { console.error('!! documento_giro:', doc.stato); process.exit(1); }
  const file = join(mkdtempSync(join(tmpdir(), 'wm-foto-')), 'giro.html');
  writeFileSync(file, doc.documento);

  const richieste = [];   // TUTTE, anche quelle che poi si abortiscono
  const page = await browser.newPage();
  await page.addInitScript(() => { window.print = () => { window.__stampato = {
    figure: document.querySelectorAll('figure.foto').length,
    caricate: [...document.querySelectorAll('figure.foto img')].filter(i => i.complete && i.naturalWidth > 0).length}; }; });
  await page.route(/^https?:\/\//, async r => {
    const u = new URL(r.request().url());
    richieste.push({host: u.host, params: u.searchParams, path: u.pathname});
    if (!HOST_WIKI.includes(u.host)) return r.abort();
    if (ritardo) await new Promise(x => setTimeout(x, ritardo));
    const json = body => r.fulfill({json: body, headers: {'access-control-allow-origin': '*'}});
    const titles = u.searchParams.get('titles') ?? '';
    if (u.host === 'www.wikidata.org') {
      const q = u.searchParams.get('ids');
      return json({entities: {[q]: {sitelinks: q === 'Q42' ? {itwiki: {site: 'itwiki', title: 'Da wikidata'}} : {}}}});
    }
    if (u.host === 'thumb.wikimedia.org' || u.host === 'upload.wikimedia.org')
      return u.pathname.includes('Immagine_rotta') ? r.fulfill({status: 404, body: 'no'}) : r.fulfill({body: PNG, contentType: 'image/png'});
    if (u.host === 'it.wikipedia.org')
      return json({query: {pages: {1: {thumbnail: {source: titles === 'Host dirottato' ? 'https://evil.example/x.png' : `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(titles.replace(/ /g, '_'))}.jpg/500px-x.jpg`}, pageimage: `${titles}.jpg`}}}});
    const nomeFile = titles.replace(/^File:/, '').replace(/\.jpg$/, '');
    return json({query: {pages: {1: {imageinfo: [{extmetadata: META[nomeFile]}]}}}});
  });
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await page.goto(`file://${file}`);
  await page.waitForSelector('table.numeri');

  if (stampaSubito) {
    // chi preme Stampa subito, con Wikimedia ancora in volo, deve avere le foto sul foglio
    await page.click('#stampa');
    await page.waitForFunction(() => window.__stampato, null, {timeout: 20000});
    const s = await page.evaluate(() => window.__stampato);
    check(s.figure === foto.length && s.caricate === foto.length,
      `Stampa subito aspetta le foto in volo (${s.figure} figure, ${s.caricate} caricate, attese ${foto.length})`);
  }
  await page.waitForTimeout(ritardo ? 2500 : 1500);

  const figure = await page.$$eval('figure.foto', fs => fs.map(f => ({
    luogo: f.closest('tr').cells[0].textContent.trim(), colonna: f.closest('td').cellIndex,
    cap: f.querySelector('figcaption').textContent, figli: f.querySelector('figcaption').children.length})));
  const luoghi = figure.map(f => db.find(p => f.luogo.startsWith(p.name))?.name).sort();
  check(JSON.stringify(luoghi) === JSON.stringify([...foto].sort()), `foto solo dove serve: ${JSON.stringify(luoghi)}`);
  check(figure.every(f => f.colonna === 0), 'ogni foto sta nella colonna del luogo, non in quella dell\'assistente');
  check(figure.every(f => f.figli === 0), 'la didascalia e\' solo testo (nessun elemento dentro)');
  for (const f of figure) {
    check(/^Foto: \S.*, CC BY-SA 4\.0, da Wikipedia$/.test(f.cap), `didascalia con autore e licenza (${f.cap})`);
    check(!/[<>]\w|<\/|onerror|color:red|\{/.test(f.cap.replace(/<b>/g, '')) || f.luogo.startsWith('Markup ostile'), 'nessun residuo di markup nella didascalia');
  }
  if (figure.some(f => f.luogo.startsWith('Con attribuzione')))
    check(figure.find(f => f.luogo.startsWith('Con attribuzione')).cap === 'Foto: Mario Rossi, CC BY-SA 4.0, da Wikipedia', 'autore ridotto al solo testo');
  if (figure.some(f => f.luogo.startsWith('Markup ostile')))
    check(figure.find(f => f.luogo.startsWith('Markup ostile')).cap === 'Foto: Carla <b>Neri</b>, CC BY-SA 4.0, da Wikipedia',
      'markup ostile in Artist: testo letterale, style e img scartati');
  check(await page.evaluate(() => window.__xss) === undefined, 'nessuno script eseguito dai metadati');
  check(await page.$$eval('figure.foto img', is => is.every(i => i.complete && i.naturalWidth > 0)), 'ogni figura ha un\'immagine caricata (un 404 non lascia figure vuote)');
  check(await page.$$eval('#nota-foto', n => n.length) === (foto.length ? 1 : 0), 'la riga sulle foto c\'e\' solo se c\'e\' almeno una foto');
  if (nome === 'wikidata e ostile')
    check(await page.$$eval('figure.foto', f => f.every(x => !x.closest('tr').textContent.includes('Immagine rotta'))), 'immagine che risponde 404: niente figura ne\' didascalia');

  // il guardiano: nessun host fuori lista, nessuna ricerca per posizione
  const fuori = [...new Set(richieste.map(r => r.host).filter(h => !HOST_WIKI.includes(h) && !HOST_MAPPA.includes(h)))];
  check(!fuori.length, `nessuna richiesta fuori da Wikimedia e dal CDN della mappa (${fuori.join(', ') || 'nessuna'})`);
  const api = richieste.filter(r => /\/w\/api\.php$/.test(r.path));
  check(api.length > 0 && api.every(r => ![...r.params.keys()].some(k => k === 'list' || k === 'generator' || /^gs/.test(k))
    && (r.params.get('titles') || r.params.get('ids'))), 'ogni richiesta alle API porta titles o ids, mai list, generator o gs*');
  check(!richieste.some(r => senzaRichiesta.some(n => [...r.params.values()].some(v => v.includes(n)))), 'nessuna richiesta per il luogo senza identificatore');
  check(!errori.length, `nessun errore di pagina ${errori.join(' | ')}`);
  const righe = await page.$$eval('#scheda table', ts =>
    ts.find(t => t.querySelector('th')?.textContent.trim() === 'Luogo').querySelectorAll('tbody tr').length);
  check(righe === db.length, `tutti i luoghi restano in tabella anche senza foto (${righe})`);
  await page.close();
}

for (const s of SCENARI) await scenario(s);
await browser.close();
process.exit(failed);
