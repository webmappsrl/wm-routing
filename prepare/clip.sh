#!/usr/bin/env bash
# Ritaglia il PBF sul rettangolo del DEM di wm-tiles con un margine interno:
# fuori dal DEM GraphHopper non ha quote e mette 0 in silenzio. La strategia e'
# simple, che taglia le vie al rettangolo: complete_ways le terrebbe intere e
# lungo il bordo sporgerebbero oltre il DEM (provato sulla cella di Pisa: 3
# tile senza quote). Le relazioni restano, con i soli pezzi dentro, e la
# cai_scale arriva comunque alle vie dentro.
set -euo pipefail
BBOX="${WM_GRAPH_BBOX:?serve WM_GRAPH_BBOX, da tools/bbox.sh}"
osmium extract --bbox "$BBOX" --strategy simple --set-bounds \
  --overwrite -o "$2" "$1"
