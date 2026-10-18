import {it, expect} from 'vitest';
import {inflateSync} from 'node:zlib';
import {encodePng} from '../src/mcp/png.js';

// Scorre i chunk dopo la firma: [{type, data}]
const chunks = png => {
  const out = [];
  let o = 8;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    out.push({type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len)});
    o += 12 + len;
  }
  return out;
};

const rgb2x1 = Buffer.from([255, 0, 0, 0, 0, 255]);

it('inizia con la firma PNG', () => {
  const png = encodePng(2, 1, rgb2x1);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

it('contiene IHDR, IDAT, IEND in quest\'ordine', () => {
  expect(chunks(encodePng(2, 1, rgb2x1)).map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
});

it('l\'IHDR dichiara larghezza, altezza, bit depth 8 e colorType 2', () => {
  const ihdr = chunks(encodePng(2, 1, rgb2x1))[0].data;
  expect(ihdr.length).toBe(13);
  expect(ihdr.readUInt32BE(0)).toBe(2);
  expect(ihdr.readUInt32BE(4)).toBe(1);
  expect(ihdr[8]).toBe(8);
  expect(ihdr[9]).toBe(2);
});

it('e\' deterministico', () => {
  expect(encodePng(2, 1, rgb2x1).equals(encodePng(2, 1, rgb2x1))).toBe(true);
});

it('l\'IDAT di un 2x1 si decomprime in 00 r g b r g b', () => {
  const idat = chunks(encodePng(2, 1, rgb2x1))[1].data;
  expect([...inflateSync(idat)]).toEqual([0, 255, 0, 0, 0, 0, 255]);
});

// CRC-32 (IEEE) locale: zlib.crc32 non esiste nel Node 18 del repo
const crc32 = buf => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

it('ogni chunk ha un CRC-32 valido, calcolato su tipo + dati', () => {
  const png = encodePng(2, 1, rgb2x1);
  let o = 8, n = 0;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const tipoEDati = png.subarray(o + 4, o + 8 + len);
    expect(png.readUInt32BE(o + 8 + len), `CRC di ${png.toString('latin1', o + 4, o + 8)}`).toBe(crc32(tipoEDati));
    o += 12 + len; n++;
  }
  expect(n).toBe(3);
  expect(png.subarray(png.length - 4).toString('hex')).toBe('ae426082');
});

it('rifiuta un buffer di dimensione sbagliata', () => {
  expect(() => encodePng(2, 2, rgb2x1)).toThrow();
});
