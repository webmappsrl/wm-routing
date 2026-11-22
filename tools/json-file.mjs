// Lettura di un file JSON che non alza eccezioni: chi chiama decide cosa fare
// del motivo. Un JSON.parse nudo dentro uno script di gate fa uscire il
// processo con lo stack trace e un codice d'uscita qualunque, mentre il
// chiamante distingue il blocco (3) dal guasto: il motivo va detto, non urlato.
// Modulo puro: niente che giri da solo all'import, cosi' si prova dal gateway.
import {readFileSync} from 'node:fs';

export function readJsonFile(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (e) { return {ok: false, reason: `${path} non si legge: ${e.code ?? e.message}`}; }
  try { return {ok: true, value: JSON.parse(text)}; }
  catch (e) { return {ok: false, reason: `${path} non e' JSON valido: ${e.message}`}; }
}
