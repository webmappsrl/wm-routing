import sqlite3

import osmium
import pytest

from enrich import effective, enrich

FIX = "/fixtures/rete.opl"


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    d = tmp_path_factory.mktemp("enrich")
    out, db = d / "out.osm.pbf", d / "ways.sqlite"
    tiles = d / "tiles-z13.txt"
    summary = enrich(FIX, str(out), str(db), str(tiles))
    summary["_tiles"] = set(tiles.read_text().split())
    tags = {w.id: {t.k: t.v for t in w.tags}
            for w in osmium.FileProcessor(str(out), osmium.osm.WAY)}
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = {r["way_id"]: dict(r) for r in con.execute("select * from ways")}
    return tags, rows, summary


def test_cai_from_relation(result):
    tags, rows, _ = result
    assert tags[1]["sac_scale"] == "demanding_mountain_hiking"     # r1 EE
    assert tags[2]["sac_scale"] == "hiking"                        # r2 T
    assert rows[1]["origin"] == "cai" and rows[1]["cai"] == "EE"

def test_unknown_short_and_long(result):
    tags, rows, _ = result
    assert "sac_scale" not in tags[4] and "horse_scale" not in tags[4]    # 320 m
    assert rows[4]["origin"] == "none" and rows[4]["long_chain"] == 0
    for w in (14, 15):                                                    # ~1,2 km
        assert tags[w]["horse_scale"] == "impossible"
        assert rows[w]["long_chain"] == 1

def test_glacier(result):
    tags, rows, _ = result
    assert tags[5]["sac_scale"] == "difficult_alpine_hiking"
    assert rows[5]["glacier"] == 1 and rows[5]["origin"] == "glacier"
    assert tags[3]["sac_scale"] == "hiking"          # w3 fuori dal ghiacciaio

def test_military(result):
    tags, rows, _ = result
    assert tags[11]["access"] == "no" and rows[11]["military"] == 1
    assert "access" not in tags[2]

def test_visibility_raises_one_grade(result):
    tags, rows, _ = result
    assert tags[16]["sac_scale"] == "demanding_mountain_hiking"   # E -> EE
    assert rows[16]["sac"] == "mountain_hiking" and rows[16]["visibility"] == "bad"

def test_via_ferrata(result):
    tags, rows, _ = result
    assert tags[17]["highway"] == "path"
    assert tags[17]["sac_scale"] == "difficult_alpine_hiking"
    assert rows[17]["origin"] == "via_ferrata"

def test_tiles(result):
    _, _, s = result
    assert "4323/2978" in s["_tiles"]          # tile z13 di A (10.000, 44.000)

def test_way_cut_by_clip(result):
    # dopo il ritaglio (strategia simple) una via puo' citare nodi assenti
    tags, rows, _ = result
    assert rows[18]["origin"] == "sac" and tags[18]["sac_scale"] == "hiking"

def test_effective_rules():
    assert effective(["T", "EE"], None, None, False, None) == (3, "cai")
    assert effective([], None, "alpine_hiking", False, None) == (4, "sac")
    assert effective(["boh"], None, None, False, None) == (0, "none")
    assert effective(["E"], None, None, True, None) == (6, "glacier")
    assert effective([], None, "difficult_alpine_hiking", False, "bad") == (6, "sac")
    assert effective([], None, None, False, "bad") == (0, "none")
    assert effective(["EEA"], None, None, False, None, via_ferrata=True) == (6, "via_ferrata")

def test_summary(result):
    _, _, s = result
    assert s["cai_unknown_values"] == {}
    assert s["glaciers"] == 1 and s["military_areas"] == 1
    assert s["long_chains"] == 1


def test_refs_from_relations(result):
    _, rows, _ = result
    assert rows[1]["refs"] == "139"
    assert rows[2]["refs"] == "00"      # due relazioni col lo stesso ref: una volta sola
    assert rows[4]["refs"] is None      # nessuna relazione


def test_rel_ids_from_relations(result):
    _, rows, _ = result
    assert rows[1]["rel_ids"] == "1"
    assert rows[2]["rel_ids"] == "2;3;4"    # tutte le relazioni escursionistiche, anche senza ref
    assert rows[4]["rel_ids"] is None
