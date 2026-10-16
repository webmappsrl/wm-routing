export function createEngine(baseUrl, fetchImpl = fetch) {
  async function call(path, init) {
    const res = await fetchImpl(baseUrl + path, init);   // un errore di rete sale al chiamante
    return {ok: res.ok, status: res.status, json: await res.json().catch(() => ({}))};
  }
  return {
    route: body => call('/route', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify(body)}),
    match: (gpx, profile) => call(`/match?profile=${encodeURIComponent(profile)}&points_encoded=false`,
                                  {method: 'POST', headers: {'Content-Type': 'application/gpx+xml'}, body: gpx}),
  };
}
