// La scheda stampabile si carica con un giro vero, mostra i numeri, disegna la mappa
// e il profilo, e il banner "dati cambiati" compare solo se lo stamp diverge.
// Uso, dalla cartella gateway: node scripts/scheda-check.mjs [base-url]
// La chiave dei link e' WM_LINK_KEY (ambiente o .env nella radice).
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {encodeLink} from '../src/mcp/link.js';
import {makeDocumentoTool} from '../src/mcp/documento.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8991';
const key = process.env.WM_LINK_KEY
  ?? readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^WM_LINK_KEY=(.*)$/m)?.[1];
if (!key) { console.error('!! manca WM_LINK_KEY'); process.exit(1); }

const {osm: stampCorrente} = await (await fetch(`${base}/v1/version`)).json();
const giro = {
  profile: 'escursionista',
  points: [[10.5208, 43.7246], [10.533904, 43.707151], [10.5547387, 43.7441146], [10.5383325, 43.7204375], [10.5208, 43.7246]],
  poi: [{osmId: 1733141336, nota: 'la vetta, vista sulle due piane'}, {osmId: 1304081118, nota: 'ultimo rifornimento prima della salita'}],
};
const url = stamp => `${base}/g/scheda?t=${encodeURIComponent(encodeLink({...giro, stamp}, key))}`;

const browser = await chromium.launch();
const fails = [];
const errors = [];
async function apri(stamp) {
  const page = await browser.newPage({viewport: {width: Number(process.env.SCHEDA_LARGHEZZA ?? 900), height: 1200}});
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url(stamp));
  await page.waitForSelector('table.numeri', {timeout: 30000});
  return page;
}

const page = await apri(stampCorrente);
const testo = await page.textContent('#scheda');
for (const atteso of ['Distanza', 'Salita', 'Discesa', 'Tempo di cammino', 'km', 'Monte Serra']) {
  if (!testo.includes(atteso)) fails.push(`manca "${atteso}" nella scheda`);
}
// la nota e' l'unico testo dell'assistente: colonna e piè di pagina lo dicono
if (!(await page.$$eval('#scheda th', ths => ths.some(th => th.textContent.trim() === 'Nota dell’assistente'))))
  fails.push('intestazione "Nota dell’assistente" assente');
if (!testo.includes('Le note sono scritte dall’assistente, non da Webmapp.')) fails.push('manca la riga che attribuisce le note all\'assistente');
if (testo.includes('dati sono cambiati')) fails.push('banner presente senza divergenza di stamp');

// sentieri: nessuna coppia numero + difficolta' in due righe (righe uguali per chi legge sono rumore;
// lo stesso numero con difficolta' diverse e' invece legittimo)
const coppie = await page.$$eval('#sentieri tbody tr', trs =>
  trs.map(tr => [...tr.cells].slice(0, 2).map(td => td.textContent.trim()).join(' · ')));
const doppi = coppie.filter((n, i) => coppie.indexOf(n) !== i);
if (!coppie.length) fails.push('tabella sentieri assente');
if (doppi.length) fails.push(`sentieri in piu' righe: ${[...new Set(doppi)].join(', ')}`);
if (coppie.some(c => c.startsWith('(senza ref)'))) fails.push('"(senza ref)" visibile all\'utente');

// mappa: OpenLayers con almeno un livello e il giro disegnato
try {
  await page.waitForFunction(() => window.__schedaMappa?.getLayers().getLength() > 0 &&
    window.__schedaMappa.getLayers().getArray().some(l => l.get('giro') && l.getSource().getFeatures().length),
  null, {timeout: 30000});
} catch { fails.push('la mappa non mostra il giro'); }
if (!await page.$('#mappa .ol-viewport canvas')) fails.push('manca il canvas della mappa');

// profilo: griglia ed etichette riempiono gia' molti pixel, quindi si contano quelli del
// colore del tracciato (rosso: R alta, G e B basse). Misurati sul giro di prova: circa 1060
// pixel su un canvas da 704 px (la linea e' sottile: poco piu' di 1,5 pixel per colonna),
// 893 a 600 px di pagina, 646 a 375 px. Con la linea assente sono 0. La soglia e' quindi
// proporzionale alla larghezza del canvas (meta' dei pixel di larghezza), non assoluta.
try {
  await page.waitForSelector('#profilo', {timeout: 5000});
  const rossi = await page.evaluate(() => {
    const cv = document.getElementById('profilo');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) n++;
    return {n, larghezza: cv.width};
  });
  const soglia = rossi.larghezza * 0.5;
  if (rossi.n < soglia) fails.push(`nel profilo manca il tracciato (${rossi.n} pixel rossi, ne servono ${soglia})`);
} catch { fails.push('manca il canvas del profilo'); }

