// UpstreamGate — the single, globally-unique coordinator for every upstream call.
//
// Cloudflare runs exactly one instance of a Durable Object per id, and we only
// ever use the id "global". That makes this the one place on Earth where requests
// to AviationWeather.gov leave our infrastructure, so the request budget below is
// a TRUE global ceiling, not a per-datacenter counter.
//
// Aircraft are simulated entirely in the browser; this coordinator never
// contacts any aircraft data source.
//
//   • Pacing: calls to each host are spaced by a minimum interval.
//   • Coalescing: identical concurrent requests share one upstream call.
//   • Caching: reports are shared by every visitor for a TTL.
//   • Back-off: 429/5xx/timeouts open a circuit breaker with exponential delay.
//   • Degraded mode: while the circuit is open, or the queue is full, an older
//     response is served with a `degraded` reason — never fabricated data.

import { DurableObject } from 'cloudflare:workers';
import type { ProviderHealth } from '../shared/types';
import { normalizeMetar, normalizeTaf } from '../shared/weather';
import { AWC_ATTRIBUTION, USER_AGENT } from './providers';

export type GateResult =
  | { ok: true; body: string }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

const STATUS: Record<UpstreamError['code'], number> = {
  busy: 503,
  upstream_unavailable: 503,
  upstream_rate_limited: 503,
  upstream_forbidden: 503,
  upstream_invalid: 502,
  not_found: 404,
};

