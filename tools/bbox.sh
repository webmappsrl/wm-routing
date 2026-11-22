# Rettangolo del grafo. Non e' una scelta geografica: lo detta il DEM delle
# quote di wm-tiles (`6.6,35.4,18.6,47.1`, letti da terrain.pmtiles), perche'
# fuori dal DEM GraphHopper mette quota 0 in silenzio.
#
# Il margine interno era di 0,05 gradi su ogni lato, e tagliava l'Italia di un
# soffio: il punto piu' a ovest del Piemonte sta a 6,6273 e quello piu' a nord
# del Trentino a 47,0921, cioe' 1,8 km e 4,7 km dentro il taglio. Le loro
# relation non si chiudevano, osmium le scartava, e due regioni su venti
# mancavano da /areas. A ovest e a nord il margine e' percio' stretto quanto
# basta a tenerle: restano 800 m dal bordo del DEM a ovest e 550 m a nord, meno
# di una tile z13 (0,044 gradi), quindi i punti al bordo cadono comunque in
# tile che il DEM contiene. Sud ed est non toccano nessuna regione e restano
# com'erano.
#
# Se il margine fosse troppo stretto non lo si scopre in produzione:
# prepare/check-tiles.py pretende che ogni tile toccata dalle vie abbia quote e
# ferma il build. Si legge con `source tools/bbox.sh`.
export WM_GRAPH_BBOX="${WM_GRAPH_BBOX:-6.61,35.45,18.55,47.095}"
