// La preview si carica, crea la mappa OpenLayers, mostra la data dei dati e
// non mostra errori. Uso, dalla cartella gateway: node scripts/preview-check.mjs [url]
import {chromium} from 'playwright';
const url = process.argv[2] ?? 'http://localhost:8991/preview/?c=10.53,43.74&z=13';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__wm?.map && document.querySelector('#newProfile option'),
  null, {timeout: 20000});
const err = await page.textContent('#err');
const stamp = await page.textContent('#stamp');
// senza il parametro d non deve esserci il banner "dati cambiati"
const bannerSenzaD = await page.evaluate(() => document.body.textContent.includes('dati sono cambiati'));
await page.close();
// con un d diverso dallo stamp corrente il banner deve comparire
const page2 = await browser.newPage();
await page2.goto((process.argv[2] ?? 'http://localhost:8991/preview/?c=10.53,43.74&z=13') + '&d=1970-01-01T00:00:00Z');
await page2.waitForFunction(() => document.querySelector('#newProfile option'), null, {timeout: 20000});
const bannerConD = await page2.evaluate(() => document.body.textContent.includes('dati sono cambiati'));
await browser.close();
if (errors.length || err?.trim() || !stamp?.trim()) { console.error('!! errori:', errors, err, stamp); process.exit(1); }
if (bannerSenzaD || !bannerConD) { console.error('!! banner dati cambiati:', {bannerSenzaD, bannerConD}); process.exit(1); }
console.log('ok: preview caricata, banner dati-cambiati a posto');
