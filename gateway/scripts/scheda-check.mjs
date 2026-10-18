// La scheda stampabile si carica con un giro vero, mostra i numeri, disegna la mappa
// e il profilo, e il banner "dati cambiati" compare solo se lo stamp diverge.
// Uso, dalla cartella gateway: node scripts/scheda-check.mjs [base-url]
// La chiave dei link e' WM_LINK_KEY (ambiente o .env nella radice).
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {encodeLink} from '../src/mcp/link.js';

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
await page.close();

const page2 = await apri('1970-01-01T00:00:00Z');
if (!(await page2.textContent('#scheda')).includes('I dati sono cambiati da quando questo giro è stato progettato'))
  fails.push('banner assente con stamp diverso');
await page2.close();
await browser.close();

if (errors.length) fails.push(`errori nella pagina: ${errors.join('; ')}`);
if (fails.length) { console.error('!! scheda:', fails); process.exit(1); }
console.log('ok: scheda con numeri, mappa, profilo e banner a posto');
