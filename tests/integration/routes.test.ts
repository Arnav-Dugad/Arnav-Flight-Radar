// API routes with a stubbed coordinator: validation, error mapping and headers.
import { describe, expect, it, vi } from 'vitest';
import app from '../../worker/index';
import type { GateResult } from '../../worker/gate';

const MANIFEST_DESCRIPTION = 'A simulated world of air traffic — real airlines, airports and aircraft types on a premium radar map.';
const SHORTCUT_ICON = [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }];

function makeEnv(overrides: Partial<Record<string, (...a: unknown[]) => Promise<unknown>>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const stub = new Proxy(
    {},
    {
      get: (_t, method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          if (overrides[method]) return overrides[method]!(...args);
          if (method === 'healthReport')
            return Promise.resolve({
              startedAt: 1,
              providers: [{ id: 'aviationweather', status: 'ok', consecutiveFailures: 0, upstreamCalls: 1, cacheHits: 0 }],
              cacheEntries: 1,
            });
          if (method === 'metar' || method === 'taf') return Promise.resolve<GateResult>({ ok: true, body: '{"data":[]}' });
          return Promise.reject(new Error(`unexpected gate method ${method}`));
        },
    },
  );
  const env = {
    APP_VERSION: 'test',
    CONTACT_URL: 'https://example.test',
    GATE: { idFromName: () => 'id', get: () => stub },
    ASSETS: { fetch: vi.fn(async () => new Response('not found', { status: 404 })) },
  } as unknown as Env;
  return { env, calls };
}

