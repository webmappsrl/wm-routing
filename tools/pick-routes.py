"""Uso: pick-routes.py <area.osm.pbf> <n> > compare/routes.json"""
import json
import math
import random
import sys

import osmium


class Rels(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = set()

    def relation(self, r):
        if r.tags.get("route") == "hiking":
            self.ways.update(m.ref for m in r.members if m.type == "w")


class Mid(osmium.SimpleHandler):
    def __init__(self, ways):
        super().__init__()
        self.ways, self.coords = ways, []

    def way(self, w):
        if w.id in self.ways:
            n = w.nodes[len(w.nodes) // 2]
            if n.location.valid():
                self.coords.append((round(n.lon, 5), round(n.lat, 5)))


def dist_km(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111.32


rels = Rels()
rels.apply_file(sys.argv[1])
mid = Mid(rels.ways)
mid.apply_file(sys.argv[1], locations=True)
pts = sorted(set(mid.coords))
rnd, out, tries = random.Random(42), [], 0
while len(out) < int(sys.argv[2]) and tries < 100_000:
    tries += 1
    a, b = rnd.sample(pts, 2)
    if 2 <= dist_km(a, b) <= 8:
        out.append({"id": f"p{len(out) + 1:02d}", "points": [a, b],
                    "nuovo": "escursionista", "produzione": "hike"})
json.dump(out, sys.stdout, indent=1)
