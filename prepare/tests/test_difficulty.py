from difficulty import cai_to_rating, sac_to_rating, rating_to_sac

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
