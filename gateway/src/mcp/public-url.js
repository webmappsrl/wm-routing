// L'indirizzo pubblico con cui si compongono i link consegnati: la variabile
// d'ambiente puo' essere vuota (docker-compose la passa come stringa vuota
// quando non e' impostata), e `??` non intercetta la stringa vuota.
export const publicUrlDi = (valore, locale) => (String(valore ?? '').trim() || locale);
