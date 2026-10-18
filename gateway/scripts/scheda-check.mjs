// La scheda stampabile si carica con un giro vero, mostra i numeri, disegna la mappa
// e il profilo, e il banner "dati cambiati" compare solo se lo stamp diverge.
// Uso, dalla cartella gateway: node scripts/scheda-check.mjs [base-url]
// La chiave dei link e' WM_LINK_KEY (ambiente o .env nella radice).
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {encodeLink, decodeLink} from '../src/mcp/link.js';
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

// diverso dall'indirizzo del gateway, come in produzione: sul foglio deve comparire il pubblico
const PUBBLICO = 'https://r.example';
const browser = await chromium.launch();
const fails = [];
const errors = [];

// Pixel del colore del tracciato nel canvas del profilo (vedi la nota piu' sotto sulla soglia).
// Serve sia sulla pagina viva sia sul documento da file://: li' il JavaScript e' appiattito dal bundler.
async function controllaProfilo(p, dove) {
  try {
    await p.waitForSelector('#profilo', {timeout: 5000});
    const rossi = await p.evaluate(() => {
      const cv = document.getElementById('profilo');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) n++;
      return {n, larghezza: cv.width};
    });
    const soglia = rossi.larghezza * 0.5;
    if (rossi.n < soglia) fails.push(`${dove}: nel profilo manca il tracciato (${rossi.n} pixel rossi, ne servono ${soglia})`);
  } catch { fails.push(`${dove}: manca il canvas del profilo`); }
}
// I numeri come li legge una persona, confrontati col JSON della scheda: un valore al posto di un altro
// (la salita sotto "Distanza") ha le etichette giuste e i numeri sbagliati.
async function controllaNumeri(p, dove, t) {
  const j = await fetch(`${base}/g/scheda.json?t=${t}`).then(r => r.json());
  const riga = await p.$$eval('table.numeri tr', trs => Object.fromEntries(trs.map(tr => [tr.cells[0].textContent.trim(), tr.cells[1].textContent.trim()])));
  const num = x => parseFloat(String(x).replace(/\./g, '').replace(',', '.'));
  const ore = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const attesi = {Distanza: j.distanzaKm, Salita: Math.round(j.salitaM), Discesa: Math.round(j.discesaM)};
  for (const [k, v] of Object.entries(attesi))
    if (!(Math.abs(num(riga[k]) - v) < 0.006)) fails.push(`${dove}: "${k}" mostra "${riga[k]}", il giro dice ${v}`);
  if (riga['Tempo di cammino'] !== ore(j.oreDIN33466)) fails.push(`${dove}: "Tempo di cammino" mostra "${riga['Tempo di cammino']}", il giro dice ${ore(j.oreDIN33466)}`);
  if (j.quotaMinMaxM) {
    const q = (riga['Quota minima e massima'] ?? '').split('–').map(num);
    if (q.length !== 2 || Math.abs(q[0] - Math.round(j.quotaMinMaxM[0])) > 0.6 || Math.abs(q[1] - Math.round(j.quotaMinMaxM[1])) > 0.6)
      fails.push(`${dove}: "Quota minima e massima" mostra "${riga['Quota minima e massima']}"`);
  }
}
const AVVISO_BREVE = 'Scritto dall’assistente dell’utente, non da Webmapp: rileggilo prima di partire.';
// Un riquadro dell'assistente: esiste col suo titolo, col testo e, dove deve, con la riga che lo attribuisce.
async function controllaRiquadro(p, dove, selettore, titolo, testo, conAvviso) {
  const r = await p.$$eval(selettore, (els, t) => els.filter(e => e.querySelector('.etichetta strong')?.textContent.trim() === t)
    .map(e => ({testo: e.textContent, avviso: e.querySelector('.etichetta span')?.textContent ?? ''})), titolo);
  if (r.length !== 1) return fails.push(`${dove}: il riquadro "${titolo}" compare ${r.length} volte, ne serve una`);
  if (!r[0].testo.includes(testo)) fails.push(`${dove}: il riquadro "${titolo}" non contiene il testo dell'assistente`);
  if (conAvviso && !r[0].avviso.includes(AVVISO_BREVE)) fails.push(`${dove}: il riquadro "${titolo}" non porta la riga "Scritto dall'assistente dell'utente, non da Webmapp"`);
  if (!conAvviso && r[0].avviso) fails.push(`${dove}: il riquadro "${titolo}" ha una riga di attribuzione che non deve avere`);
}
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
await controllaProfilo(page, 'pagina viva');
await controllaNumeri(page, 'pagina viva', encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key)));

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

