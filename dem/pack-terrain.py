"""Raccoglie le tile Terrarium di wm-tiles di un solo livello in un PMTiles per
GraphHopper, che legge le quote da un livello solo (PMTilesElevationProvider,
riga 168). Stesse quote dell'ombreggiatura, nessun ricampionamento.

Uso: pack-terrain.py <cartella z/x/y.png> <out.pmtiles> <z> <W,S,E,N>
"""
import math
import os
import sys

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

src, dst, z = sys.argv[1], sys.argv[2], int(sys.argv[3])
w, s, e, n = (float(v) for v in sys.argv[4].split(","))
zdir = os.path.join(src, str(z))
if not os.path.isdir(zdir):
    sys.exit(f"!! manca il livello {z} in {src}")


def tile_xy(lon, lat):
    k = 1 << z
    return (int((lon + 180) / 360 * k),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * k))


# solo le tile che toccano il rettangolo: la cartella di wm-tiles e' l'Italia intera
x0, y0 = tile_xy(w, n)
x1, y1 = tile_xy(e, s)
tiles = sorted(
    (zxy_to_tileid(z, int(x), int(name[:-4])), os.path.join(zdir, x, name))
    for x in os.listdir(zdir) if x.isdigit() and x0 <= int(x) <= x1
    for name in os.listdir(os.path.join(zdir, x))
    if name.endswith(".png") and y0 <= int(name[:-4]) <= y1)
if not tiles:
    sys.exit(f"!! nessuna tile in {zdir}")
with open(dst, "wb") as f:
    wr = Writer(f)
    for tid, path in tiles:
        with open(path, "rb") as t:
            wr.write_tile(tid, t.read())
    wr.finalize(
        {"tile_type": TileType.PNG, "tile_compression": Compression.NONE,
         "min_zoom": z, "max_zoom": z,
         "min_lon_e7": int(w * 1e7), "min_lat_e7": int(s * 1e7),
         "max_lon_e7": int(e * 1e7), "max_lat_e7": int(n * 1e7),
         "center_zoom": z, "center_lon_e7": int((w + e) / 2 * 1e7),
         "center_lat_e7": int((s + n) / 2 * 1e7)},
        {"encoding": "terrarium", "attribution": "TINITALY, Copernicus GLO-30"})
print(f"{len(tiles)} tile z{z} scritte in {dst}")
