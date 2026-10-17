// API routes with a stubbed coordinator: validation, error mapping and headers.
import { describe, expect, it, vi } from 'vitest';
import app from '../../worker/index';
import type { GateResult } from '../../worker/gate';

function makeEnv(overrides: Partial<Record<string, (...a: unknown[]) => Promise<GateResult>>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const okBody = JSON.stringify({
    provider: 'adsbfi',
    attribution: { name: 'adsb.fi', url: 'https://adsb.fi', license: 'x' },
    query: { lat: 51.3333, lon: -0.5351, radiusNm: 100 },
    providerNow: 1,
    fetchedAt: 1,
    servedAt: 1,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: 10000 },
    count: 0,
    aircraft: [],
  });
  const stub = new Proxy(
    {},
    {
      get: (_t, method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          if (overrides[method]) return overrides[method]!(...args);
          if (method === 'healthReport') return Promise.resolve({ startedAt: 1, providers: [], cacheEntries: 0 });
          return Promise.resolve({ ok: true, body: method === 'metar' || method === 'taf' ? '{"data":[]}' : okBody });
        },
    },
  );
  const env = {
    APP_VERSION: 'test',
    AIRCRAFT_CACHE_TTL_MS: '10000',
    CONTACT_URL: 'https://example.test',
    GATE: { idFromName: () => 'id', get: () => stub },
    ASSETS: { fetch: vi.fn(async () => new Response('not found', { status: 404 })) },
  } as unknown as Env;
  return { env, calls };
}

const get = (path: string, env: Env, ip = '203.0.113.1') =>
  app.request(path, { headers: { 'CF-Connecting-IP': ip } }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

describe('API routes', () => {
  it('health and config respond with JSON and security headers', async () => {
    const { env } = makeEnv();
    const h = await get('/api/health', env);
    expect(h.status).toBe(200);
    expect(h.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await h.json()) as object).toMatchObject({ status: 'ok', version: 'test' });
    const c = await get('/api/config', env);
    expect(((await c.json()) as { aircraft: { maxRadiusNm: number } }).aircraft.maxRadiusNm).toBe(250);
  });

  it('validates and snaps nearby queries before reaching the coordinator', async () => {
    const { env, calls } = makeEnv();
    expect((await get('/api/aircraft/nearby?lat=999&lon=0', env)).status).toBe(400);
    expect((await get('/api/aircraft/nearby?lat=abc&lon=0', env)).status).toBe(400);
    expect((await get('/api/aircraft/nearby', env)).status).toBe(400);
    expect(calls).toHaveLength(0);
    const r = await get('/api/aircraft/nearby?lat=51.47&lon=-0.45&radius=60', env);
    expect(r.status).toBe(200);
    expect(calls[0]).toMatchObject({ method: 'aircraftRegion', args: [{ lat: 51.3333, lon: -0.5335, radiusNm: 100 }] });
  });

  it('maps coordinator errors to HTTP status, code and Retry-After', async () => {
    const { env } = makeEnv({
      aircraftRegion: async () => ({ ok: false, status: 503, code: 'busy', message: 'Budget used', retryAfterSec: 3 }),
    });
    const r = await get('/api/aircraft/nearby?lat=10&lon=10', env);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('3');
    expect((await r.json()) as object).toEqual({ error: { code: 'busy', message: 'Budget used', retryAfterSec: 3 } });
  });

  it('validates aircraft identifiers and search queries', async () => {
    const { env, calls } = makeEnv();
    expect((await get('/api/aircraft/xyz', env)).status).toBe(400);
    expect((await get('/api/aircraft/~123456', env)).status).toBe(400);
    expect((await get('/api/aircraft/search?q=', env)).status).toBe(400);
    expect((await get('/api/aircraft/4066B9?raw=1', env)).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'aircraftLookup', args: ['hex', '4066b9', true] });
    const s = await get('/api/aircraft/search?q=baw123', env);
    expect(s.status).toBe(200);
    expect(((await s.json()) as { interpretedAs: unknown }).interpretedAs).toEqual({ kind: 'callsign', value: 'BAW123' });
  });

  it('validates weather requests (stations and bounded bbox only)', async () => {
    const { env, calls } = makeEnv();
    expect((await get('/api/weather/metar', env)).status).toBe(400);
    expect((await get('/api/weather/metar?ids=EGLL,<script>', env)).status).toBe(400);
    expect((await get('/api/weather/metar?bbox=0,0,40,40', env)).status).toBe(400); // too large
    expect((await get('/api/weather/metar?ids=kjfk,egll,egll', env)).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'metar', args: [{ ids: 'EGLL,KJFK' }] });
    expect((await get('/api/weather/metar?bbox=50.2,-1.7,52.9,1.1', env)).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'metar', args: [{ bbox: '50,-2,53,2' }] });
    expect((await get('/api/weather/taf?ids=EGLL', env)).status).toBe(200);
  });

  it('rejects non-GET methods and unknown routes, with no open proxy', async () => {
    const { env } = makeEnv();
    const post = await app.request('/api/aircraft/nearby?lat=1&lon=1', { method: 'POST' }, env);
    expect(post.status).toBe(405);
    expect((await get('/api/proxy?url=https://evil.example', env)).status).toBe(404);
  });

  it('rate-limits a single client', async () => {
    const { env } = makeEnv();
    let limited = 0;
    for (let i = 0; i < 120; i++) {
      const r = await get('/api/config', env, '198.51.100.7');
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('airport detail validates identifiers and 404s cleanly', async () => {
    const { env } = makeEnv();
    expect((await get('/api/airports/%3Cx%3E', env)).status).toBe(400);
    expect((await get('/api/airports/ZZZZ', env)).status).toBe(404);
  });
});
