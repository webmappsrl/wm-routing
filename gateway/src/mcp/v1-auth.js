// Le rotte /v1 vogliono la credenziale. Anche le chiamate che il server MCP fa
// al gateway escono dal processo e rientrano dalla porta, quindi la portano.
export function intestazioneV1(v1Token) {
  return v1Token ? {Authorization: `Bearer ${v1Token}`} : {};
}