// un giro con una ventina di note: il blob e' lungo, il QR non si disegna e l'indirizzo resta per esteso
{
  const lungo = {...giro, stamp: stampCorrente,
    poi: Array.from({length: 20}, (_, i) => ({osmId: 1000 + i, nota: 'n'.repeat(80)}))};
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${base}/g/scheda?t=${encodeURIComponent(encodeLink(lungo, key))}`);
  await p.waitForSelector('.gpx .indirizzo', {timeout: 30000});
  if (await p.$('svg.qr')) fails.push('con venti punti il QR risulta disegnato: sarebbe illeggibile');
  if ((await p.textContent('.gpx .indirizzo')).trim().length < 2000) fails.push('con venti punti l\'indirizzo non e\' scritto per esteso');
  await p.close();
}

// il documento da file://, senza rete: il QR non si disegna, l'indirizzo resta, nessun errore
{
  const t = encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key));
  const doc = await makeDocumentoTool({gatewayUrl: base, publicUrl: PUBBLICO, linkKey: key,
    waysDbPath: process.env.WM_WAYS_DB ?? new URL('../../data/ways.sqlite', import.meta.url).pathname})({t,
    introduzione: 'Vedi [il parco](https://www.parcosanrossore.it/) e [https://example.org/x](https://example.org/x).',
    luoghi: [{osmId: 1733141336, testo: 'Vedi [Wikipedia](https://it.wikipedia.org/wiki/Monte_Serra).'}],
    consigli: 'CONSIGLIO-DI-PROVA: porta **acqua**.',
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
    // il racconto, riquadro per riquadro: titolo, testo e riga che lo attribuisce all'assistente
    await controllaProfilo(p, 'documento da file');
    await controllaNumeri(p, 'documento da file', t);
    await controllaRiquadro(p, 'documento da file', '.racconto', 'Presentazione dell’assistente', 'Vedi il parco', true);
    await controllaRiquadro(p, 'documento da file', '.racconto', 'Consigli dell’assistente', 'CONSIGLIO-DI-PROVA: porta acqua', true);
    await controllaRiquadro(p, 'documento da file', '.racconto-luogo', 'L’assistente racconta', 'Vedi Wikipedia', false);
    await controllaRiquadro(p, 'documento da file', '.racconto', 'Fonti citate dall’assistente', 'https://it.wikipedia.org/wiki/Monte_Serra', false);
    if (!(await p.textContent('#scheda')).includes('Distanze, dislivelli, tempi e percorso, fuori da questi riquadri, sono calcolati da Webmapp'))
      fails.push('documento da file: manca la frase che dice cosa garantisce Webmapp');
    if (await p.$('.avviso-racconto')) fails.push('documento da file: con la presentazione l\'avviso dei luoghi non va ripetuto');
    const ind = (await p.textContent('.gpx .indirizzo').catch(() => '')).trim();
    if (!ind.startsWith(`${PUBBLICO}/g/gpx?t=`)) fails.push(`senza rete l'indirizzo del GPX non resta, o non e' quello pubblico (${ind.slice(0, 40)})`);
    if (ind.includes('127.0.0.1')) fails.push('sul foglio compare l\'indirizzo locale');
    // il GPX che si scarica da quell'indirizzo e' il giro: confrontato con /v1 vivo, non con
    // valori scritti qui. L'indirizzo e' quello pubblico (inesistente da qui), si scarica dal gateway.
    try {
      const u = new URL(ind);
      const gpxDoc = await fetch(`${base}${u.pathname}${u.search}`).then(r => r.text());
      // il blob arrotonda i punti a 5 decimali: il giro e' quello che il blob firmato porta davvero
      const blob = decodeLink(decodeURIComponent(t), key);   // il blob del giro, non quello del link nel documento
      const v1 = await fetch(`${base}/v1/mcp/route`, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({profile: blob.profile, points: blob.points})}).then(r => r.json());
      const punti = [...gpxDoc.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"><ele>([^<]*)<\/ele>/g)].map(m => [+m[2], +m[1], +m[3]]);
      const attesi = v1.geometry.coordinates;
      if (punti.length !== attesi.length) fails.push(`il GPX del documento ha ${punti.length} punti, /v1 ne da' ${attesi.length}`);
      else if (punti.some((q, i) => q[0] !== attesi[i][0] || q[1] !== attesi[i][1] || q[2] !== (attesi[i][2] ?? 0)))
        fails.push('il GPX del documento ha punti diversi da quelli di /v1');
      const nomiTabella = await p.$$eval('td[data-poi] strong', e => e.map(x => x.textContent));
      const nomiGpx = [...gpxDoc.matchAll(/<wpt [^>]*>(?:<ele>[^<]*<\/ele>)?<name>([^<]*)<\/name>/g)]
        .map(m => m[1].replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({lt: '<', gt: '>', amp: '&', apos: "'", quot: '"'}[e])));
      if (!nomiTabella.length || nomiTabella.some(n => !nomiGpx.includes(n))) fails.push('nel GPX del documento mancano luoghi che il documento elenca');
      // coordinata e quota dei luoghi: quelle del database (via /g/scheda.json), mai quelle scritte dal modello
      const schedaJ = await fetch(`${base}/g/scheda.json?t=${encodeURIComponent(decodeURIComponent(t))}`).then(r => r.json());
      for (const poi of schedaJ.poi) {
        const w = [...gpxDoc.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)">(?:<ele>([^<]*)<\/ele>)?<name>([^<]*)<\/name>/g)]
          .find(m => m[4].replace(/&apos;/g, "'") === poi.name);
        if (!w) { fails.push(`nel GPX manca il <wpt> di ${poi.name}`); continue; }
        if (+w[1] !== poi.lonLat[1] || +w[2] !== poi.lonLat[0]) fails.push(`nel GPX il <wpt> di ${poi.name} e' in un altro punto`);
        if ((poi.ele == null) !== (w[3] === undefined) || (poi.ele != null && +w[3] !== poi.ele)) fails.push(`nel GPX il <wpt> di ${poi.name} ha un'altra quota`);
      }
    } catch (e) { fails.push(`GPX del documento non confrontabile: ${e.message}`); }
    if (!(await p.textContent('.fonti-nostre')).includes('dati del')) fails.push('nelle fonti nostre manca la data dei dati');
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

