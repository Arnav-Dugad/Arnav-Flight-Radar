// Arnav Flight Radar — API Worker.
//
// Only /api/* reaches this code (see run_worker_first in wrangler.jsonc); the
// React app is served directly from static assets. There is deliberately no
// generic proxy: every upstream URL is built from a fixed template plus
// validated parameters, inside the UpstreamGate Durable Object.

import { Hono, type Context } from 'hono';
import { decodeRow, detailShard, IDENT_RE, makeSearchable, searchAirports, type AirportRow, type SearchableAirport } from '../shared/airports';
import { isValidLat, isValidLon } from '../shared/geo';
import { classifyAircraftQuery, type AircraftQueryKind } from '../shared/query';
import { MAX_RADIUS_NM, normalizeRegion, RegionError } from '../shared/region';
import { computeStats } from '../shared/stats';
import type { AircraftResponse, ApiError } from '../shared/types';
import { STATION_RE } from '../shared/weather';
import type { GateResult, UpstreamGate } from './gate';
import { PROVIDERS } from './providers';

export { UpstreamGate } from './gate';

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

const gate = (env: Env) => env.GATE.get(env.GATE.idFromName('global')) as unknown as DurableObjectStub<UpstreamGate>;

// ---------------------------------------------------------------- middleware

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

// Best-effort per-client limiter (per isolate). The hard guarantee for upstream
// providers is the global pacing inside UpstreamGate; this only blunts one client
// hammering the API.
const buckets = new Map<string, { tokens: number; at: number }>();
const BUCKET_SIZE = 90;
const REFILL_PER_SEC = 1;

function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: BUCKET_SIZE, at: now };
  b.tokens = Math.min(BUCKET_SIZE, b.tokens + ((now - b.at) / 1000) * REFILL_PER_SEC);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return err(c, 405, 'method_not_allowed', 'Only GET is supported.');
  }
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!allow(ip)) return err(c, 429, 'rate_limited', 'Too many requests. Please slow down.', 15);
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
});

app.onError((e, c) => {
  console.error('api error', e);
  return err(c, 500, 'internal', 'Unexpected server error.');
});

app.notFound((c) => err(c, 404, 'not_found', 'Unknown API route.'));

function err(c: Context<AppEnv>, status: number, code: string, message: string, retryAfterSec?: number) {
  const body: ApiError = { error: { code, message } };
  if (retryAfterSec !== undefined) body.error.retryAfterSec = retryAfterSec;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (retryAfterSec !== undefined) headers['Retry-After'] = String(retryAfterSec);
  return c.json(body, status as 400, headers);
}

function fromGate(c: Context<AppEnv>, r: GateResult, cacheControl = 'no-store') {
  if (!r.ok) return err(c, r.status, r.code, r.message, r.retryAfterSec);
  return new Response(r.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  });
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '' || v.length > 20) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------- meta

