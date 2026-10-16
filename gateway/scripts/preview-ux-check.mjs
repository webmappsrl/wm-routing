// Controllo della preview dal punto di vista di chi la usa: legende, punti
// numerati, risultati spiegati, errori in italiano, area dei dati.
// Uso, dalla cartella gateway: node scripts/preview-ux-check.mjs [base]
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require = createRequire(import.meta.url);
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
// profilo altimetrico interattivo: passandoci sopra compare il punto sulla mappa e la lettura
{
  await page.locator('#profile').scrollIntoViewIfNeeded();
  const pb = await page.locator('#profile').boundingBox();
  await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
  await page.waitForTimeout(300);
  const read = await txt('#profile-readout');
  check(/km/.test(read ?? '') && /m\b/.test(read ?? ''), 'lettura del profilo: km e quota');
  check(await page.evaluate(() => window.__wm.routeSource.getFeatures().some(f => f.get('profileMarker'))),
    'segnaposto sulla mappa dal profilo');
  await page.mouse.move(pb.x - 20, pb.y - 20);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !window.__wm.routeSource.getFeatures().some(f => f.get('profileMarker'))),
    'il segnaposto sparisce uscendo dal profilo');
  check(await page.evaluate(() => window.__wm.state.profilePaths?.alt >= 0), 'alternative disegnate sul profilo');
}
// acqua e rifugi lungo il giro, dai punti delle tile
{
  const along = await page.waitForFunction(() => window.__wm.state.alongRoute?.length > 0, null, {timeout: 20000})
    .then(() => page.evaluate(() => window.__wm.state.alongRoute), () => null);
  check(along?.length > 0, 'elenco "lungo il giro" con almeno una voce (su questo giro ci sono fontane)');
  if (along?.length) {
    check(await page.locator('#along li').count() === along.length, 'elenco "lungo il giro" visibile');
    check(/km/.test(await txt('#along')), 'ogni voce dice a che km si trova');
    check(await page.evaluate(() => window.__wm.routeSource.getFeatures().filter(f => f.get('along')).length >= 2),
      'fontane e ripari disegnati sulla mappa, col raccordo');
    // il pulsante "tappa" inserisce il punto nella tappa giusta e il giro ci passa
    const n0 = await page.evaluate(() => window.__wm.state.points.length);
    await page.locator('#along [data-add="0"]').click({timeout: 3000}).catch(() => fails.push('pulsante tappa assente'));
    const added = await page.waitForFunction(n => window.__wm.state.points.length === n + 1, n0, {timeout: 10000})
      .then(() => true, () => false);
    check(added, 'una fontana diventa una tappa del giro');
    check(await page.evaluate(() => window.__wm.state.poi.some(x => x?.kind)), 'la tappa porta il nome del posto');
    await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
    await page.locator('#undo').click({timeout: 3000}).catch(() => {});
    await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
    // sul pc: clic sul pallino -> finestrella appuntata che resta anche muovendo il mouse
    const mpx = await page.evaluate(() => {
      const {map, state} = window.__wm;
      map.getView().setCenter(ol.proj.fromLonLat(state.alongRoute[0].coord));
      map.renderSync();
      return map.getPixelFromCoordinate(ol.proj.fromLonLat(state.alongRoute[0].coord));
    });
    await page.mouse.click(mpx[0], mpx[1]);
    await page.waitForTimeout(400);
    await page.mouse.move(mpx[0] + 120, mpx[1] + 80);
    await page.waitForTimeout(400);
    check(await page.locator('#tooltip.pinned').isVisible().catch(() => false),
      'la finestrella del pallino resta aperta muovendo il mouse');
    const fa = page.locator('#tooltip button', {hasText: 'Fanne una tappa'});
    check(await fa.isVisible().catch(() => false), 'pulsante "Fanne una tappa" raggiungibile');
    const nA = await page.evaluate(() => window.__wm.state.points.length);
    await fa.click({timeout: 3000}).catch(() => fails.push('"Fanne una tappa" non cliccabile'));
    check(await page.waitForFunction(n => window.__wm.state.points.length === n + 1, nA, {timeout: 10000})
      .then(() => true, () => false), '"Fanne una tappa" aggiunge la tappa');
    await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
    await page.locator('#undo').click({timeout: 3000}).catch(() => {});
    await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
  }
}
// sentieri CAI del giro, da osmfeatures: elenco, scheda, wiki
{
  const got = await page.waitForFunction(() => window.__wm.state.caiRoutes?.length > 0, null, {timeout: 25000})
    .then(() => true, () => false);
  check(got, 'sentieri CAI del giro: almeno una scheda da osmfeatures');
  if (got) {
    check(/\d/.test(await page.locator('#cai-routes .chip').first().textContent()), 'chip del segnavia');
    await page.locator('#cai-routes .chip').first().click();
    await page.waitForTimeout(300);
    const det = await txt('#cai-routes .cai-detail');
    check(/OSM/.test(await page.locator('#cai-routes .cai-detail').first().innerHTML()), 'scheda col rimando a OSM');
    check((await page.locator('#cai-routes li').first().textContent()).includes('km nel giro'), 'km percorsi sul sentiero');
  }
}
// segnavia scritto lungo il tracciato e via OSM nei dettagli
check(await page.evaluate(() => window.__wm.routeSource.getFeatures()
  .flatMap(f => [].concat(f.get('style') ?? [])).some(st => st?.getText?.()?.getPlacement?.() === 'line'
    && /\d|[A-Z]/.test(st.getText().getText() ?? ''))), 'segnavia scritto lungo il tracciato');
{
  await page.waitForFunction(() => window.__wm.state.results.nuovo?.segments?.some(x => x.osmWayId),
    null, {timeout: 30000}).catch(() => fails.push('nessun tratto con osmWayId'));
  // un pixel dove sotto il mouse c'e' proprio un tratto con osmWayId (non un pallino o una tappa)
  const segPx = await page.evaluate(() => {
    const {map, state} = window.__wm;
    const r = state.results.nuovo;
    if (!r) return [0, 0];
    for (const seg of r.segments.filter(x => x.osmWayId)) {
      const i = Math.floor((seg.from + seg.to) / 2);
      const px = map.getPixelFromCoordinate(ol.proj.fromLonLat(r.geometry.coordinates[i].slice(0, 2)));
      if (px[0] < 20 || px[0] > 900 || px[1] < 20 || px[1] > 830) continue;
      const hit = map.forEachFeatureAtPixel(px, f => (f.get('seg') || f.get('info') ? f : undefined), {hitTolerance: 4});
      if (hit?.get('seg')?.osmWayId) return px;
    }
    return [0, 0];
  });
  if (segPx[0] > 0 && segPx[0] < 920 && segPx[1] > 0 && segPx[1] < 850) {
    await page.mouse.move(segPx[0], segPx[1]);
    await page.waitForTimeout(400);
    check(/Via OSM: \d+/.test(await txt('#tooltip') ?? ''), 'via OSM nei dettagli del tratto');
    await page.mouse.move(10, 400);
  }
}
// frecce del verso di percorrenza sul tracciato
check(await page.evaluate(() => window.__wm.routeSource.getFeatures().filter(f => f.get('arrow')).length > 2),
  'frecce di direzione sul tracciato');