// Il documento senza racconto e' la scheda di oggi: stesso blob, nessun campo dell'assistente, e la
// pagina che si apre dal link (/g/scheda) e il file da file:// hanno lo stesso DOM (mappa e foto a
// parte: sono disegnate dalla rete, non dal documento). Con la rete, perche' la scheda del link ha il QR.
const tOpts = {gatewayUrl: base, linkKey: key,
  waysDbPath: process.env.WM_WAYS_DB ?? new URL('../../data/ways.sqlite', import.meta.url).pathname};
const istantanea = p => p.evaluate(() => {
  const c = document.getElementById('scheda').cloneNode(true);
  c.querySelector('#mappa')?.replaceChildren();
  const pr = c.querySelector('#profilo');
  if (pr) ['style', 'width', 'height'].forEach(a => pr.removeAttribute(a));
  c.querySelectorAll('figure').forEach(f => f.remove());
  return {html: c.innerHTML, titolo: document.title};
});
{
  const live = await apri(stampCorrente);
  const gpxLive = await live.$eval('.gpx .indirizzo', e => e.textContent);
  const t = encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key));
  const doc = await makeDocumentoTool({...tOpts, publicUrl: new URL(gpxLive).origin})({t});
  if (doc.stato) fails.push(`documento senza racconto: ${doc.stato}`);
  else {
    const file = join(mkdtempSync(join(tmpdir(), 'wm-scheda-')), 'nudo.html');
    writeFileSync(file, doc.documento);
    const p = await browser.newPage({viewport: {width: Number(process.env.SCHEDA_LARGHEZZA ?? 900), height: 1200}});
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`file://${file}`);
    await p.waitForSelector('table.numeri', {timeout: 30000});
    await p.waitForSelector('.gpx .indirizzo', {timeout: 30000});
    const [a, b] = [await istantanea(live), await istantanea(p)];
    if (a.html !== b.html) {
      const i = [...a.html].findIndex((c, k) => c !== b.html[k]);
      fails.push(`senza racconto il documento non e' la scheda di oggi (primo scarto a ${i}: "${a.html.slice(i - 30, i + 50)}" contro "${b.html.slice(i - 30, i + 50)}")`);
    }
    if (a.titolo !== b.titolo) fails.push('senza racconto il titolo del documento cambia');
    await controllaProfilo(p, 'documento senza racconto');
    await controllaNumeri(p, 'documento senza racconto', t);
    const sezioniRacconto = await p.$$eval('.racconto, .racconto-luogo, .avviso-racconto', e => e.length);
    if (sezioniRacconto) fails.push(`senza racconto compaiono ${sezioniRacconto} riquadri dell'assistente`);
    await p.close();
  }
  await live.close();
}

