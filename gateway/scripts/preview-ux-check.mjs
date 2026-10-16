// Controllo della preview dal punto di vista di chi la usa: legende, punti
// numerati, risultati spiegati, errori in italiano, area dei dati.
// Uso, dalla cartella gateway: node scripts/preview-ux-check.mjs [base]
import {chromium} from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8991/preview/';
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const txt = sel => page.locator(sel).first().textContent({timeout: 2000}).catch(() => null);
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1300, height: 850}});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(base + '?p=10.5205,43.7244;10.5555,43.7505&motore=entrambi&c=10.538,43.738&z=14');
await page.waitForFunction(() => window.__wm?.state?.results?.nuovo && window.__wm.state.results.produzione,
  null, {timeout: 30000}).catch(() => fails.push('i due tracciati non arrivano'));
check(await page.locator('#legend-lines li').count() >= 5, 'legenda delle linee: almeno 5 voci');
check(await page.locator('#legend-colors li').count() >= 5, 'legenda dei colori (difficolta\'): almeno 5 voci');
check(await page.locator('#points li').count() === 2, 'elenco dei punti: 2 voci numerate');
check((await txt('#profile-help'))?.includes('fino a E'), 'descrizione del profilo escursionista');
check((await txt('#engine-help'))?.length > 20, 'descrizione del motore');
const results = await txt('#results');
for (const w of ['Distanza', 'Salita', 'Tempo', 'segnati'])
  check(results?.includes(w), `scheda dei risultati: voce "${w}"`);
check(await page.evaluate(() => !!window.__wm.areaLayer), 'riquadro dell\'area coperta dai dati');
await page.selectOption('#colorBy', 'pendenza', {timeout: 2000}).catch(() => {});
check((await txt('#legend-colors'))?.includes('25%'), 'legenda della pendenza con le soglie');
check(await page.locator('#elevation-axis').count() === 1, 'profilo altimetrico con gli assi');

await page.selectOption('#colorBy', 'origine', {timeout: 2000}).catch(() => fails.push('colori per origine del dato'));
check((await txt('#legend-colors'))?.includes('cai_scale'), 'legenda dell\'origine con cai_scale');
check(await page.locator('#segments tbody tr').count() > 3, 'tabella dei tratti');
check((await txt('#segments'))?.includes('Origine'), 'tabella dei tratti: colonna origine');
check((await txt('#results'))?.includes('Per difficoltà'), 'riepilogo per difficoltà nella scheda');

// tratti calcolati con un altro profilo: il caso dei 12 punti, con escursionista
await page.goto(base + '?p=10.54415,43.73178;10.55618,43.74150;10.55765,43.74468;10.54626,43.75636;10.56031,43.75207;' +
  '10.57114,43.75648;10.56727,43.75833;10.56460,43.75702;10.57941,43.76067;10.58276,43.76008;10.58588,43.76046;' +
  '10.59110,43.75744&motore=nuovo&profilo=escursionista&c=10.556,43.756&z=14');
await page.waitForFunction(() => window.__wm?.state?.results?.nuovo, null, {timeout: 30000}).catch(() => fails.push('12 punti: nessun tracciato'));
check((await txt('#warning'))?.includes('esperto'), 'avviso sui tratti calcolati con un altro profilo');
check((await txt('#segments'))?.includes('esperto'), 'tabella dei tratti: profilo usato');

await page.goto(base + '?p=12.0,45.0;12.1,45.1&motore=nuovo&c=12,45&z=12');
await page.waitForFunction(() => document.querySelector('#err')?.textContent.trim(), null, {timeout: 15000}).catch(() => {});
check((await txt('#err'))?.includes('fuori dall\'area'), 'errore "fuori area" spiegato in italiano');

// punti di interesse delle tile: un clic sull'icona della cima la usa come tappa
await page.goto(base + '?c=10.5555,43.7505&z=15&motore=nuovo');
await page.waitForTimeout(7000);
const px = await page.evaluate(() => {
  const m = window.__wm.map;
  for (let dx = -300; dx <= 300; dx += 4) for (let dy = -250; dy <= 250; dy += 4) {
    const p = [m.getSize()[0] / 2 + dx, m.getSize()[1] / 2 + dy];
    let hit = false;
    m.forEachFeatureAtPixel(p, f => { if (f.get('name') === 'Monte Serra' && f.get('layer') === 'osmpoi') hit = true; });
    if (hit) return p;
  }
  return null;
});
check(!!px, 'trovata l\'icona del Monte Serra');
if (px) {
  await page.mouse.move(px[0], px[1]); await page.waitForTimeout(300);
  check((await txt('#tooltip'))?.includes('Monte Serra'), 'tooltip sul punto di interesse');
  await page.mouse.click(px[0], px[1]); await page.waitForTimeout(800);
  check((await txt('#points'))?.includes('Monte Serra'), 'il clic sull\'icona aggiunge la tappa con il nome');
}

await browser.close();
if (errors.length) fails.push('errori JavaScript: ' + errors.join(' | '));
if (fails.length) { console.error('!! ' + fails.join('\n!! ')); process.exit(1); }
console.log('ok: preview spiegata');
