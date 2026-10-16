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
GLACIER_RATING = 6
POOR_VISIBILITY = {"bad", "horrible", "no"}


def cai_to_rating(value):
    if value is None:
        return None
    v = value.strip().upper()
    if v.startswith("EEA"):  # EEA:F, EEA:PD, EEA:D: la variante non cambia il livello
        return CAI["EEA"]
    return CAI.get(v)


def sac_to_rating(value):
    if value is None:
        return None
    return SAC.get(value.strip())


def rating_to_sac(rating):
    return SAC_BY_RATING.get(rating)
