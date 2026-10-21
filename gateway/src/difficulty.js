// Stessa tabella di prepare/difficulty.py (piano, "Corrispondenza delle difficolta'").
// Il rating 6 e' EEA oltre il grado (sac_scale originale) oppure un ghiacciaio
// o una via ferrata: lo distingue l'origine della tabella laterale.
const CAI = {1: 'T', 2: 'E', 3: 'EE', 4: 'EEA', 5: 'EEA', 6: 'EEA'};
const BY_ORIGIN = {glacier: 'ghiacciaio', via_ferrata: 'via ferrata'};
export const ratingToCai = (r, origin) => BY_ORIGIN[origin] ?? CAI[r] ?? null;

// In bici due valori distinti, mai tradotti l'uno nell'altro: la sigla CAI
// dell'itinerario (stessa tabella di prepare/difficulty.py) e, solo dove quella
// manca, il livello della Singletrail-Skala di mtb:scale nel suo vocabolario
// (S0-S6). Una sigla CAI vale perche' l'ha assegnata il CAI: non si ricava da
// un'altra scala. Il tratto da fare a piedi con la bici viaggia nel campo
// dismount, perche' e' una condizione e non un grado.
const CAI_MTB = {1: 'TC', 2: 'MC', 3: 'BC', 4: 'OC', 5: 'EC'};
export const ratingToCaiMtb = r => CAI_MTB[r] ?? null;
export const mtbDifficulty = (rating, origin) =>
  origin === 'cai_mtb' ? ratingToCaiMtb(rating)
  : origin === 'mtb_scale' && rating !== null && rating !== undefined ? `S${rating}`
  : null;
