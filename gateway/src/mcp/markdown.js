// Renderer Markdown minimo, scritto a mano (nessuna dipendenza).
//
// Il testo arriva da un modello ed e' contenuto ostile: finisce dentro un
// documento HTML che serviamo noi. Sicuro per costruzione: PRIMA si fa
// l'escaping completo di & < > " ' su tutto il testo, POI si applicano i
// pattern del sottoinsieme sull'output gia' escapato. Nessun carattere
// scritto dall'autore puo' diventare markup, perche' < > " ' non esistono
// piu' quando i pattern girano. Non invertire l'ordine.
//
// Sottoinsieme: paragrafi, "## " e "### ", elenchi "- " e "1. ",
// **grassetto**, *corsivo*, `codice`, link [testo](http(s)://...).
// Tutto il resto resta testo.

export const MAX_MARKDOWN = 20000;

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escapeHtml = s => s.replace(/[&<>"']/g, c => ESCAPES[c]);

// Whitelist: solo http:// e https:// letterali, senza spazi o controlli
// dentro l'indirizzo. JaVaScRiPt:, java\tscript:, %6Aavascript:, data:, //x
// non combaciano e il link non nasce.
const LINK = /\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s()]*)\s*\)/gi;

// Segnaposto con NUL: il NUL e' tolto dall'input, quindi non si puo' forgiare.
const PH = /\u0000(\d+)\u0000/g;

function inline(escaped) {
  const store = [];
  const keep = html => `\u0000${store.push(html) - 1}\u0000`;

  let s = escaped.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(LINK, (_, label, url) =>
    keep(`<a href="${url}" rel="noopener noreferrer nofollow">${emphasis(label)}</a>`));
  s = emphasis(s);

  // un link puo' contenere segnaposto di codice: si risolve piu' volte
  for (let i = 0; i < 3 && s.includes('\u0000'); i++) s = s.replace(PH, (_, n) => store[n]);
  return s;
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>');
}

export function renderMarkdown(testo) {
  if (typeof testo !== 'string') return '';
  const clean = testo.slice(0, MAX_MARKDOWN).replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  if (!clean.trim()) return '';

  const escaped = escapeHtml(clean); // 1) escaping completo, 2) poi i pattern
  const out = [];
  let para = [];
  let list = null; // {tag, items}

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (const raw of escaped.split('\n')) {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); flushList(); continue; }
    if ((m = /^(#{2,3}) +(.+)$/.exec(line))) {
      flushPara(); flushList();
      const h = m[1].length;
      out.push(`<h${h}>${inline(m[2])}</h${h}>`);
    } else if ((m = /^- +(.+)$/.exec(line))) {
      flushPara();
      if (list && list.tag !== 'ul') flushList();
      (list ||= {tag: 'ul', items: []}).items.push(m[1]);
    } else if ((m = /^\d+\. +(.+)$/.exec(line))) {
      flushPara();
      if (list && list.tag !== 'ol') flushList();
      (list ||= {tag: 'ol', items: []}).items.push(m[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('');
}
