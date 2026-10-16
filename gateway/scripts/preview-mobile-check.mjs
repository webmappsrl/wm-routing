// La preview su un telefono: mappa a tutto schermo, pannello che sale dal basso
// con le schede, riepilogo sempre visibile, dettagli di un tratto al tocco.
// Uso, dalla cartella gateway: node scripts/preview-mobile-check.mjs [base] [dispositivo Playwright]
import {chromium, devices} from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8991/preview/';
const device = process.argv[3] ?? 'iPhone 13';
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({...devices[device]});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(base + '?p=10.5205,43.7244;10.5555,43.7505&motore=entrambi&c=10.45,43.60&z=12');
await page.waitForFunction(() => window.__wm?.state?.results?.nuovo && window.__wm.state.results.produzione,
  null, {timeout: 30000}).catch(() => fails.push('i due tracciati non arrivano'));
await page.waitForTimeout(800);
const vh = await page.evaluate(() => innerHeight);
const box = sel => page.locator(sel).boundingBox();
const panelH = async () => (await box('#panel'))?.height ?? 0;

check(((await box('#map'))?.height ?? 0) >= vh * 0.95, 'la mappa occupa tutto lo schermo');
check(await panelH() <= vh * 0.25, 'all\'apertura il pannello e\' chiuso (riga di riepilogo)');
const mini = await page.textContent('#mini').catch(() => '');
check(/km/.test(mini ?? '') && /\+\d+ m/.test(mini ?? ''), 'il riepilogo chiuso mostra km e salita');
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nessuno scorrimento orizzontale');
const tabsOk = await page.evaluate(() => [...document.querySelectorAll('#tabs button')].every(b => {
  const r = b.getBoundingClientRect();
  return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.scrollWidth <= b.clientWidth + 1;
}));
check(tabsOk, 'pannello chiuso: le schede si vedono intere');

// il percorso e' inquadrato sopra il pannello
const inView = await page.evaluate(() => {
  const {map, state} = window.__wm;
  const top = innerHeight - document.querySelector('#panel').offsetHeight;
  return state.points.every(p => {
    const px = map.getPixelFromCoordinate(ol.proj.fromLonLat(p));
    return px[0] >= 0 && px[0] <= innerWidth && px[1] >= 0 && px[1] <= top;
  });
});
check(inView, 'il percorso e\' inquadrato nella parte di mappa visibile');

// le schede
for (const tab of ['Percorso', 'Punti', 'Opzioni', 'Legenda', 'Rientro'])
  check(await page.locator('#tabs button', {hasText: tab}).isVisible().catch(() => false), `scheda ${tab}`);
await page.locator('#tabs button', {hasText: 'Percorso'}).tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#tabs button'));
const opened = await page.waitForFunction(h => document.querySelector('#panel').offsetHeight >= h, vh * 0.4,
  {timeout: 5000}).then(() => true, () => false);
check(opened, 'toccando una scheda il pannello si apre');
check(await page.locator('#results .card').first().isVisible().catch(() => false), 'scheda Percorso: risultati visibili');
check(!(await page.locator('#points').isVisible()), 'scheda Percorso: i punti stanno nella loro scheda');
check(((await box('#profile'))?.width ?? 0) > 200, 'profilo altimetrico disegnato a tutta larghezza');
await page.locator('#tabs button', {hasText: 'Punti'}).tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#tabs button'));
check(await page.locator('#points li').count() === 2, 'scheda Punti: 2 punti');
const fontSize = await page.$eval('#newProfile', el => parseFloat(getComputedStyle(el).fontSize));
check(fontSize >= 16, 'campi a 16 px: iOS non ingrandisce la pagina');

// la maniglia richiude il pannello
await page.locator('#sheet-handle').tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#sheet-handle'));
await page.waitForTimeout(400);
const afterHandle = await panelH();
await page.locator('#sheet-handle').tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#sheet-handle'));
await page.waitForTimeout(400);
check(Math.min(afterHandle, await panelH()) <= vh * 0.25, 'la maniglia porta il pannello fino a chiuso');
for (let i = 0; i < 3 && await panelH() > vh * 0.25; i++) {
  await page.locator('#sheet-handle').tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#sheet-handle')); await page.waitForTimeout(400);
}

