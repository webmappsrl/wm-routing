export function createRateLimiter({capacity, perSecond, now = Date.now}) {
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? {tokens: capacity, at: t};
      b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * perSecond);
      b.at = t;
      const ok = b.tokens >= 1;
      if (ok) b.tokens -= 1;
      buckets.set(key, b);
      return ok;
    },
  };
}
