// Il tool documento_giro: compone il documento finito del giro, con dentro il
// racconto scritto dall'assistente.
//
// Il principio del servizio non cambia: il modello non fornisce dati. Passa
// SOLO il suo testo e gli osmId dei luoghi di cui parla; nome, quota,
// posizione, numeri e geometria li rimette il server, dal blob firmato e dal
// database. Un osmId che non sta nel blob non entra nel documento.
//
// Il testo attraversa il server, non ci resta: niente scritture su disco,
// niente cache, nessuna struttura che sopravviva alla richiesta. L'unica cosa
// tenuta in memoria fra una chiamata e l'altra sono i file della preview
// (scheletro, CSS, JavaScript), che sono nostri e si leggono una volta sola.
import {readFileSync} from 'node:fs';
import {decodeLink, LinkError} from './link.js';
import {datiScheda, linkGpxDi} from './dati-scheda.js';
import {makeResolvePoi} from './poi.js';
import {renderMarkdown, MAX_MARKDOWN} from './markdown.js';

// Tetto dei luoghi raccontati e delle fonti: oltre, il documento non e' piu'
// una scheda ma un libro, e la richiesta MCP diventa enorme.
const MAX_LUOGHI = 30;
const MAX_FONTI = 30;
const MAX_TITOLO = 200;
const MAX_URL = 500;

// --- i file della preview, letti una volta per cartella (non a ogni chiamata) ---

const PREVIEW_DIR = process.env.WM_PREVIEW ?? new URL('../../../preview', import.meta.url).pathname;

const cache = new Map();

// Risolve gli import relativi di un modulo ES in un blocco unico: il documento
// si apre da file://, dove un modulo caricato con src verso un'altra origine
// non parte (CORS) e /preview/... non si risolve.
function bundleModulo(dir, entry, visti = new Set(), fuori = []) {
  if (visti.has(entry)) return fuori;
  visti.add(entry);
  const src = readFileSync(`${dir}/${entry}`, 'utf8');
  const corpo = src.replace(/^import\s+[^;]*?from\s+['"](\.\/[^'"]+)['"];?[ \t]*$/gm, (riga, rif) => {
    bundleModulo(dir, rif.slice(2), visti, fuori);
    return '';
  }).replace(/^export\s+(?=function|const|let|class)/gm, '');
  // un import che non abbiamo saputo risolvere renderebbe il blocco non
  // parsabile e il documento bianco: meglio morire qui, alla costruzione
  if (/^\s*import\s/m.test(corpo)) throw new Error(`import non risolto in ${entry}`);
  fuori.push(corpo);
  return fuori;
}

function assets(previewDir) {
  let a = cache.get(previewDir);
  if (!a) {
    a = {
      scheletro: readFileSync(`${previewDir}/scheda.html`, 'utf8'),
      css: readFileSync(`${previewDir}/scheda.css`, 'utf8'),
      // qrcode-generator (MIT, vendorizzato): non e' un modulo ES ma uno script
      // classico che definisce `qrcode`, quindi non passa da bundleModulo
      qr: readFileSync(`${previewDir}/qrcode.js`, 'utf8'),
      js: bundleModulo(previewDir, 'scheda.js').join('\n'),
    };
    cache.set(previewDir, a);
  }
  return a;
}

// --- composizione del documento ---

// Dentro un <script> il parser HTML cerca solo "</script": il JSON si scrive
// con JSON.stringify e il "<" diventa <, cosi' un "</script>" scritto
// dall'assistente non puo' chiudere il blocco. JSON.parse lo rilegge come "<".
const jsonInline = d => JSON.stringify(d).replace(/</g, '\\u003c');
// Gli stessi file sono nostri, ma la regola vale lo stesso: niente sequenza
// che chiuda il tag che li contiene.
const scriptInline = s => s.replace(/<\/script/gi, '<\\/script');
const styleInline = s => s.replace(/<\/style/gi, '<\\/style');

// Le sostituzioni passano SEMPRE da una funzione: in una stringa di
// sostituzione i pattern $&, $`, $' e $$ hanno un significato, e il JSON ci
// finisce dentro cosi' com'e'. Un "$&" scritto dall'assistente rimetterebbe
// nel documento il tag trovato, non escapato: secondo blocco script, JSON
// rotto, e l'utente si salva una pagina vuota credendola il suo giro.
function componi(previewDir, dati) {
  const a = assets(previewDir);
  return a.scheletro
    .replace('<link rel="stylesheet" href="/preview/scheda.css">',
      () => `<style>\n${styleInline(a.css)}\n</style>`)
    .replace('<script src="/preview/qrcode.js"></script>',
      () => `<script>\n${scriptInline(a.qr)}\n</script>`)
    .replace('<script src="/preview/scheda.js" type="module"></script>',
      () => `<script type="module">\n${scriptInline(a.js)}\n</script>`)
    .replace('<script type="application/json" id="dati-giro"></script>',
      () => `<script type="application/json" id="dati-giro">${jsonInline(dati)}</script>`);
}

