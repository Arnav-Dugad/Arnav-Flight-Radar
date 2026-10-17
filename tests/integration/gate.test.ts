// UpstreamGate (the global coordinator) with a mocked upstream. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamGate, type GateResult } from '../../worker/gate';

const env = {
  ADSBFI_MIN_INTERVAL_MS: '1100',
  AIRCRAFT_CACHE_TTL_MS: '10000',
  WEATHER_MIN_INTERVAL_MS: '1500',
} as unknown as Env;

const body = (n = 2) => ({
  now: Date.now(),
  ac: Array.from({ length: n }, (_, i) => ({ hex: `00000${i}`, type: 'adsb_icao', lat: 10 + i * 0.01, lon: 20, seen_pos: 1, alt_baro: 10000 })),
});

const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function parse(r: GateResult) {
  if (!r.ok) throw new Error(`gate error ${r.code}: ${r.message}`);
  return JSON.parse(r.body) as Record<string, unknown> & { aircraft: unknown[]; cache: { hit: boolean } };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const gate = () => new UpstreamGate({} as DurableObjectState, env);
const q = (lat: number, lon = 0) => ({ lat, lon, radiusNm: 100 });

describe('UpstreamGate', () => {
  it('fetches, normalizes and serves the shared snapshot from cache', async () => {
    fetchMock.mockResolvedValue(ok(body(3)));
    const g = gate();
    const first = parse(await g.aircraftRegion(q(10)));
    expect(first.aircraft).toHaveLength(3);
    expect(first.cache.hit).toBe(false);
    const second = parse(await g.aircraftRegion(q(10)));
    expect(second.cache.hit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://opendata.adsb.fi/api/v3/lat/10/lon/0/dist/100');
  });

  it('coalesces identical concurrent requests into one upstream call', async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok(body());
    });
    const g = gate();
    const results = await Promise.all([g.aircraftRegion(q(11)), g.aircraftRegion(q(11)), g.aircraftRegion(q(11))]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('paces different upstream calls at least the minimum interval apart', async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return ok(body());
    });
    const g = gate();
    await Promise.all([g.aircraftRegion(q(1)), g.aircraftRegion(q(2)), g.aircraftRegion(q(3))]);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1050);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(1050);
  }, 10_000);

  it('refuses to queue beyond the wait budget instead of exceeding the rate', async () => {
    fetchMock.mockImplementation(async () => ok(body()));
    const g = gate();
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => g.aircraftRegion(q(i))));
    const busy = results.filter((r) => !r.ok);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((r) => !r.ok && r.code === 'busy' && r.status === 503)).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  }, 15_000);

  it('backs off on 429 and opens the circuit', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429, headers: { 'Retry-After': '20' } }));
    const g = gate();
    const r1 = await g.aircraftRegion(q(20));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe('upstream_rate_limited');
      expect(r1.retryAfterSec).toBeGreaterThanOrEqual(20);
    }
    const r2 = await g.aircraftRegion(q(21));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('upstream_unavailable'); // circuit open — no new upstream call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const h = await g.healthReport();
    expect(h.providers.find((p) => p.id === 'adsbfi')?.status).toBe('down');
  });

  it('treats an access refusal (403) as a long cool-down, without retrying upstream', async () => {
    fetchMock.mockImplementation(async () => new Response('<html><title>Attention Required! | Cloudflare</title></html>', { status: 403 }));
    const g = gate();
    const r1 = await g.aircraftRegion(q(60));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe('upstream_forbidden');
      expect(r1.retryAfterSec).toBe(900);
      expect(r1.message).toMatch(/refusing requests/);
    }
    const r2 = await g.aircraftRegion(q(61));
    expect(!r2.ok && r2.code).toBe('upstream_forbidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const h = await g.healthReport();
    expect(h.providers.find((p) => p.id === 'adsbfi')?.lastError).toMatch(/Access refused \(HTTP 403: Attention Required/);
  });

  it('serves the last good snapshot, flagged as degraded, when the provider fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    fetchMock.mockResolvedValueOnce(ok(body(4)));
    const g = gate();
    parse(await g.aircraftRegion(q(30)));
    vi.setSystemTime(1_000_000 + 15_000); // past the 10 s TTL
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    const r = parse(await g.aircraftRegion(q(30)));
    expect(r.aircraft).toHaveLength(4);
    expect(r.stale).toBe(true);
    expect(String(r.degraded)).toMatch(/last good snapshot/);
  });

  it('rejects malformed upstream data', async () => {
    fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    const r = await gate().aircraftRegion(q(40));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('upstream_invalid');
    fetchMock.mockResolvedValue(ok({ unexpected: true }));
    const r2 = await gate().aircraftRegion(q(41));
    expect(r2.ok).toBe(false);
  });

  it('handles empty regions and weather 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(ok({ now: Date.now(), ac: [] }));
    const g = gate();
    expect(parse(await g.aircraftRegion(q(50))).aircraft).toEqual([]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const w = await g.metar({ ids: 'ZZZZ' });
    expect(w.ok).toBe(true);
    if (w.ok) expect(JSON.parse(w.body).data).toEqual([]);
  });

  it('includes raw records only when asked (inspector)', async () => {
    fetchMock.mockImplementation(async () => ok(body(1)));
    const g = gate();
    const plain = parse(await g.aircraftLookup('hex', '000000', false));
    expect(plain.raw).toBeUndefined();
    const g2 = gate();
    const raw = parse(await g2.aircraftLookup('hex', '000000', true));
    expect(Array.isArray(raw.raw)).toBe(true);
  });
});
