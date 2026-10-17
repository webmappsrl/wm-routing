// Link firmato per i deliverable: il blob porta punti, profilo e data dei
// dati, con una firma HMAC. Un link alterato o troncato dal modello non
// decodifica: errore esplicito, mai un giro plausibile ma diverso.
import {createHmac} from 'node:crypto';

export class LinkError extends Error {
  constructor(stato) { super(stato); this.stato = stato; }
}

const sign = (payload, key) =>
  createHmac('sha256', key).update(payload).digest().subarray(0, 16).toString('base64url');

export function encodeLink({points, profile, stamp}, key) {
  const payload = Buffer.from(JSON.stringify({
    p: points.map(pt => pt.slice(0, 2).map(n => +n.toFixed(5))),
    pr: profile, d: stamp,
  })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function decodeLink(blob, key) {
  const [payload, sig] = String(blob ?? '').split('.');
  if (!payload || !sig || sign(payload, key) !== sig) throw new LinkError('firma_non_valida');
  let j;
  try { j = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new LinkError('firma_non_valida'); }
  return {points: j.p, profile: j.pr, stamp: j.d};
}