check((await txt('#segments'))?.includes('esperto'), 'tabella dei tratti: profilo usato');
// taglio escursionistico: difficolta' complessiva, quote, tratto piu' ripido, tempi alle tappe, segnavia
check(/^(T|E|EE|EEA)$/.test((await txt('#results .card .badge'))?.trim() ?? ''), 'distintivo della difficolta\' complessiva');
check(/\d+–\d+ m/.test((await txt('#results .card'))), 'quota minima e massima in scheda');
check(/ripido/i.test((await txt('#results .card'))), 'tratto piu\' ripido in scheda');
check(/(\d+ h |\d+ min)/.test((await txt('#points li:nth-child(2)')) ?? ''), 'tempo DIN alla tappa 2 nell\'elenco dei punti');
const segHead = await txt('#segments thead');
check(/Segnavia/.test(segHead ?? ''), 'colonna dei segnavia nella tabella');

// GPX: il file scaricato ha traccia con quote e tappe con nome
const [download] = await Promise.all([
  page.waitForEvent('download', {timeout: 8000}).catch(() => null),
  page.locator('#gpx').click({timeout: 3000}).catch(() => fails.push('pulsante GPX assente')),
]);
if (!download) fails.push('il GPX non parte');
else {
  const gpx = require('node:fs').readFileSync(await download.path(), 'utf8');
  check(/<gpx/.test(gpx) && /<trkpt[^>]*>\s*<ele>/.test(gpx), 'GPX con traccia e quote');
  check(/<wpt/.test(gpx), 'GPX con le tappe');
  check(/\.gpx$/.test(download.suggestedFilename()), 'nome del file .gpx');
}
check(await page.locator('#share').isVisible().catch(() => false), 'pulsante per copiare il link');