// --- validazione degli slot ---

// Uno slot troppo lungo e' un errore esplicito, non un documento tagliato in
// silenzio. L'errore dice quale slot e di quanto: mai il testo, che tornando
// indietro al modello sarebbe una injection riflessa.
const troppoLungo = (slot, testo) => {
  const n = typeof testo === 'string' ? testo.length : 0;
  return n > MAX_MARKDOWN ? {stato: 'testo_troppo_lungo', slot, caratteri: n, massimo: MAX_MARKDOWN} : null;
};

// Prima si scartano le fonti inservibili, POI si taglia al tetto: tagliando
// per primo, trenta righe rotte in cima farebbero sparire l'unica buona.
const fontiValide = fonti => (Array.isArray(fonti) ? fonti : [])
  .filter(f => f && typeof f.titolo === 'string' && typeof f.url === 'string' && /^https?:\/\//i.test(f.url))
  .slice(0, MAX_FONTI)
  .map(f => ({titolo: f.titolo.slice(0, MAX_TITOLO), url: f.url.slice(0, MAX_URL)}));

export function makeDocumentoTool({gatewayUrl, publicUrl = gatewayUrl, linkKey, fetchFn = fetch,
                                   waysDbPath = '', previewDir = PREVIEW_DIR,
                                   resolvePoi = makeResolvePoi({waysDbPath})}) {
  return async function documentoTool({t, introduzione, luoghi = [], consigli, fonti = []}) {
    // 1) il blob: un link alterato vale come uno malformato
    let blob;
    try { blob = decodeLink(t, linkKey); }
    catch (e) { return {stato: e instanceof LinkError ? e.stato : 'firma_non_valida'}; }

    // 2) gli slot dell'assistente, misurati prima di qualsiasi calcolo
    if (!Array.isArray(luoghi)) return {stato: 'luoghi_non_validi'};
    if (luoghi.length > MAX_LUOGHI) return {stato: 'troppi_luoghi', massimo: MAX_LUOGHI};
    const errore = troppoLungo('introduzione', introduzione) ?? troppoLungo('consigli', consigli)
      ?? luoghi.map((l, i) => troppoLungo(`luoghi[${i}]`, l?.testo)).find(Boolean);
    if (errore) return errore;

    // 3) i dati del giro: calcolati dal server sui punti firmati
    let route;
    try {
      const r = await fetchFn(`${gatewayUrl}/v1/mcp/route`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({profile: blob.profile, points: blob.points}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return {stato: j.stato ?? 'errore'};
      route = j;
    } catch { return {stato: 'gateway_non_raggiungibile'}; }
    const v = await fetchFn(`${gatewayUrl}/v1/version`).then(x => x.json()).catch(() => null);

    const dati = datiScheda({route, blob, resolvePoi, dataStamp: v ? () => v : undefined,
      linkGpx: linkGpxDi(publicUrl, t)});
    // un guasto del database non e' un POI sparito: non va raccontato come tale
    if (dati.poiNonDisponibili) return {stato: 'dati_non_disponibili'};

    // 4) il racconto: solo i luoghi che il blob firmato porta davvero
    // I tre modi di non finire nel documento si contano a parte: dire
    // «quell'osmId non e' nel giro» quando il testo era solo vuoto sarebbe
    // falso, e l'assistente lo riferirebbe all'utente.
    const ammessi = new Set(dati.poi.map(p => p.osmId));
    const raccontoLuoghi = {};
    let luoghiIgnorati = 0, luoghiSenzaTesto = 0, luoghiDuplicati = 0;
    for (const l of luoghi) {
      if (!Number.isSafeInteger(l?.osmId) || !ammessi.has(l.osmId)) { luoghiIgnorati++; continue; }
      if (Object.hasOwn(raccontoLuoghi, l.osmId)) { luoghiDuplicati++; continue; }  // vince il primo
      const html = renderMarkdown(l.testo);
      if (!html) { luoghiSenzaTesto++; continue; }
      raccontoLuoghi[l.osmId] = html;
    }
    dati.racconto = {
      introduzione: renderMarkdown(introduzione),
      luoghi: raccontoLuoghi,
      consigli: renderMarkdown(consigli),
      fonti: fontiValide(fonti),
    };

    const km = dati.distanzaKm.toFixed(1);
    return {
      documento: componi(previewDir, dati),
      nomeFile: `giro-${km}km.html`,
      luoghiIgnorati, luoghiSenzaTesto, luoghiDuplicati,
    };
  };
}
