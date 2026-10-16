// Tempo a piedi secondo la DIN 33466: 4 km/h in piano, 300 m/h in salita,
// 500 m/h in discesa; il maggiore dei due tempi piu' meta' del minore. E' un
// massimo su totali, quindi non si esprime come velocita' per arco. I valori
// della norma sono da verificare sul testo (overview, "Tempo di percorrenza").
export function hikingTimeHours({distanceM, ascendM, descendM}) {
  const th = distanceM / 1000 / 4;
  const tv = ascendM / 300 + descendM / 500;
  return Math.max(th, tv) + Math.min(th, tv) / 2;
}
