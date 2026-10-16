// Il CORS ferma l'uso da siti altrui nel browser, non chi chiama da un
// programma: per quello c'e' il limite di richieste (overview, "Servizio pubblico").
export function corsHeaders(shard, origin) {
  if (!origin || !shard.origins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