app.get('/api/health', async (c) => {
  let gateHealth: Awaited<ReturnType<UpstreamGate['healthReport']>> | null = null;
  try {
    gateHealth = await gate(c.env).healthReport();
  } catch (e) {
    console.error('health: gate unavailable', e);
  }
  return c.json(
    {
      status: gateHealth ? 'ok' : 'degraded',
      version: c.env.APP_VERSION,
      time: Date.now(),
      coordinator: gateHealth ? { startedAt: gateHealth.startedAt, cacheEntries: gateHealth.cacheEntries } : null,
      providers: gateHealth?.providers ?? [],
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

app.get('/api/config', (c) =>
  c.json(
    {
      version: c.env.APP_VERSION,
      aircraft: {
        maxRadiusNm: MAX_RADIUS_NM,
        pollIntervalSec: { min: 10, default: 15, max: 60 },
        sharedSnapshotTtlMs: Number(c.env.AIRCRAFT_CACHE_TTL_MS),
        freshness: { liveSec: 30, staleSec: 60, lostAfterSec: 90 },
      },
      units: {
        altitude: 'ft',
        groundSpeed: 'kt',
        verticalRate: 'ft/min',
        track: 'deg true',
        distance: 'NM',
        time: 'epoch ms UTC',
      },
      source: c.env.CONTACT_URL,
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  ),
);

app.get('/api/providers', (c) => c.json({ providers: PROVIDERS }, 200, { 'Cache-Control': 'public, max-age=3600' }));

// ---------------------------------------------------------------- aircraft

function readRegion(c: Context<AppEnv>) {
  const lat = parseNumber(c.req.query('lat'));
  const lon = parseNumber(c.req.query('lon'));
  const radius = parseNumber(c.req.query('radius')) ?? 100;
  if (!isValidLat(lat) || !isValidLon(lon)) throw new RegionError('lat must be −90…90 and lon −180…180.');
  return normalizeRegion(lat, lon, radius);
}

app.get('/api/aircraft/nearby', async (c) => {
  let q;
  try {
    q = readRegion(c);
  } catch (e) {
    return err(c, 400, 'invalid_region', (e as Error).message);
  }
  return fromGate(c, await gate(c.env).aircraftRegion(q));
});

app.get('/api/aircraft/search', async (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 20);
  const forceRaw = c.req.query('type');
  const force = (['hex', 'callsign', 'registration', 'sqk'] as const).find((k) => k === forceRaw) as
    | AircraftQueryKind
    | undefined;
  const parsed = classifyAircraftQuery(q, force);
  if (!parsed) return err(c, 400, 'invalid_query', 'Enter a callsign, registration, ICAO hex address or squawk code.');
  const r = await gate(c.env).aircraftLookup(parsed.kind, parsed.value, false);
  if (!r.ok) return fromGate(c, r);
  // Tag the interpretation so the UI can offer alternatives.
  return new Response(`{"interpretedAs":${JSON.stringify(parsed)},${r.body.slice(1)}`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});

app.get('/api/aircraft/:icao', async (c) => {
  const hex = c.req.param('icao').toLowerCase();
  if (!/^~?[0-9a-f]{6}$/.test(hex)) return err(c, 400, 'invalid_icao', 'ICAO address must be 6 hexadecimal characters.');
  if (hex.startsWith('~')) return err(c, 400, 'non_icao', 'Non-ICAO (TIS-B) addresses cannot be looked up individually.');
  return fromGate(c, await gate(c.env).aircraftLookup('hex', hex, c.req.query('raw') === '1'));
});

app.get('/api/analytics/region', async (c) => {
  let q;
  try {
    q = readRegion(c);
  } catch (e) {
    return err(c, 400, 'invalid_region', (e as Error).message);
  }
  const r = await gate(c.env).aircraftRegion(q);
  if (!r.ok) return fromGate(c, r);
  const data = JSON.parse(r.body) as AircraftResponse;
  return c.json(
    {
      population: `Aircraft reported by ${data.attribution.name} within ${data.query.radiusNm} NM of ${data.query.lat}, ${data.query.lon}. Regional sample, not a worldwide total.`,
      query: data.query,
      fetchedAt: data.fetchedAt,
      stale: data.stale,
      stats: computeStats(data.aircraft),
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

// ---------------------------------------------------------------- airports
// Backed by the static OurAirports snapshot (public domain) in /data/airports.

let airportIndex: Promise<SearchableAirport[]> | null = null;

function loadAirportIndex(c: Context<AppEnv>): Promise<SearchableAirport[]> {
  airportIndex ??= c.env.ASSETS.fetch(new URL('/data/airports/index.json', c.req.url))
    .then((r) => {
      if (!r.ok) throw new Error(`index ${r.status}`);
      return r.json() as Promise<{ rows: AirportRow[] }>;
    })
    .then((j) => makeSearchable(j.rows.map(decodeRow)))
    .catch((e) => {
      airportIndex = null;
      throw e;
    });
  return airportIndex;
}

app.get('/api/airports/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return err(c, 400, 'invalid_query', 'Query must be at least 2 characters.');
  const country = c.req.query('country')?.toUpperCase();
  const limit = Math.min(50, Math.max(1, parseNumber(c.req.query('limit')) ?? 12));
  const list = await loadAirportIndex(c);
  const opts: Parameters<typeof searchAirports>[2] = { limit };
  if (country && /^[A-Z]{2}$/.test(country)) opts.country = country;
  const results = searchAirports(list, q, opts);
  return c.json({ count: results.length, results, source: 'OurAirports (public domain)' }, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/api/airports/:ident', async (c) => {
  const ident = c.req.param('ident').toUpperCase();
  if (!IDENT_RE.test(ident)) return err(c, 400, 'invalid_ident', 'Airport identifier is not valid.');
  const res = await c.env.ASSETS.fetch(new URL(`/data/airports/detail/${detailShard(ident)}.json`, c.req.url));
  if (!res.ok) return err(c, 404, 'not_found', 'Airport not found.');
  const shard = (await res.json()) as Record<string, unknown>;
  const detail = shard[ident];
  if (!detail) return err(c, 404, 'not_found', 'Airport not found.');
  return c.json(detail, 200, { 'Cache-Control': 'public, max-age=86400' });
});

// ---------------------------------------------------------------- weather

function readStations(raw: string | undefined): string | null {
  if (!raw) return null;
  const ids = [...new Set(raw.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 10 || !ids.every((s) => STATION_RE.test(s))) return null;
  return ids.sort().join(',');
}

function readBbox(raw: string | undefined): string | null {
  if (!raw) return null;
  const p = raw.split(',').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  // Snap outward to a 1° grid so nearby viewports share one cached request.
  let [s, w, n, e] = p as [number, number, number, number];
  s = Math.floor(s);
  w = Math.floor(w);
  n = Math.ceil(n);
  e = Math.ceil(e);
  if (s < -90 || n > 90 || w < -180 || e > 180 || s >= n || w >= e) return null;
  if (n - s > 12 || e - w > 16) return null; // keep requests small and polite
  return `${s},${w},${n},${e}`;
}

app.get('/api/weather/metar', async (c) => {
  const ids = readStations(c.req.query('ids'));
  const bbox = ids ? null : readBbox(c.req.query('bbox'));
  if (!ids && !bbox)
    return err(c, 400, 'invalid_query', 'Provide ids (up to 10 ICAO stations) or bbox=south,west,north,east (≤ 12°×16°).');
  const r = await gate(c.env).metar(ids ? { ids } : { bbox: bbox! });
  return fromGate(c, r, 'public, max-age=60');
});

app.get('/api/weather/taf', async (c) => {
  const ids = readStations(c.req.query('ids'));
  if (!ids) return err(c, 400, 'invalid_query', 'Provide ids: up to 10 ICAO station identifiers.');
  return fromGate(c, await gate(c.env).taf(ids), 'public, max-age=120');
});

export default app satisfies ExportedHandler<Env>;