async function guard(fn: () => Promise<string>): Promise<GateResult> {
  try {
    return { ok: true, body: await fn() };
  } catch (e) {
    if (e instanceof UpstreamError) {
      const r: GateResult = { ok: false, status: STATUS[e.code], code: e.code, message: e.message };
      if (e.retryAfterSec !== undefined) r.retryAfterSec = e.retryAfterSec;
      return r;
    }
    console.error('gate: unexpected error', e);
    return { ok: false, status: 500, code: 'internal', message: 'Unexpected server error.' };
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly code: 'busy' | 'upstream_unavailable' | 'upstream_rate_limited' | 'upstream_forbidden' | 'upstream_invalid' | 'not_found',
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

interface Pacer {
  intervalMs: number;
  nextSlotAt: number;
  queued: number;
}

interface CacheEntry {
  json: string; // serialized normalized payload
  count: number;
  fetchedAt: number;
}

const MAX_QUEUE_WAIT_MS = 4000;
// A provider that refuses us (401/403) is asked again only rarely, so we never
// keep hammering its firewall.
const FORBIDDEN_COOLDOWN_MS = 15 * 60_000;
const FORBIDDEN_MESSAGE: Record<HostId, string> = {
  aviationweather: 'AviationWeather.gov is currently refusing requests from this site’s hosting network.',
};
// How long past its TTL a cached response may still be served (flagged) while
// the provider is failing or the request budget is exhausted.
const MAX_STALE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 300;
const UPSTREAM_TIMEOUT_MS = 8000;

type HostId = 'aviationweather';

export class UpstreamGate extends DurableObject<Env> {
  private pacers: Record<HostId, Pacer>;
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<CacheEntry>>();
  private health: Record<HostId, ProviderHealth> = {
    aviationweather: { id: 'aviationweather', status: 'unknown', consecutiveFailures: 0, upstreamCalls: 0, cacheHits: 0 },
  };
  private startedAt = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.pacers = {
      aviationweather: {
        intervalMs: clampInt(env.WEATHER_MIN_INTERVAL_MS, 1500, 700, 60_000),
        nextSlotAt: 0,
        queued: 0,
      },
    };
  }

  // ---------------------------------------------------------------- RPC API
  // Errors do not keep their custom fields across the RPC boundary, so every
  // public method returns a GateResult instead of throwing.

  metar(params: { ids?: string; bbox?: string }): Promise<GateResult> {
    const qs = params.ids ? `ids=${params.ids}` : `bbox=${params.bbox}`;
    const ttl = params.ids ? 5 * 60_000 : 10 * 60_000;
    return guard(() =>
      this.weather(`metar:${qs}`, `https://aviationweather.gov/api/data/metar?${qs}&format=json`, ttl, normalizeMetar),
    );
  }

  taf(ids: string): Promise<GateResult> {
    return guard(() =>
      this.weather(`taf:${ids}`, `https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`, 15 * 60_000, normalizeTaf),
    );
  }

  async healthReport(): Promise<{ startedAt: number; providers: ProviderHealth[]; cacheEntries: number }> {
    const now = Date.now();
    const providers = Object.values(this.health).map((h) => {
      const out = { ...h };
      if (h.circuitOpenUntil && h.circuitOpenUntil > now) out.status = 'down';
      return out;
    });
    return { startedAt: this.startedAt, providers, cacheEntries: this.cache.size };
  }

  // ---------------------------------------------------------------- internals

  private async weather<T>(key: string, url: string, ttl: number, normalize: (r: unknown) => T | null): Promise<string> {
    const { entry, hit, degraded } = await this.cached('aviationweather', key, ttl, async () => {
      const res = await this.upstream('aviationweather', url);
      // AviationWeather answers "no data" with 204 / empty body.
      const text = res.status === 204 ? '[]' : await res.text();
      let body: unknown;
      try {
        body = text.trim() ? JSON.parse(text) : [];
      } catch {
        throw new UpstreamError('Weather provider returned malformed data.', 'upstream_invalid');
      }
      if (!Array.isArray(body)) throw new UpstreamError('Weather provider returned an unexpected shape.', 'upstream_invalid');
      const data = body.map(normalize).filter((x): x is T => x !== null);
      return { json: JSON.stringify(data), count: data.length, fetchedAt: Date.now() };
    });
    const now = Date.now();
    const meta: Record<string, unknown> = {
      provider: 'aviationweather',
      attribution: AWC_ATTRIBUTION,
      fetchedAt: entry.fetchedAt,
      servedAt: now,
      cache: { hit, ageMs: now - entry.fetchedAt, ttlMs: ttl },
      count: entry.count,
    };
    if (degraded) meta.degraded = degraded;
    return `${JSON.stringify(meta).slice(0, -1)},"data":${entry.json}}`;
  }

  /** Cache + coalescing + stale fallback around a loader. */
  private async cached(
    host: HostId,
    key: string,
    ttl: number,
    load: () => Promise<CacheEntry>,
  ): Promise<{ entry: CacheEntry; hit: boolean; degraded?: string }> {
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && now - existing.fetchedAt < ttl) {
      this.health[host].cacheHits++;
      return { entry: existing, hit: true };
    }

    let promise = this.inflight.get(key);
    const coalesced = !!promise;
    if (!promise) {
      promise = load().then((entry) => {
        this.cache.delete(key); // refresh LRU position
        this.cache.set(key, entry);
        this.evict();
        return entry;
      });
      this.inflight.set(key, promise);
      promise.then(
        () => this.inflight.delete(key),
        () => this.inflight.delete(key),
      );
    }

    try {
      const entry = await promise;
      return { entry, hit: coalesced };
    } catch (err) {
      // Serve the last good response rather than nothing — clearly flagged.
      if (existing && now - existing.fetchedAt < ttl + MAX_STALE_MS) {
        const reason =
          err instanceof UpstreamError && err.code === 'busy'
            ? 'High demand: showing the most recent shared report.'
            : 'Provider temporarily unavailable: showing the last good report.';
        return { entry: existing, hit: true, degraded: reason };
      }
      throw err;
    }
  }

  private evict() {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** Paced, timed-out, circuit-broken upstream GET. */
  private async upstream(host: HostId, url: string): Promise<Response> {
    const h = this.health[host];
    const now = Date.now();
    if (h.circuitOpenUntil && h.circuitOpenUntil > now) {
      const retry = Math.ceil((h.circuitOpenUntil - now) / 1000);
      if (h.lastError?.startsWith('Access refused')) throw new UpstreamError(FORBIDDEN_MESSAGE[host], 'upstream_forbidden', retry);
      throw new UpstreamError('Provider is cooling down after errors.', 'upstream_unavailable', retry);
    }

    // Reserve the next free slot for this host. The Durable Object is single-
    // threaded, so this read-modify-write cannot race.
    const p = this.pacers[host];
    const slot = Math.max(now, p.nextSlotAt);
    const wait = slot - now;
    if (wait > MAX_QUEUE_WAIT_MS) {
      throw new UpstreamError('Upstream request budget is fully used right now.', 'busy', Math.ceil(wait / 1000));
    }
    p.nextSlotAt = slot + p.intervalMs;
    p.queued++;
    try {
      if (wait > 0) await sleep(wait);
    } finally {
      p.queued--;
    }

    h.upstreamCalls++;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      this.fail(host, (e as Error).name === 'TimeoutError' ? 'Timed out' : 'Network error');
      throw new UpstreamError('Provider did not respond in time.', 'upstream_unavailable', 10);
    }

    if (res.status === 404) {
      this.succeed(host);
      throw new UpstreamError('Not found at provider.', 'not_found');
    }
    if (res.status === 401 || res.status === 403) {
      const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ');
      const title = /<title>(.*?)<\/title>/i.exec(text)?.[1];
      console.warn(`upstream ${host} refused access (HTTP ${res.status})`, { cfRay: res.headers.get('cf-ray'), title, excerpt: title ? undefined : text.slice(0, 300) });
      h.consecutiveFailures++;
      h.lastErrorAt = Date.now();
      h.lastError = `Access refused (HTTP ${res.status}${title ? `: ${title}` : ''})`;
      h.status = 'down';
      h.circuitOpenUntil = Date.now() + FORBIDDEN_COOLDOWN_MS;
      throw new UpstreamError(FORBIDDEN_MESSAGE[host], 'upstream_forbidden', FORBIDDEN_COOLDOWN_MS / 1000);
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After'));
      const retry = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 600) : undefined;
      this.fail(host, 'Rate limited (429)', retry);
      throw new UpstreamError('Provider rate limit reached; backing off.', 'upstream_rate_limited', retry ?? 30);
    }
    if (!res.ok && res.status !== 204) {
      console.warn(`upstream ${host} HTTP ${res.status}`, { cfRay: res.headers.get('cf-ray') });
      this.fail(host, `HTTP ${res.status}`);
      throw new UpstreamError(`Provider error (HTTP ${res.status}).`, 'upstream_unavailable', 15);
    }
    this.succeed(host);
    return res;
  }

  private succeed(host: HostId) {
    const h = this.health[host];
    h.status = 'ok';
    h.lastSuccessAt = Date.now();
    h.consecutiveFailures = 0;
    delete h.circuitOpenUntil;
  }

  private fail(host: HostId, reason: string, retryAfterSec?: number) {
    const h = this.health[host];
    h.consecutiveFailures++;
    h.lastErrorAt = Date.now();
    h.lastError = reason;
    h.status = 'degraded';
    // Exponential back-off: 2 s, 4 s, 8 s … capped at 2 minutes, or the provider's Retry-After.
    const backoff = Math.min(120_000, 2000 * 2 ** (h.consecutiveFailures - 1));
    const delay = retryAfterSec ? Math.max(retryAfterSec * 1000, backoff) : h.consecutiveFailures >= 2 ? backoff : 0;
    if (delay > 0) h.circuitOpenUntil = Date.now() + delay;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