// GPX, QR e fonti: indirizzo per esteso, QR per un giro con pochi luoghi, avvertenza, due parti di fonti
const gpx = await page.$eval('.gpx .indirizzo', e => e.textContent).catch(() => null);
if (!gpx || !/\/g\/gpx\?t=/.test(gpx)) fails.push('manca l\'indirizzo del GPX scritto per esteso');
else if ((await fetch(gpx).then(r => r.status).catch(() => 0)) !== 200) fails.push('l\'indirizzo del GPX scritto nella scheda non scarica');
if (!await page.$('.gpx svg.qr')) fails.push('il QR non e\' disegnato per un giro con due luoghi');
if (!(await page.textContent('.gpx')).includes('potrebbe non coincidere')) fails.push('manca l\'avvertenza sul GPX');
const fontiTesto = await page.textContent('.fonti-sezione').catch(() => '');
for (const atteso of ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', 'DIN 33466'])
  if (!fontiTesto.includes(atteso)) fails.push(`nelle fonti nostre manca "${atteso}"`);
await page.close();

// il documento da file://, senza rete: il QR non si disegna, l'indirizzo resta, nessun errore
{
  const t = encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key));
  const doc = await makeDocumentoTool({gatewayUrl: base, publicUrl: base, linkKey: key,
    waysDbPath: process.env.WM_WAYS_DB ?? new URL('../../data/ways.sqlite', import.meta.url).pathname})({t,
    introduzione: 'Vedi [il parco](https://www.parcosanrossore.it/) e [https://example.org/x](https://example.org/x).',
    luoghi: [{osmId: 1733141336, testo: 'Vedi [Wikipedia](https://it.wikipedia.org/wiki/Monte_Serra).'}],
    fonti: [{titolo: 'Wikipedia', url: 'https://it.wikipedia.org/wiki/Monte_Serra'}]});
  if (doc.stato) fails.push(`documento_giro: ${doc.stato}`);
  else {
    const file = join(mkdtempSync(join(tmpdir(), 'wm-scheda-')), 'giro.html');
    writeFileSync(file, doc.documento);
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(String(e)));
    await p.route(/^https?:\/\//, r => r.abort());
    await p.goto(`file://${file}`);
    await p.waitForSelector('table.numeri', {timeout: 30000});
    if (await p.$('svg.qr')) fails.push('senza rete il QR risulta disegnato');
    if (!(await p.textContent('.gpx .indirizzo').catch(() => '')).includes('/g/gpx?t=')) fails.push('senza rete l\'indirizzo del GPX non resta');
    // in stampa: l'indirizzo accanto all'etichetta, nessuna sottolineatura; non raddoppia se l'etichetta e' l'indirizzo
    await p.emulateMedia({media: 'print'});
    const link = await p.$$eval('.racconto .corpo a, .racconto-luogo a', as => as.map(a => ({
      testo: a.textContent, dopo: getComputedStyle(a, '::after').content, sott: getComputedStyle(a).textDecorationLine})));
    const parco = link.find(l => l.testo === 'il parco');
    if (!parco || !parco.dopo.includes('https://www.parcosanrossore.it/')) fails.push('in stampa il link non mostra l\'indirizzo');
    if (!link.some(l => l.testo === 'Wikipedia' && l.dopo.includes('it.wikipedia.org'))) fails.push('in stampa il link dentro il luogo non mostra l\'indirizzo');
    if (link.some(l => l.sott !== 'none')) fails.push('in stampa un link resta sottolineato');
    if (link.find(l => l.testo.startsWith('https://example.org'))?.dopo !== 'none' ) fails.push('in stampa l\'indirizzo si ripete dopo un\'etichetta che e\' gia\' l\'indirizzo');
    const fa = await p.$$eval('.fonti-sezione .racconto .fonti li', l => l.map(x => x.textContent));
    if (!fa.some(x => x.includes('Wikipedia') && x.includes('https://it.wikipedia.org/wiki/Monte_Serra'))) fails.push('fonte dell\'assistente senza titolo e indirizzo');
    await p.close();
  }
}

const page2 = await apri('1970-01-01T00:00:00Z');
if (!(await page2.textContent('#scheda')).includes('I dati sono cambiati da quando questo giro è stato progettato'))
  fails.push('banner assente con stamp diverso');
await page2.close();
await browser.close();

if (errors.length) fails.push(`errori nella pagina: ${errors.join('; ')}`);
if (fails.length) { console.error('!! scheda:', fails); process.exit(1); }
console.log('ok: scheda con numeri, mappa, profilo e banner a posto');
