"""Scrive nel PBF, prima dell'import in GraphHopper, cio' che GraphHopper non
sa ricavare da solo, e salva i valori originali in una tabella laterale.

Tre passate sul file: (1) relazioni escursionistiche e poligoni di ghiacciai e
zone militari; (2) difficolta' effettiva di ogni via e catene di sentieri
sconosciuti; (3) scrittura del PBF arricchito. Regole: piano, "Corrispondenza
delle difficolta'".
"""
import json
import math
import os
import sqlite3
import subprocess
import tempfile
import sys
from collections import Counter, defaultdict

import osmium
from shapely import wkb
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from difficulty import (GLACIER_RATING, POOR_VISIBILITY, cai_to_rating,
                        rating_to_sac, sac_to_rating)

LONG_CHAIN_M = 500
# Indice delle posizioni dei nodi: di serie in memoria; sul PBF nazionale su file
# (WM_NODE_INDEX=sparse_file_array,<percorso>), altrimenti non sta in memoria.
NODE_INDEX = os.environ.get("WM_NODE_INDEX", "flex_mem")
# Per ogni via un solo intero: difficolta' (bit 0-2), zona militare, via ferrata,
# catena lunga di sconosciuti. Un dizionario per via non starebbe in memoria.
MILITARY, FERRATA, LONG = 8, 16, 32


def effective(cai_values, own_cai, own_sac, glacier, visibility, via_ferrata=False):
    if via_ferrata:
        return GLACIER_RATING, "via_ferrata"
    if glacier:
        return GLACIER_RATING, "glacier"
    ratings = [r for r in (cai_to_rating(v) for v in [*cai_values, own_cai]) if r]
    if ratings:
        rating, origin = max(ratings), "cai"
    else:
        sac = sac_to_rating(own_sac)
        if not sac:
            return 0, "none"
        rating, origin = sac, "sac"
    if visibility in POOR_VISIBILITY:
        rating = min(GLACIER_RATING, rating + 1)
    return rating, origin


def is_military(tags):
    return tags.get("landuse") == "military" or "military" in tags


class Relations(osmium.SimpleHandler):
    """Passata 1a: cai_scale delle relazioni escursionistiche (senza posizioni)."""

    def __init__(self):
        super().__init__()
        self.cai_by_way = defaultdict(list)
        self.refs_by_way = defaultdict(set)    # segnavia (ref) delle relazioni
        self.rels_by_way = defaultdict(set)    # id delle relazioni: il gancio verso osmfeatures
        self.unknown_cai = Counter()

    def relation(self, r):
        if r.tags.get("route") not in ("hiking", "foot"):
            return
        ref = r.tags.get("ref")
        for m in r.members:
            if m.type == "w":
                self.rels_by_way[m.ref].add(r.id)
                if ref:
                    self.refs_by_way[m.ref].add(ref)
        cai = r.tags.get("cai_scale")
        if cai is None:
            return
        if cai_to_rating(cai) is None:
            self.unknown_cai[cai] += 1
            return
        for m in r.members:
            if m.type == "w":
                self.cai_by_way[m.ref].append(cai)


class Areas(osmium.SimpleHandler):
    """Passata 1b: poligoni di ghiacciai e zone militari, su un estratto con solo quelli."""

    def __init__(self, relations):
        super().__init__()
        self.cai_by_way, self.unknown_cai = relations.cai_by_way, relations.unknown_cai
        self.refs_by_way = relations.refs_by_way
        self.rels_by_way = relations.rels_by_way
        self.glaciers, self.military = [], []
        self.factory = osmium.geom.WKBFactory()

    def area(self, a):
        tags = {t.k: t.v for t in a.tags}
        target = (self.glaciers if tags.get("natural") == "glacier"
                  else self.military if is_military(tags) else None)
        if target is None:
            return
        try:
            target.append(wkb.loads(self.factory.create_multipolygon(a), hex=True))
        except RuntimeError:
            pass  # poligono rotto in OSM: si salta


