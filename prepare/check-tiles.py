"""Ogni tile z13 toccata dalle vie deve esistere nel PMTiles delle quote:
altrimenti GraphHopper mette quota 0 in silenzio (OSMReader.java:186).
Uso: check-tiles.py <tiles-z13.txt> <terrain.pmtiles>"""
import sys
from pmtiles.reader import MmapSource, Reader

with open(sys.argv[2], "rb") as f:
    reader = Reader(MmapSource(f))
    missing = []
    for line in open(sys.argv[1]):
        x, y = map(int, line.split("/"))
        if reader.get(13, x, y) is None:
            missing.append(f"13/{x}/{y}")
if missing:
    sys.exit(f"!! {len(missing)} tile z13 senza quote, prime: {missing[:20]}")
print("quote presenti per tutte le vie")
