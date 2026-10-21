from difficulty import (cai_to_rating, sac_to_rating, rating_to_sac,
                        cai_mtb_to_rating, mtb_scale_level, rating_to_cai_mtb)

def test_cai():
    assert cai_to_rating("T") == 1
    assert cai_to_rating("TQ") == 1
    assert cai_to_rating("E") == 2
    assert cai_to_rating("EE") == 3
    for v in ("EEA", "EEA:F", "EEA:PD", "EEA:D"):
        assert cai_to_rating(v) == 4
    assert cai_to_rating(" ee ") == 3
    assert cai_to_rating("boh") is None
    assert cai_to_rating(None) is None

def test_sac():
    assert sac_to_rating("hiking") == 1
    assert sac_to_rating("difficult_alpine_hiking") == 6
    assert sac_to_rating("T3") is None

def test_rating_to_sac():
    assert rating_to_sac(2) == "mountain_hiking"
    assert rating_to_sac(6) == "difficult_alpine_hiking"
    assert rating_to_sac(0) is None

def test_cai_mtb():
    assert cai_mtb_to_rating("TC") == 1
    assert cai_mtb_to_rating("MC") == 2
    assert cai_mtb_to_rating("BC") == 3
    assert cai_mtb_to_rating("OC") == 4
    assert cai_mtb_to_rating("EC") == 5
    # il "+" segnala pendenze sostenute, non cambia il grado
    assert cai_mtb_to_rating("MC+") == 2
    assert cai_mtb_to_rating("TC+") == 1
    assert cai_mtb_to_rating(" bc ") == 3
    assert cai_mtb_to_rating("boh") is None
    assert cai_mtb_to_rating(None) is None

def test_mtb_scale_level():
    # la Singletrail-Skala resta nel suo vocabolario: nessuna sigla CAI dedotta
    for v in range(7):
        assert mtb_scale_level(str(v)) == v
    assert mtb_scale_level("1+") == 1
    assert mtb_scale_level("0-") == 0
    assert mtb_scale_level("7") is None
    assert mtb_scale_level("boh") is None
    assert mtb_scale_level(None) is None


def test_rating_to_cai_mtb():
    assert rating_to_cai_mtb(1) == "TC"
    assert rating_to_cai_mtb(5) == "EC"
    assert rating_to_cai_mtb(0) is None