def tile_z13(lon, lat):
    n = 1 << 13
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def segment_tiles(a, b, step_m=100):
    k = math.cos(math.radians((a.lat + b.lat) / 2))
    d = math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320
    steps = max(1, int(d // step_m))
    for i in range(steps + 1):
        t = i / steps
        yield tile_z13(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t)


def length_m(nodes):
    nodes = list(nodes)   # WayNodeList di pyosmium 4 non si puo' affettare
    d = 0.0
    for a, b in zip(nodes, nodes[1:]):
        k = math.cos(math.radians((a.lat + b.lat) / 2))
        d += math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320
    return d


class Classify(osmium.SimpleHandler):
    """Passata 2: difficolta' effettiva e catene di sentieri sconosciuti."""

    def __init__(self, areas, db):
        super().__init__()
        self.areas, self.db = areas, db
        self.rows = []                     # righe della tabella laterale, scritte a blocchi
        self.origins = Counter()
        self.horse = 0
        self.glacier_tree = STRtree(areas.glaciers) if areas.glaciers else None
        self.military_tree = STRtree(areas.military) if areas.military else None
        self.factory = osmium.geom.WKBFactory()
        self.flags = {}                    # way_id -> intero compatto (vedi MILITARY, FERRATA, LONG)
        self.parent = {}                   # union-find sui nodi delle vie sconosciute
        self.unknown_len = {}              # way_id -> (lunghezza, primo nodo)
        self.tiles = set()                 # tile z13 dove GraphHopper chiedera' quote

    def find(self, x):
        while self.parent.setdefault(x, x) != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)

    def inside(self, tree, nodes):
        # la geometria si fa con i soli nodi presenti: dopo il ritaglio
        # (osmium extract --strategy simple) una via puo' citare nodi assenti
        if tree is None or not nodes:
            return False
        coords = [(n.lon, n.lat) for n in nodes]
        geom = LineString(coords) if len(coords) > 1 else Point(coords[0])
        return len(tree.query(geom, predicate="intersects")) > 0

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if "highway" not in tags:
            return
        nodes = [n for n in w.nodes if n.location.valid()]
        for a, b in zip(nodes, nodes[1:]):
            self.tiles.update(segment_tiles(a, b))
        glacier = self.inside(self.glacier_tree, nodes)
        military = self.inside(self.military_tree, nodes)
        via_ferrata = tags.get("highway") == "via_ferrata"
        cai_values = self.areas.cai_by_way.get(w.id, [])
        rating, origin = effective(cai_values, tags.get("cai_scale"), tags.get("sac_scale"),
                                   glacier, tags.get("trail_visibility"), via_ferrata)
        all_cai = cai_values + ([tags["cai_scale"]] if "cai_scale" in tags else [])
        cai = max(all_cai, key=lambda v: cai_to_rating(v) or 0, default=None)
        self.flags[w.id] = rating | (MILITARY if military else 0) | (FERRATA if origin == "via_ferrata" else 0)
        refs = ";".join(sorted(self.areas.refs_by_way.get(w.id, ()))) or None
        rel_ids = ";".join(str(i) for i in sorted(self.areas.rels_by_way.get(w.id, ()))) or None
        self.rows.append((w.id, cai, tags.get("sac_scale"), tags.get("horse_scale"), int(glacier), int(military),
                          tags.get("trail_visibility"), origin, 0, refs, rel_ids))
        self.origins[origin] += 1
        self.horse += "horse_scale" in tags
        if len(self.rows) >= 50_000:
            self.flush()
        if origin == "none" and tags.get("highway") == "path":
            ids = [n.ref for n in w.nodes]
            for a, b in zip(ids, ids[1:]):
                self.union(a, b)
            self.unknown_len[w.id] = (length_m(nodes), ids[0])

    def flush(self):
        self.db.executemany("insert into ways values (?,?,?,?,?,?,?,?,?,?,?)", self.rows)
        self.rows = []

    def mark_long_chains(self):
        total = defaultdict(float)
        for length, first in self.unknown_len.values():
            total[self.find(first)] += length
        long_roots = {r for r, t in total.items() if t > LONG_CHAIN_M}
        marked = []
        for way_id, (_, first) in self.unknown_len.items():
            if self.find(first) in long_roots:
                self.flags[way_id] |= LONG
                marked.append((way_id,))
        self.flush()
        self.db.executemany("update ways set long_chain = 1 where way_id = ?", marked)
        return len(long_roots)


class Write(osmium.SimpleHandler):
    """Passata 3: PBF arricchito."""

    def __init__(self, flags, writer):
        super().__init__()
        self.flags, self.writer = flags, writer

    def node(self, n):
        self.writer.add_node(n)

    def relation(self, r):
        self.writer.add_relation(r)

    def way(self, w):
        f = self.flags.get(w.id)
        if f is None:
            self.writer.add_way(w)
            return
        tags = {t.k: t.v for t in w.tags}
        sac = rating_to_sac(f & 7)
        if sac:
            tags["sac_scale"] = sac
        else:
            tags.pop("sac_scale", None)
        tags.pop("horse_scale", None)       # l'originale sta nella tabella laterale
        if f & FERRATA:
            tags["highway"] = "path"        # GraphHopper scarta via_ferrata per tutti i profili
        if f & LONG:
            tags["horse_scale"] = "impossible"
        if f & MILITARY:
            tags["access"] = "no"
        self.writer.add_way(w.replace(tags=tags))


def enrich(src, dst, db_path, tiles_path=None):
    # Passata 1 in due pezzi. Le relazioni escursionistiche non vogliono le
    # posizioni dei nodi; i poligoni si montano su un estratto con i soli
    # ghiacciai e zone militari: montarli sul file intero tiene in memoria
    # tutte le vie del file (248 MB sulla cella di Pisa, decine di GB sul
    # nazionale).
    relations = Relations()
    relations.apply_file(src, locations=False)
    areas = Areas(relations)
    with tempfile.TemporaryDirectory(dir=os.path.dirname(os.path.abspath(dst))) as tmp:
        only_areas = os.path.join(tmp, "aree.osm.pbf")
        subprocess.run(["osmium", "tags-filter", "--overwrite", "-o", only_areas, src,
                        "a/natural=glacier", "a/landuse=military", "a/military"], check=True,
                       stdout=subprocess.DEVNULL)
        areas.apply_file(only_areas, locations=True)

    db = sqlite3.connect(db_path)
    db.execute("drop table if exists ways")
    db.execute("create table ways (way_id integer primary key, cai text, sac text, horse text,"
               " glacier integer, military integer, visibility text, origin text, long_chain integer,"
               " refs text, rel_ids text)")
    classify = Classify(areas, db)
    classify.apply_file(src, locations=True, idx=NODE_INDEX)
    long_chains = classify.mark_long_chains()
    db.commit()
    db.close()

    writer = osmium.SimpleWriter(dst, overwrite=True)
    try:
        Write(classify.flags, writer).apply_file(src)
    finally:
        writer.close()

    if tiles_path:
        with open(tiles_path, "w") as f:
            f.writelines(f"{x}/{y}\n" for x, y in sorted(classify.tiles))

    return {"ways": len(classify.flags), **classify.origins, "glaciers": len(areas.glaciers),
            "military_areas": len(areas.military), "long_chains": long_chains,
            "horse_scale_originali": classify.horse, "tiles_z13": len(classify.tiles),
            "cai_unknown_values": dict(areas.unknown_cai)}


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        sys.exit("uso: enrich.py <in.pbf> <out.osm.pbf> <ways.sqlite> [tiles-z13.txt]")
    s = enrich(*sys.argv[1:])
    print(json.dumps(s, ensure_ascii=False))
    if s["cai_unknown_values"]:
        print("!! valori di cai_scale fuori tabella:", s["cai_unknown_values"], file=sys.stderr)