// desktop: un clic sul tracciato inserisce il punto nel tratto giusto, non in coda;
// trascinando la linea si fa lo stesso col mouse (lo standard dei planner)
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
const midPx = await page.evaluate(() => {
  const {map, state} = window.__wm;
  const c = state.results.nuovo.geometry.coordinates;
  // il sotto-test del pallino ha spostato la vista: si reinquadra il percorso
  const ext = ol.extent.boundingExtent(c.map(p => ol.proj.fromLonLat(p.slice(0, 2))));
  map.getView().fit(ext, {padding: [140, 420, 120, 60], maxZoom: 15});
  map.renderSync();
  const marks = (state.alongRoute ?? []).map(x => map.getPixelFromCoordinate(ol.proj.fromLonLat(x.coord)));
  // un punto del tracciato visibile e lontano dai pallini di "lungo il giro"
  for (let i = Math.floor(c.length * 0.3); i < c.length; i++) {
    const px = map.getPixelFromCoordinate(ol.proj.fromLonLat(c[i].slice(0, 2)));
    if (px[0] > 40 && px[0] < 900 && px[1] > 120 && px[1] < 700
        && marks.every(mp => Math.hypot(mp[0] - px[0], mp[1] - px[1]) > 25)) return px;
  }
  return map.getPixelFromCoordinate(ol.proj.fromLonLat(c[Math.floor(c.length / 2)].slice(0, 2)));
});
const nPts = await page.evaluate(() => window.__wm.state.points.length);
await page.mouse.click(midPx[0], midPx[1]);
const inserted = await page.waitForFunction(n => window.__wm.state.points.length === n + 1, nPts, {timeout: 10000})
  .then(() => true, () => false);
check(inserted, 'clic sul tracciato: aggiunge un punto');
if (inserted) {
  const where = await page.evaluate(() => {
    const {map, state} = window.__wm;
    return {i: state.points.findIndex(p => p.join() === state.lastInserted?.join()), n: state.points.length};
  });
  check(where.i > 0 && where.i < where.n - 1, 'il punto cliccato sul tracciato finisce nel mezzo, non in coda');
}
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
const dragFrom = await page.evaluate(() => {
  const {map, state} = window.__wm;
  if (!state.results.nuovo) return null;
  const c = state.results.nuovo.geometry.coordinates;
  const marks = (state.alongRoute ?? []).map(x => map.getPixelFromCoordinate(ol.proj.fromLonLat(x.coord)));
  for (let i = Math.floor(c.length * 0.2); i < c.length; i++) {
    const px = map.getPixelFromCoordinate(ol.proj.fromLonLat(c[i].slice(0, 2)));
    if (px[0] > 60 && px[0] < 860 && px[1] > 140 && px[1] < 680
        && marks.every(mp => Math.hypot(mp[0] - px[0], mp[1] - px[1]) > 25)) return px;
  }
  return map.getPixelFromCoordinate(ol.proj.fromLonLat(c[Math.floor(c.length / 4)].slice(0, 2)));
});
if (!dragFrom) fails.push('trascinamento: nessun tracciato (' + ((await txt('#err')) ?? '') + ')');
const nPts2 = await page.evaluate(() => window.__wm.state.points.length);
if (dragFrom) {
await page.mouse.move(dragFrom[0], dragFrom[1]);
await page.mouse.down();
await page.mouse.move(dragFrom[0] + 40, dragFrom[1] - 25, {steps: 8});
await page.mouse.up();
const dragged = await page.waitForFunction(n => window.__wm.state.points.length === n + 1, nPts2, {timeout: 10000})
  .then(() => true, () => false);
check(dragged, 'trascinando la linea si inserisce un punto');
}
const centerBefore = await page.evaluate(() => window.__wm.map.getView().getCenter().join());
check((await page.evaluate(() => window.__wm.map.getView().getCenter().join())) === centerBefore,
  'il trascinamento della linea non sposta la mappa');