// tocco su un tratto: dettagli, nessun punto aggiunto
const seg = await page.evaluate(() => {
  const {map, state} = window.__wm;
  const c = state.results.nuovo.geometry.coordinates;
  return map.getPixelFromCoordinate(ol.proj.fromLonLat(c[Math.floor(c.length / 2)].slice(0, 2)));
});
await page.touchscreen.tap(seg[0], seg[1]);
await page.waitForTimeout(500);
const tip = await page.textContent('#tooltip').catch(() => '');
check(await page.locator('#tooltip').isVisible() && /Difficolt/.test(tip ?? ''), 'tocco su un tratto: dettagli visibili');
check(await page.evaluate(() => window.__wm.state.points.length) === 2, 'tocco su un tratto: nessun punto aggiunto');
const add = page.locator('#tooltip button', {hasText: 'Aggiungi'});
check(await add.isVisible().catch(() => false), 'dettagli del tratto: pulsante per aggiungere un punto li\'');
if (await add.isVisible().catch(() => false)) {
  await add.tap();
  await page.waitForFunction(() => window.__wm.state.points.length === 3, null, {timeout: 5000})
    .catch(() => fails.push('il pulsante non aggiunge il punto'));
}

// tocco lontano dal percorso: nuovo punto
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
const n0 = await page.evaluate(() => window.__wm.state.points.length);
await page.touchscreen.tap(60, 160);
const added = await page.waitForFunction(n => window.__wm.state.points.length === n + 1, n0, {timeout: 5000})
  .then(() => true, () => false);
check(added, 'tocco sulla mappa: aggiunge un punto');

// rientro: si attiva dalla sua scheda, il pannello si chiude, il tocco e' la persona
// "Togli l'ultimo" riporta il giro ai due punti di partenza (il rientro su tracce lunghe e' lento)
await page.locator('#tabs button', {hasText: 'Punti'}).tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#tabs button'));
for (let n = await page.evaluate(() => window.__wm.state.points.length); n > 2; n--)
  await page.locator('#undo').tap({timeout: 10000}).catch(() => fails.push('pulsante "Togli l\'ultimo"'));
check(await page.evaluate(() => window.__wm.state.points.length) === 2, '"Togli l\'ultimo" toglie i punti');
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
await page.locator('#tabs button', {hasText: 'Rientro'}).tap({timeout: 10000}).catch(() => fails.push('tocco non riuscito: ' + '#tabs button'));
await page.locator('#rejoinMode').tap({timeout: 10000}).catch(() => fails.push('pulsante della simulazione'));
await page.waitForTimeout(400);
check(await panelH() <= vh * 0.25, 'rientro: il pannello si chiude per lasciare la mappa');
check(/Simulazione/.test(await page.textContent('#mini') ?? ''), 'rientro: il riepilogo dice cosa fare');
// la persona a 40 px dalla traccia, in un punto della mappa non coperto dal pannello
const person = await page.evaluate(() => {
  const {map, state} = window.__wm;
  const bottom = innerHeight - document.querySelector('#panel').offsetHeight - 30;
  for (const c of state.results.nuovo.geometry.coordinates) {
    const [x, y] = map.getPixelFromCoordinate(ol.proj.fromLonLat(c.slice(0, 2)));
    if (x > 30 && x < innerWidth - 90 && y > 140 && y < bottom) return [x + 40, y];
  }
  return [innerWidth / 2, innerHeight / 3];
});
await page.touchscreen.tap(person[0], person[1]);
const waiting = await page.waitForFunction(() => /Calcolo del rientro|Rientro:/.test(document.querySelector('#mini').textContent
  + document.querySelector('#rejoin-result').textContent), null, {timeout: 3000}).then(() => true, () => false);
check(waiting, 'rientro: mentre calcola la pagina lo dice');
const shown = await page.waitForFunction(() => document.querySelector('#rejoin-result')?.textContent.trim()
  && document.querySelector('#rejoin-result').offsetParent, null, {timeout: 20000}).then(() => true, () => false);
check(shown, 'rientro: il risultato compare nella sua scheda');

check(!errors.length, `errori JavaScript: ${errors.join('; ')}`);
await browser.close();
if (fails.length) { console.error('!! ' + fails.join('\n!! ')); process.exit(1); }
console.log(`ok: preview su telefono (${device})`);
