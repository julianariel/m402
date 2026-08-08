import type { ProbeOrigin } from './routes.js';

type CacheEntry = { healthy: boolean; expiresAt: number };

export function createHealthProbe(ttlMs = 5000): ProbeOrigin {
  const cache = new Map<string, CacheEntry>();

  return async function probeOrigin(target) {
    const now = Date.now();
    const cached = cache.get(target);
    if (cached && cached.expiresAt > now) return cached.healthy;

    let healthy: boolean;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      // HEAD, not GET: this only asks "is something listening and not
      // erroring", not "does this exact route respond" — a 405 from an
      // origin that doesn't support HEAD still counts as reachable.
      const res = await fetch(target, { method: 'HEAD', signal: controller.signal });
      healthy = res.status < 500;
    } catch {
      healthy = false;
    } finally {
      clearTimeout(timer);
    }

    cache.set(target, { healthy, expiresAt: now + ttlMs });
    return healthy;
  };
}
