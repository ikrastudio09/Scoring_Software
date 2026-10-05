/**
 * Tiny TTL cache with in-flight de-duplication, for public list endpoints. Under a crowd of
 * viewers this turns N identical queries per second into one. Live scores do not depend on it
 * (they come from the in-memory match runtime and the socket feed).
 */
export function ttlCache(ttlMs) {
  const entries = new Map();
  return {
    async get(key, fn) {
      const hit = entries.get(key);
      const now = Date.now();
      if (hit && (hit.pending || now - hit.at < ttlMs)) return hit.pending || hit.value;
      const pending = fn();
      entries.set(key, { pending, at: now });
      try {
        const value = await pending;
        entries.set(key, { value, at: Date.now() });
        return value;
      } catch (err) {
        entries.delete(key);
        throw err;
      }
    },
    clear() { entries.clear(); },
  };
}
