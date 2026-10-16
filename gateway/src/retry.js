// Durante lo scambio notturno il motore riparte (20-40 s): invece di
// rispondere "riprova" si ripete la chiamata fino a 60 s (overview, "Scambio
// del grafo").
export async function withRetry(fn, {timeoutMs = 60000, stepMs = 2000,
  sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now} = {}) {
  const end = now() + timeoutMs;
  for (;;) {
    try {
      const r = await fn();
      if (r.status < 500 || now() >= end) return r;
    } catch (e) {
      if (now() >= end) throw e;
    }
    await sleep(stepMs);
  }
}
