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
await browser.close();
if (errors.length || err?.trim() || !stamp?.trim()) { console.error('!! errori:', errors, err, stamp); process.exit(1); }
console.log('ok: preview caricata');
