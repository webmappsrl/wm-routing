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
    summary["_db_path"] = str(db)
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


def test_poi_table(result):
    _, _, summary = result
    con = sqlite3.connect(summary["_db_path"])
    con.row_factory = sqlite3.Row
    pois = {r["name"]: dict(r) for r in con.execute("select * from poi")}
    cima = pois["Monte Prova"]                       # n90: cima con nome e wiki
    assert cima["kind"] == "peak" and cima["ele"] == 917
    assert cima["wikidata"] == "Q999999" and cima["wikipedia"] == "it:Monte Prova"
    assert cima["osm_id"] == 90
    fonte = pois["Fonte di Prova"]                   # n91: fontana senza wiki
    assert fonte["kind"] == "drinking_water"
    assert fonte["wikipedia"] is None and fonte["wikidata"] is None
    citta = pois["Citta di Prova"]                   # n93: place=city
    assert citta["kind"] == "city"
    paese = pois["Paese di Prova"]                   # n94: place=town
    assert paese["kind"] == "town"
    names = set(pois)
    assert names == {"Monte Prova", "Fonte di Prova", "Citta di Prova", "Paese di Prova"}   # n92 senza nome resta fuori


def test_relazioni_mtb_separate_da_quelle_a_piedi(result):
    _, rows, _ = result
    r = rows[2]
    assert r["refs"] == "00"           # l'elenco a piedi non cambia
    assert r["refs_mtb"] == "MTB1;MTB2"


def test_piu_itinerari_mtb_sullo_stesso_tratto_vince_il_piu_difficile(result):
    _, rows, _ = result
    assert rows[2]["cai_mtb"] == "BC"  # BC (3) batte MC+ (2)
    assert rows[2]["cai_mtb_up"] == "BC"


def test_colonne_mtb_nella_tabella(result):
    _, rows, _ = result
    assert rows[4]["mtb_scale"] == "2"
    assert rows[4]["mtb_rating"] == 2 and rows[4]["mtb_origin"] == "mtb_scale"
    assert rows[2]["mtb_rating"] == 3 and rows[2]["mtb_origin"] == "cai_mtb"


def test_difficolta_a_piedi_invariata(result):
    _, rows, _ = result
    assert rows[2]["origin"] == "cai" and rows[2]["cai"] == "T"
    assert rows[4]["mtb_rating"] == 2 and rows[4]["origin"] == "none"


def aree(summary):
    con = sqlite3.connect(summary["_db_path"])
    con.row_factory = sqlite3.Row
    return {r["name"]: dict(r) for r in con.execute("select * from area")}


def test_area_table(result):
    _, _, summary = result
    zona = aree(summary)["Massiccio di Prova"]       # r40: place=region
    assert zona["kind"] == "zone"
    assert zona["min_lon"] < zona["max_lon"] and zona["min_lat"] < zona["max_lat"]
    # il bbox contiene i nodi dell'anello (n40..n43)
    assert zona["min_lon"] == pytest.approx(10.020) and zona["max_lon"] == pytest.approx(10.030)
    assert zona["min_lat"] == pytest.approx(44.020) and zona["max_lat"] == pytest.approx(44.030)


def test_area_regione_amministrativa(result):
    _, _, summary = result
    regione = aree(summary)["Regione di Prova"]      # r41: admin_level=4
    assert regione["kind"] == "region"
    assert regione["min_lon"] == pytest.approx(10.040) and regione["max_lat"] == pytest.approx(44.060)


def test_area_osm_type_nella_chiave(result):
    _, _, summary = result
    righe = aree(summary)
    assert righe["Massiccio di Prova"]["osm_type"] == "relation"
    assert righe["Massiccio di Prova"]["osm_id"] == 40
    assert righe["Regione di Prova"]["osm_type"] == "relation"


def test_area_incompleta_dichiarata(result):
    _, _, summary = result
    # r42 cita un membro che nel file non c'e': vista, non assemblata
    assert summary["areas_seen"]["zone"] - summary["areas_built"]["zone"] == 1
    # r41 (italiana) e r43 (estera): viste e assemblate tutte e due
    assert summary["areas_seen"]["region"] == summary["areas_built"]["region"] == 2
    assert "Zona Incompleta" not in aree(summary)


def test_uno_scoglio_non_e_una_regione(result):
    """w60 e' un pezzo del confine regionale ISTAT: porta admin_level=4 come
    la regione di cui segna il bordo, ma e' uno scoglio. Le regioni
    amministrative in OSM sono relation, e sono tutte e sole quelle."""
    _, _, summary = result
    assert "Scoglio di Prova" not in aree(summary)


def test_una_regione_estera_entra_col_suo_paese(result):
    """Il ritaglio prende mezza Europa e il motore instrada anche li': una
    regione straniera intera e' un dato buono, purche' si sappia di chi e'."""
    _, _, summary = result
    assert aree(summary)["Regione Estera"]["country"] == "HR"


def test_una_regione_italiana_porta_it(result):
    _, _, summary = result
    assert aree(summary)["Regione di Prova"]["country"] == "IT"


def test_una_zona_non_ha_paese(result):
    """Massicci e catene non hanno ISO3166-2, e quelle a cavallo del confine
    non sono di un paese solo: il campo resta vuoto invece di inventare."""
    _, _, summary = result
    assert aree(summary)["Massiccio di Prova"]["country"] is None


def test_una_regione_italiana_resta(result):
    """Il controspecchio dei due test qui sopra: il filtro non deve portarsi
    via anche quello che serve."""
    _, _, summary = result
    assert aree(summary)["Regione di Prova"]["kind"] == "region"
