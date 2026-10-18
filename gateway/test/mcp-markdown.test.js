import {describe, it, expect} from 'vitest';
import {renderMarkdown, MAX_MARKDOWN} from '../src/mcp/markdown.js';

describe('sottoinsieme sostenuto', () => {
  it('paragrafi separati da riga vuota', () => {
    expect(renderMarkdown('uno\ndue\n\ntre')).toBe('<p>uno due</p><p>tre</p>');
  });
  it('## e ### sono titoli, # no (il titolo e\' nostro)', () => {
    expect(renderMarkdown('## A\n### B')).toBe('<h2>A</h2><h3>B</h3>');
    const h1 = renderMarkdown('# Titolo');
    expect(h1).not.toMatch(/<h1/);
    expect(h1).toContain('# Titolo');
  });
  it('elenchi puntati e numerati', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });
  it('grassetto, corsivo, codice', () => {
    expect(renderMarkdown('**a** *b* `c`')).toBe('<p><strong>a</strong> <em>b</em> <code>c</code></p>');
  });
  it('dentro il codice niente grassetto ne\' corsivo', () => {
    expect(renderMarkdown('`**a** *b*`')).toBe('<p><code>**a** *b*</code></p>');
  });
  it('link https e http', () => {
    expect(renderMarkdown('[x](https://a.it)')).toContain('<a href="https://a.it"');
    expect(renderMarkdown('[x](http://a.it/p?q=1&r=2)')).toContain('href="http://a.it/p?q=1&amp;r=2"');
  });
  it('tutto il resto resta testo', () => {
    const o = renderMarkdown('> cit\n\n| a | b |\n\n![i](https://a.it/i.png)');
    expect(o).not.toMatch(/<blockquote|<table|<img/);
  });
});

describe('vuoto', () => {
  it.each([[''], ['   \n\t '], [null], [undefined]])('%j -> stringa vuota', v => {
    expect(renderMarkdown(v)).toBe('');
  });
});

describe('contenuto ostile', () => {
  it('<script> esce come testo', () => {
    const o = renderMarkdown('<script>alert(1)</script>');
    expect(o).not.toContain('<script');
    expect(o).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('<img onerror> esce come testo', () => {
    const o = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(o).not.toMatch(/<img/);
    expect(o).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('html grezzo accanto al markdown', () => {
    expect(renderMarkdown('**a** <b>c</b>')).toBe('<p><strong>a</strong> &lt;b&gt;c&lt;/b&gt;</p>');
  });
  it.each([
    ['[x](javascript:alert(1))'],
    ['[x](JaVaScRiPt:alert(1))'],
    ['[x](java\tscript:alert(1))'],
    ['[x](%6Aavascript:alert(1))'],
    ['[x](data:text/html;base64,AAAA)'],
    ['[x](vbscript:x)'],
    ['[x](//evil.it)'],
    ['[x](/relativo)'],
  ])('%j non produce href', t => {
    const o = renderMarkdown(t);
    expect(o).not.toMatch(/href/i);
    expect(o).not.toContain('<a');
  });
  it('spazi attorno all\'indirizzo vengono tolti, lo schema resta https', () => {
    expect(renderMarkdown('[x](  https://a.it  )')).toContain('href="https://a.it"');
  });
  it('virgolette nell\'indirizzo non escono dall\'attributo', () => {
    const o = renderMarkdown('[x](https://a.it/" onmouseover="alert(1))');
    expect(o).not.toMatch(/<a[^>]*\sonmouseover=/);
    expect(o).not.toMatch(/"\s+onmouseover/);
  });
  it('apice e virgolette nel testo sono escapati', () => {
    expect(renderMarkdown(`a "b" 'c' & d`)).toBe('<p>a &quot;b&quot; &#39;c&#39; &amp; d</p>');
  });
  it('html nel testo del link e nel codice resta testo', () => {
    const o = renderMarkdown('[<b>x</b>](https://a.it) `<i>y</i>`');
    expect(o).not.toMatch(/<b>|<i>/);
  });
  it('segnaposto interni nell\'input non vengono interpretati', () => {
    const o = renderMarkdown('\u00000\u0000 `a`');
    expect(o).not.toContain('\u0000');
  });
  it('input troncato a MAX_MARKDOWN', () => {
    expect(MAX_MARKDOWN).toBe(20000);
    const o = renderMarkdown('a'.repeat(MAX_MARKDOWN + 500));
    expect(o).toBe(`<p>${'a'.repeat(MAX_MARKDOWN)}</p>`);
  });
});
