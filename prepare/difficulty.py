"""Corrispondenza fra scala CAI, sac_scale e hike_rating di GraphHopper.

hike_rating e' quello di OSMHikeRatingParser: hiking=1 ... difficult_alpine_hiking=6.
"""

CAI = {"T": 1, "TQ": 1, "E": 2, "EE": 3, "EEA": 4}
SAC = {
    "hiking": 1,
    "mountain_hiking": 2,
    "demanding_mountain_hiking": 3,
    "alpine_hiking": 4,
    "demanding_alpine_hiking": 5,
    "difficult_alpine_hiking": 6,
}
SAC_BY_RATING = {v: k for k, v in SAC.items()}

# Scala CAI per la mountain bike (cicloescursionismo): cinque gradi, dal piu'
# facile al piu' difficile. E' la scala che il socio CAI legge sul programma
# delle uscite, e l'unica che il servizio mostra in bici.
CAI_MTB = {"TC": 1, "MC": 2, "BC": 3, "OC": 4, "EC": 5}
MTB_BY_RATING = {v: k for k, v in CAI_MTB.items()}

# La Singletrail-Skala di `mtb:scale` (0-6) NON si traduce nelle sigle CAI: una
# sigla CAI vale perche' l'ha assegnata il CAI, e ricavarla da un'altra scala
# sarebbe dedurla. I due valori restano distinti, e il secondo subentra solo
# dove il primo manca.
GLACIER_RATING = 6
POOR_VISIBILITY = {"bad", "horrible", "no"}


def cai_to_rating(value):
    if value is None:
        return None
    v = value.strip().upper()
    if v.startswith("EEA"):  # EEA:F, EEA:PD, EEA:D: la variante non cambia il livello
        return CAI["EEA"]
    return CAI.get(v)


def cai_mtb_to_rating(value):
    if value is None:
        return None
    # il "+" segnala pendenze sostenute, non un grado diverso: stessa logica
    # delle varianti EEA:F / EEA:PD a piedi
    return CAI_MTB.get(value.strip().upper().replace(" ", "").rstrip("+"))


def mtb_scale_level(value):
    """Il livello della Singletrail-Skala, nel suo vocabolario: 0-6. I
    modificatori + e - del wiki OSM non cambiano il livello."""
    if value is None:
        return None
    v = value.strip().rstrip("+-")
    return int(v) if v.isdigit() and 0 <= int(v) <= 6 else None


def rating_to_cai_mtb(rating):
    return MTB_BY_RATING.get(rating)


def sac_to_rating(value):
    if value is None:
        return None
    return SAC.get(value.strip())


def rating_to_sac(rating):
    return SAC_BY_RATING.get(rating)