// Senza presentazione ma con il racconto di un luogo, l'attribuzione all'assistente la porta l'avviso sopra la
// tabella dei luoghi: e' la riga che distingue il racconto dai fatti, e deve esserci.
{
  const t = encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key));
  const doc = await makeDocumentoTool({...tOpts, publicUrl: PUBBLICO})({t,
    luoghi: [{osmId: 1733141336, testo: 'SOLO-IL-LUOGO'}]});
  const file = join(mkdtempSync(join(tmpdir(), 'wm-scheda-')), 'luogo.html');
  writeFileSync(file, doc.documento ?? '');
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.goto(`file://${file}`);
  await p.waitForSelector('table.numeri', {timeout: 30000});
  const av = await p.$$eval('.avviso-racconto', e => e.map(x => x.textContent));
  if (av.length !== 1 || !av[0].includes(AVVISO_BREVE) || !av[0].includes('Distanze, dislivelli, tempi e percorso'))
    fails.push('senza presentazione, sopra i luoghi manca l\'avviso che attribuisce il racconto all\'assistente');
  await controllaRiquadro(p, 'documento col solo luogo', '.racconto-luogo', 'L’assistente racconta', 'SOLO-IL-LUOGO', false);
  await p.close();
}

// Un testo ostile, nel documento prodotto dal tool e aperto da file://, non diventa eseguibile: nessuno
// script gira, nessun gestore di eventi, nessun link che non sia http(s), nessuna richiesta all'host
// del testo; il documento resta quello del giro e il testo si legge come testo.
{
  const OSTILE = '</script><script>window.__pwn=1</script> <img src="http://evil.invalid/a.png" onerror="window.__pwn=2"> ' +
    '<svg onload="window.__pwn=3"> [clic](javascript:window.__pwn=4) ![i](http://evil.invalid/i.png) ' +
    '<a href="javascript:window.__pwn=5">x</a> <iframe src="http://evil.invalid/f"></iframe> $& $` $\' PAROLA-VISIBILE';
  const t = encodeURIComponent(encodeLink({...giro, stamp: stampCorrente}, key));
  const doc = await makeDocumentoTool({...tOpts, publicUrl: PUBBLICO})({t, introduzione: OSTILE, consigli: OSTILE,
    luoghi: [{osmId: 1733141336, testo: OSTILE}, {osmId: 1304081118, testo: OSTILE}],
    fonti: [{titolo: OSTILE, url: 'https://example.org/'}, {titolo: 'x', url: 'javascript:window.__pwn=6'}]});
  if (doc.stato) fails.push(`documento ostile: ${doc.stato}`);
  else {
    const file = join(mkdtempSync(join(tmpdir(), 'wm-scheda-')), 'ostile.html');
    writeFileSync(file, doc.documento);
    const p = await browser.newPage();
    const eventi = [];
    p.on('pageerror', e => errors.push(String(e)));
    p.on('dialog', d => { eventi.push(`dialog: ${d.message()}`); d.dismiss(); });
    p.on('request', r => { if (/evil\.invalid/.test(r.url())) eventi.push(`richiesta a ${r.url()}`); });
    await p.route(/^https?:\/\//, r => r.abort());
    await p.goto(`file://${file}`);
    await p.waitForSelector('table.numeri', {timeout: 30000});
    await p.waitForTimeout(500);
    if (!(await p.textContent('#scheda')).includes('PAROLA-VISIBILE')) fails.push('il documento ostile non mostra il testo come testo');
    // ogni riquadro dell'assistente c'e' e porta il testo ostile come testo: titolo, parola e attribuzione
    await controllaRiquadro(p, 'documento ostile', '.racconto', 'Presentazione dell’assistente', 'PAROLA-VISIBILE', true);
    await controllaRiquadro(p, 'documento ostile', '.racconto', 'Consigli dell’assistente', 'PAROLA-VISIBILE', true);
    const luoghiOstili = await p.$$eval('.racconto-luogo', e => e.filter(x => x.textContent.includes('PAROLA-VISIBILE')).length);
    if (luoghiOstili !== 2) fails.push(`documento ostile: ${luoghiOstili} riquadri dei luoghi con il testo, ne servono 2`);
    const pwn = await p.evaluate(() => window.__pwn);
    if (pwn !== undefined) fails.push(`un testo ostile ha eseguito codice (__pwn=${pwn})`);
    const dentro = await p.evaluate(() => {
      const s = document.getElementById('scheda');
      const attivi = s.querySelectorAll('script, iframe, object, embed, style, link, form, svg:not(.qr), img, [srcdoc]').length;
      const gestori = [...s.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length;
      const link = [...s.querySelectorAll('[href]')].map(a => a.getAttribute('href')).filter(h => !/^https?:\/\//i.test(h));
      return {attivi, gestori, link, scripts: document.querySelectorAll('script').length};
    });
    if (dentro.attivi) fails.push(`nel documento ostile compaiono ${dentro.attivi} elementi attivi`);
    if (dentro.gestori) fails.push(`nel documento ostile compaiono ${dentro.gestori} gestori di eventi`);
    if (dentro.link.length) fails.push(`nel documento ostile un link non e' http(s): ${dentro.link.join(', ')}`);
    const scriptNostri = (readFileSync(new URL('../../preview/scheda.html', import.meta.url), 'utf8').match(/<script/g) ?? []).length;
    if (dentro.scripts !== scriptNostri) fails.push(`il documento ostile ha ${dentro.scripts} blocchi script, ne servono ${scriptNostri} (quelli dello scheletro)`);
    if (eventi.length) fails.push(`il documento ostile ha provocato: ${eventi.join('; ')}`);
    await p.close();
  }
}

// Su un giro NON ad anello partenza e arrivo sono due punti diversi, e la mappa li disegna dove sono, con i due
// stili della didascalia (cerchio piccolo verde alla partenza, grande rosso all'arrivo). Questo prova la
// posizione e lo stile nella mappa; che si distinguano su un foglio stampato lo giudica una persona (checklist).
{
  const lineare = {profile: 'libero', points: [[10.4420, 43.7625], [10.5503, 43.7521]], stamp: stampCorrente, poi: []};
  const t = encodeURIComponent(encodeLink(lineare, key));
  const p = await browser.newPage({viewport: {width: 900, height: 1200}});
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${base}/g/scheda?t=${t}`);
  await p.waitForSelector('table.numeri', {timeout: 30000});
  // salita e discesa di un anello coincidono: lo scambio fra le due righe si vede solo su un giro lineare
  await controllaNumeri(p, 'giro lineare, pagina viva', t);
  {
    const d = await makeDocumentoTool({...tOpts, publicUrl: PUBBLICO})({t: decodeURIComponent(t)});
    const f = join(mkdtempSync(join(tmpdir(), 'wm-scheda-')), 'lineare.html');
    writeFileSync(f, d.documento ?? '');
    const q = await browser.newPage({viewport: {width: 900, height: 1200}});
    q.on('pageerror', e => errors.push(String(e)));
    await q.route(/^https?:\/\//, r => r.abort());
    await q.goto(`file://${f}`);
    await q.waitForSelector('table.numeri', {timeout: 30000});
    await controllaNumeri(q, 'giro lineare, documento da file', t);
    await controllaProfilo(q, 'giro lineare, documento da file');
    await q.close();
  }
  try {
    await p.waitForFunction(() => window.__schedaMappa?.getLayers().getArray().some(l => l.get('giro') && l.getSource().getFeatures().length),
      null, {timeout: 30000});
    const marcatori = await p.evaluate(() => {
      const l = window.__schedaMappa.getLayers().getArray().find(x => x.get('giro'));
      return l.getSource().getFeatures().filter(f => f.getGeometry().getType() === 'Point').map(f => {
        const st = f.getStyle(), im = st.getImage();
        return {colore: im.getFill().getColor(), raggio: im.getRadius(), lonLat: ol.proj.toLonLat(f.getGeometry().getCoordinates())};
      });
    });
    const geo = (await fetch(`${base}/g/scheda.json?t=${t}`).then(r => r.json())).geometry.coordinates;
    const vicino = (a, b) => Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
    const partenza = marcatori.find(m => m.colore === '#1b8a3a'), arrivo = marcatori.find(m => m.colore === '#d0021b');
    if (!partenza || !arrivo) fails.push('giro lineare: manca il marcatore di partenza o quello di arrivo');
    else {
      if (!vicino(partenza.lonLat, geo[0])) fails.push('giro lineare: il marcatore verde non e\' sulla partenza');
      if (!vicino(arrivo.lonLat, geo.at(-1))) fails.push('giro lineare: il marcatore rosso non e\' sull\'arrivo');
      if (vicino(partenza.lonLat, arrivo.lonLat)) fails.push('giro lineare: partenza e arrivo risultano nello stesso punto');
      if (!(arrivo.raggio > partenza.raggio)) fails.push('giro lineare: l\'arrivo non e\' piu\' grande della partenza');
    }
  } catch (e) { fails.push(`giro lineare: la mappa non mostra i marcatori (${e.message.split('\n')[0]})`); }
  await p.close();
}

const page2 = await apri('1970-01-01T00:00:00Z');
if (!(await page2.textContent('#scheda')).includes('I dati sono cambiati da quando questo giro è stato progettato'))
  fails.push('banner assente con stamp diverso');
await page2.close();
await browser.close();

if (errors.length) fails.push(`errori nella pagina: ${errors.join('; ')}`);
if (fails.length) { console.error('!! scheda:', fails); process.exit(1); }
console.log('ok: scheda con numeri, mappa, profilo e banner a posto');