const get = (path: string, env: Env, ip = '203.0.113.1') =>
  app.request(path, { headers: { 'CF-Connecting-IP': ip } }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

describe('API routes', () => {
  it('health reports only the weather provider and stays ok', async () => {
    const { env } = makeEnv();
    const h = await get('/api/health', env);
    expect(h.status).toBe(200);
    expect(h.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.headers.get('Cache-Control')).toBe('no-store');
    const body = (await h.json()) as { status: string; version: string; providers: { id: string }[] };
    expect(body).toMatchObject({ status: 'ok', version: 'test', coordinator: { startedAt: 1, cacheEntries: 1 } });
    expect(body.providers.map((p) => p.id)).toEqual(['aviationweather']);
  });

  it('health degrades gracefully when the coordinator is unavailable', async () => {
    const { env } = makeEnv({ healthReport: () => Promise.reject(new Error('down')) });
    const h = await get('/api/health', env);
    expect(h.status).toBe(200);
    expect((await h.json()) as object).toMatchObject({ status: 'degraded', coordinator: null, providers: [] });
  });

  it('config carries no live-aircraft settings', async () => {
    const { env } = makeEnv();
    const c = await get('/api/config', env);
    expect(c.status).toBe(200);
    const body = (await c.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ version: 'test', aircraft: { source: 'simulation' }, source: 'https://example.test' });
    expect(JSON.stringify(body)).not.toMatch(/adsb|maxRadiusNm|sharedSnapshotTtlMs|pollInterval/i);
  });

  it('providers list the simulation and no live aircraft sources', async () => {
    const { env } = makeEnv();
    const r = await get('/api/providers', env);
    expect(r.status).toBe(200);
    const { providers } = (await r.json()) as { providers: { id: string; kind: string; enabled: boolean }[] };
    const ids = providers.map((p) => p.id);
    for (const kept of ['simulation', 'aviationweather', 'ourairports', 'openfreemap', 'terrain', 'rainviewer', 'openflights', 'wikimedia', 'openaip', 'osm-ground', 'faa-airspace', 'nasa-gibs'])
      expect(ids).toContain(kept);
    for (const gone of ['adsbfi', 'adsblol', 'opensky', 'planespotters']) expect(ids).not.toContain(gone);
    expect(providers.find((p) => p.id === 'simulation')).toMatchObject({ name: 'Simulated air traffic', kind: 'aircraft', enabled: true });
    expect(JSON.stringify(providers)).not.toMatch(/adsb\.fi|opendata\.adsb|planespotters/i);
  });

  it('live-aircraft routes are gone and never reach the coordinator', async () => {
    const { env, calls } = makeEnv();
    for (const path of [
      '/api/aircraft/nearby?lat=51.47&lon=-0.45&radius=60',
      '/api/aircraft/search?q=baw123',
      '/api/aircraft/4066b9',
      '/api/analytics/region?lat=51.47&lon=-0.45',
    ]) {
      const r = await get(path, env);
      expect(r.status).toBe(404);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('not_found');
    }
    expect(calls).toHaveLength(0);
  });

  it('maps coordinator errors to HTTP status, code and Retry-After', async () => {
    const { env } = makeEnv({
      metar: async () => ({ ok: false, status: 503, code: 'busy', message: 'Budget used', retryAfterSec: 3 }),
    });
    const r = await get('/api/weather/metar?ids=EGLL', env);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('3');
    expect((await r.json()) as object).toEqual({ error: { code: 'busy', message: 'Budget used', retryAfterSec: 3 } });
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
    const taf = await get('/api/weather/taf?ids=EGLL', env);
    expect(taf.status).toBe(200);
    expect(taf.headers.get('Cache-Control')).toBe('public, max-age=120');
    expect(calls.at(-1)).toMatchObject({ method: 'taf', args: ['EGLL'] });
    expect((await get('/api/weather/taf', env)).status).toBe(400);
  });

  it('manifest: valid pins become shortcuts', async () => {
    const { env, calls } = makeEnv();
    const r = await get('/api/manifest.webmanifest?pins=egll,KJFK', env);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/manifest+json');
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const m = (await r.json()) as Record<string, unknown> & { icons: unknown[]; shortcuts: unknown[] };
    expect(m).toMatchObject({
      name: 'Arnav Flight Radar',
      short_name: 'Arnav Radar',
      start_url: '/',
      display: 'standalone',
      background_color: '#03060B',
      theme_color: '#03060B',
      description: MANIFEST_DESCRIPTION,
    });
    expect(m.icons).toHaveLength(3);
    expect(m.shortcuts).toEqual([
      { name: 'EGLL board', short_name: 'EGLL', url: '/?apt=EGLL', icons: SHORTCUT_ICON },
      { name: 'KJFK board', short_name: 'KJFK', url: '/?apt=KJFK', icons: SHORTCUT_ICON },
    ]);
    // Built from constants only: no coordinator call, no asset fetch.
    expect(calls).toHaveLength(0);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('manifest: invalid pins are dropped and never echoed', async () => {
    const { env } = makeEnv();
    const pins = encodeURIComponent('<script>,TOOLONGIDENT1,EGLL,a b,"x",,javascript:alert(1)');
    const r = await get(`/api/manifest.webmanifest?pins=${pins}`, env);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toMatch(/<script|SCRIPT>|TOOLONG|alert|javascript/i);
    const m = JSON.parse(text) as { shortcuts: { short_name: string }[] };
    expect(m.shortcuts.map((s) => s.short_name)).toEqual(['EGLL']);
    const none = (await (await get('/api/manifest.webmanifest', env)).json()) as { shortcuts: unknown[] };
    expect(none.shortcuts).toEqual([]);
    const junk = (await (await get('/api/manifest.webmanifest?pins=%3Cscript%3E,TOOLONGIDENT1', env)).json()) as { shortcuts: unknown[] };
    expect(junk.shortcuts).toEqual([]);
  });

  it('manifest: pins are deduplicated and capped at four', async () => {
    const { env } = makeEnv();
    const r = await get('/api/manifest.webmanifest?pins=EGLL,egll,KJFK,LFPG,EDDF,RJTT,YSSY', env);
    const m = (await r.json()) as { shortcuts: { short_name: string }[] };
    expect(m.shortcuts.map((s) => s.short_name)).toEqual(['EGLL', 'KJFK', 'LFPG', 'EDDF']);
  });

  it('rejects non-GET methods and unknown routes, with no open proxy', async () => {
    const { env } = makeEnv();
    const post = await app.request('/api/weather/metar?ids=EGLL', { method: 'POST' }, env);
    expect(post.status).toBe(405);
    expect((await get('/api/proxy?url=https://evil.example', env)).status).toBe(404);
    expect((await get('/api/manifest.webmanifest?url=https://evil.example', env)).status).toBe(200);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
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