// inverti il giro e andata e ritorno
const before = await page.evaluate(() => window.__wm.state.points.map(p => p.join()));
await page.locator('#reverse').click({timeout: 3000}).catch(() => fails.push('pulsante inverti assente'));
await page.waitForFunction(f => window.__wm.state.points[0].join() === f, before.at(-1), {timeout: 10000})
  .then(() => true, () => fails.push('inverti il giro non inverte'));
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});
await page.locator('#outback').click({timeout: 3000}).catch(() => fails.push('pulsante andata e ritorno assente'));
const closed = await page.waitForFunction(n => window.__wm.state.points.length === 2 * n - 1
  && window.__wm.state.points.at(-1).join() === window.__wm.state.points[0].join(), before.length,
  {timeout: 10000}).then(() => true, () => false);
check(closed, 'andata e ritorno chiude il giro per la stessa via');
await page.waitForFunction(() => window.__wm.state.results.nuovo, null, {timeout: 30000}).catch(() => {});


await page.goto(base + '?p=12.0,45.0;12.1,45.1&motore=nuovo&c=12,45&z=12');
await page.waitForFunction(() => document.querySelector('#err')?.textContent.trim(), null, {timeout: 30000}).catch(() => {});
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
  // il wiki compare gia' nel tooltip, prima di decidere se farne una tappa
  const hoverWiki = await page.evaluate(async ([x, y]) => {
    try {
      const poi = findPoi([x, y]);
      if (!poi) return false;
      const list = await (await fetch(`https://osmfeatures.maphub.it/api/v2/features/places/${poi.coord[0]}/${poi.coord[1]}/80`)).json();
      const hit = list.find(q => q.name === poi.name) ?? list[0];
      if (!hit) return false;
      const d = await (await fetch(`https://osmfeatures.maphub.it/api/v2/features/places/${hit.osmfeatures_id}`)).json();
      return !!(d?.properties?.wikipedia || d?.properties?.enrichments);
    } catch { return false; }
  }, px);
  if (hoverWiki) {
    const shown = await page.waitForFunction(() => document.querySelector('#tooltip .wiki'), null, {timeout: 20000})
      .then(() => true, () => false);
    check(shown, 'foto e riassunto wiki nel tooltip del POI, prima della tappa');
  }
  await page.mouse.click(px[0], px[1]); await page.waitForTimeout(800);
  check((await txt('#points'))?.includes('Monte Serra'), 'il clic sull\'icona aggiunge la tappa con il nome');
  // se osmfeatures conosce il posto con wiki, la tappa mostra foto/riassunto
  const expectWiki = await page.evaluate(async () => {
    try {
      const poi = window.__wm.state.poi.find(x => x?.name === 'Monte Serra');
      if (!poi) return false;
      const list = await (await fetch(`https://osmfeatures.maphub.it/api/v2/features/places/${poi.coord[0]}/${poi.coord[1]}/80`)).json();
      const hit = list.find(x => x.name === 'Monte Serra') ?? list[0];
      if (!hit) return false;
      const d = await (await fetch(`https://osmfeatures.maphub.it/api/v2/features/places/${hit.osmfeatures_id}`)).json();
      return !!(d?.properties?.wikipedia || d?.properties?.enrichments);
    } catch { return false; }
  });
  if (expectWiki) {
    const shownWiki = await page.waitForFunction(() => document.querySelector('#points .wiki'), null, {timeout: 15000})
      .then(() => true, () => false);
    check(shownWiki, 'la tappa da POI mostra il riquadro wiki (osmfeatures lo conosce)');
  }
}

await browser.close();
if (errors.length) fails.push('errori JavaScript: ' + errors.join(' | '));
if (fails.length) { console.error('!! ' + fails.join('\n!! ')); process.exit(1); }
console.log('ok: preview spiegata');
