// Stessa tabella di prepare/difficulty.py (piano, "Corrispondenza delle difficolta'").
// Il rating 6 e' EEA oltre il grado (sac_scale originale) oppure un ghiacciaio
// o una via ferrata: lo distingue l'origine della tabella laterale.
const CAI = {1: 'T', 2: 'E', 3: 'EE', 4: 'EEA', 5: 'EEA', 6: 'EEA'};
const BY_ORIGIN = {glacier: 'ghiacciaio', via_ferrata: 'via ferrata'};
export const ratingToCai = (r, origin) => BY_ORIGIN[origin] ?? CAI[r] ?? null;
