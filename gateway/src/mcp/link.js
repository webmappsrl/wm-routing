// Link firmato per i deliverable: il blob porta punti, profilo e data dei
// dati, con una firma HMAC. Un link alterato o troncato dal modello non
// decodifica: errore esplicito, mai un giro plausibile ma diverso.
import {createHmac} from 'node:crypto';

export class LinkError extends Error {
  constructor(stato) { super(stato); this.stato = stato; }
}

const sign = (payload, key) =>
  createHmac('sha256', key).update(payload).digest().subarray(0, 16).toString('base64url');

const MAX_POI = 20;
const MAX_NOTA = 80;

// La nota e' l'unico testo scritto dal modello che entra nel blob e finisce
// in un file XML servito dal nostro dominio: a capo, tabulazioni e altri
// caratteri di controllo diventano spazi, poi si taglia (per caratteri interi).
const normalizeNota = nota =>
  Array.from(String(nota ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim())
    .slice(0, MAX_NOTA).join('');

// Il blob porta dei POI solo l'osmId e la nota: nome, posizione e quota si
// risolvono dal database lato server, la firma non certifica mai dati
// trascritti dal modello.
export function encodeLink({points, profile, stamp, poi}, key) {
  if (poi != null && !Array.isArray(poi)) throw new LinkError('poi_non_valido');
  if (poi && poi.length > MAX_POI) throw new LinkError('troppi_poi');
  // Un osmId non intero e' testo del modello: la firma non lo certifica.
  if (poi?.some(x => !Number.isSafeInteger(x?.osmId))) throw new LinkError('poi_non_valido');
  const body = {
    p: points.map(pt => pt.slice(0, 2).map(n => +n.toFixed(5))),
    pr: profile, d: stamp,
  };
  // Senza POI il campo non si scrive: il blob resta identico a quello di prima.
  if (poi?.length) body.poi = poi.map(({osmId, nota}) => ({i: osmId, n: normalizeNota(nota)}));
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function decodeLink(blob, key) {
  const [payload, sig] = String(blob ?? '').split('.');
  if (!payload || !sig || sign(payload, key) !== sig) throw new LinkError('firma_non_valida');
  let j;
  try { j = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new LinkError('firma_non_valida'); }
  // I blob scritti prima dei POI non hanno il campo: poi vuoto. Se c'e', la sua
  // forma si verifica comunque: una firma valida non garantisce che il blob l'abbia
  // scritto il nostro encoder, e un blob malformato vale come uno manomesso.
  if (j === null || typeof j !== 'object') throw new LinkError('firma_non_valida');
  let poi = [];
  if (j.poi !== undefined) {
    if (!Array.isArray(j.poi)) throw new LinkError('firma_non_valida');
    poi = j.poi.map(x => {
      if (x === null || typeof x !== 'object' || !Number.isSafeInteger(x.i) || typeof x.n !== 'string') {
        throw new LinkError('firma_non_valida');
      }
      return {osmId: x.i, nota: normalizeNota(x.n)};
    });
  }
  return {points: j.p, profile: j.pr, stamp: j.d, poi};
}
