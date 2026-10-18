// Le foto dei luoghi: la pagina le chiede a Wikipedia solo per identificatore e
// le mostra solo con autore e licenza. Wikimedia e' simulata (nessuna rete),
// il documento e' quello vero del tool, aperto da file:// come lo apre l'utente.
// Uso, dalla cartella gateway, con il gateway acceso: node scripts/foto-check.mjs [base-url]
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
const poi = (osmId, name, extra = {}) => ({osmId, name, kind: 'peak', ele: 900, lon: 10.55, lat: 43.75, ...extra});
const DB = [poi(1, 'Con attribuzione', {wikipedia: 'it:Con attribuzione'}),
  poi(2, 'Senza autore', {wikipedia: 'it:Senza autore'}),
  poi(3, 'Senza identificatore'),
  poi(4, 'Solo wikidata', {wikidata: 'Q42'})];
const resolvePoi = ids => ({trovati: ids.map(i => DB.find(p => p.osmId === i)).filter(Boolean), mancanti: []});
const t = encodeLink({profile: 'escursionista', stamp,
  points: [[10.5208, 43.7246], [10.5547387, 43.7441146]], poi: DB.map(p => ({osmId: p.osmId, nota: 'n'}))}, key);
const doc = await makeDocumentoTool({gatewayUrl: base, publicUrl: base, linkKey: key, resolvePoi})({t});
if (doc.stato) { console.error('!! documento_giro:', doc.stato); process.exit(1); }
const file = join(mkdtempSync(join(tmpdir(), 'wm-foto-')), 'giro.html');
writeFileSync(file, doc.documento);

let failed = 0;
const check = (c, l) => { console.log(`${c ? 'ok' : '!!'} ${l}`); if (!c) failed = 1; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const richieste = [];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/^https?:\/\//, async r => {
  const u = new URL(r.request().url());
  if (!/wikipedia\.org|wikimedia\.org|wikidata\.org/.test(u.host)) return r.abort();
  richieste.push(u.host + ' ' + (u.searchParams.get('titles') ?? u.searchParams.get('ids') ?? ''));
  const json = body => r.fulfill({json: body, headers: {'access-control-allow-origin': '*'}});
  const titles = u.searchParams.get('titles') ?? '';
  if (u.host.endsWith('wikidata.org')) return json({entities: {Q42: {sitelinks: {}}}});     // nessun sito: niente foto
  if (u.host === 'upload.wikimedia.org' || u.host === 'thumb.wikimedia.org') return r.fulfill({body: PNG, contentType: 'image/png'});
  if (u.host.endsWith('wikipedia.org')) {
    return json({query: {pages: {1: {thumbnail: {source: 'https://upload.wikimedia.org/x.png'}, pageimage: `${titles}.jpg`}}}});
  }
  // Commons: il file "Senza autore" manca dell'Artist
  const em = titles.includes('Senza autore')
    ? {LicenseShortName: {value: 'CC BY-SA 4.0'}}
    : {Artist: {value: '<a href="x"><b>Mario Rossi</b></a><script>1</script>'}, LicenseShortName: {value: 'CC BY-SA 4.0'}};
  return json({query: {pages: {1: {imageinfo: [{extmetadata: em}]}}}});
});
const errori = [];
page.on('pageerror', e => errori.push(String(e)));
await page.goto(`file://${file}`);
await page.waitForSelector('table.numeri');
await page.waitForTimeout(1500);
const figure = await page.$$eval('figure.foto', fs => fs.map(f => ({
  luogo: f.closest('tr').cells[0].textContent.trim(), cap: f.querySelector('figcaption').textContent})));
check(figure.length === 1 && figure[0].luogo.startsWith('Con attribuzione'), `una sola foto, quella con attribuzione (${JSON.stringify(figure.map(f => f.luogo))})`);
check(figure[0]?.cap === 'Foto: Mario Rossi, CC BY-SA 4.0, da Wikipedia', `didascalia con autore e licenza, solo testo (${figure[0]?.cap})`);
check(await page.$$eval('#nota-foto', n => n.length) === 1, 'la riga sulle foto compare');
check(!richieste.some(r => r.includes('Senza identificatore')), 'nessuna richiesta per il luogo senza identificatore');
check(richieste.length > 0 && richieste.every(r => /^(it\.wikipedia\.org|commons\.wikimedia\.org|www\.wikidata\.org|upload\.wikimedia\.org) /.test(r)), 'solo Wikipedia, Commons, Wikidata e immagine');
check(!errori.length, `nessun errore di pagina ${errori.join(' | ')}`);
const righe = await page.$$eval('#scheda table', ts =>
  ts.find(t => t.querySelector('th')?.textContent.trim() === 'Luogo').querySelectorAll('tbody tr').length);
check(righe === 4, `tutti i luoghi restano in tabella anche senza foto (${righe})`);
await browser.close();
process.exit(failed);
