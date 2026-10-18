// UpstreamGate (the global coordinator) with a mocked upstream. Synthetic data only.
// Aircraft are simulated in the browser, so the gate only fronts AviationWeather.gov.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamGate, type GateResult } from '../../worker/gate';

const env = {
  WEATHER_MIN_INTERVAL_MS: '1000',
} as unknown as Env;

const metarRecord = (icaoId: string) => ({
  icaoId,
  obsTime: 1_700_000_000,
  reportTime: '2023-11-14T22:13:20Z',
  temp: 12,
  dewp: 8,
  wdir: 240,
  wspd: 12,
  visib: '6+',
  altim: 1013,
  rawOb: `${icaoId} 142213Z 24012KT 9999 FEW030 12/08 Q1013`,
  clouds: [{ cover: 'FEW', base: 3000 }],
  lat: 51.5,
  lon: -0.5,
  name: 'Test',
});

const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function parse(r: GateResult) {
  if (!r.ok) throw new Error(`gate error ${r.code}: ${r.message}`);
  return JSON.parse(r.body) as Record<string, unknown> & { data: unknown[]; cache: { hit: boolean }; provider: string };
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

describe('UpstreamGate', () => {
  it('exposes no aircraft RPC methods and never contacts an aircraft source', async () => {
    const g = gate() as unknown as Record<string, unknown>;
    expect(g.aircraftRegion).toBeUndefined();
    expect(g.aircraftLookup).toBeUndefined();
    const h = await gate().healthReport();
    expect(h.providers.map((p) => p.id)).toEqual(['aviationweather']);
  });

  it('fetches, normalizes and serves METARs from cache', async () => {
    fetchMock.mockResolvedValue(ok([metarRecord('EGLL'), metarRecord('KJFK')]));
    const g = gate();
    const first = parse(await g.metar({ ids: 'EGLL,KJFK' }));
    expect(first.provider).toBe('aviationweather');
    expect(first.data).toHaveLength(2);
    expect(first.cache.hit).toBe(false);
    const second = parse(await g.metar({ ids: 'EGLL,KJFK' }));
    expect(second.cache.hit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://aviationweather.gov/api/data/metar?ids=EGLL,KJFK&format=json');
    expect((await g.healthReport()).providers[0]!.cacheHits).toBe(1);
  });

  it('builds bbox METAR and TAF URLs from fixed templates', async () => {
    fetchMock.mockImplementation(async () => ok([]));
    const g = gate();
    expect((await g.metar({ bbox: '50,-2,53,2' })).ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://aviationweather.gov/api/data/metar?bbox=50,-2,53,2&format=json');
    const t = await g.taf('EGLL');
    expect(t.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://aviationweather.gov/api/data/taf?ids=EGLL&format=json');
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toMatch(/^https:\/\/aviationweather\.gov\//);
  }, 10_000);

  it('coalesces identical concurrent requests into one upstream call', async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok([metarRecord('EGLL')]);
    });
    const g = gate();
    const results = await Promise.all([g.metar({ ids: 'EGLL' }), g.metar({ ids: 'EGLL' }), g.metar({ ids: 'EGLL' })]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('paces different upstream calls at least the minimum interval apart', async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return ok([]);
    });
    const g = gate();
    await Promise.all([g.metar({ ids: 'AAAA' }), g.metar({ ids: 'BBBB' }), g.metar({ ids: 'CCCC' })]);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(950);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(950);
  }, 10_000);

  it('refuses to queue beyond the wait budget instead of exceeding the rate', async () => {
    fetchMock.mockImplementation(async () => ok([]));
    const g = gate();
    const ids = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG'];
    const results = await Promise.all(ids.map((i) => g.metar({ ids: i })));
    const busy = results.filter((r) => !r.ok);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((r) => !r.ok && r.code === 'busy' && r.status === 503)).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  }, 15_000);

  it('backs off on 429 and opens the circuit', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429, headers: { 'Retry-After': '20' } }));
    const g = gate();
    const r1 = await g.metar({ ids: 'EGLL' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe('upstream_rate_limited');
      expect(r1.retryAfterSec).toBeGreaterThanOrEqual(20);
    }
    const r2 = await g.taf('KJFK');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('upstream_unavailable'); // circuit open — no new upstream call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const h = await g.healthReport();
    expect(h.providers.find((p) => p.id === 'aviationweather')?.status).toBe('down');
  });

  it('treats an access refusal (403) as a long cool-down, without retrying upstream', async () => {
    fetchMock.mockImplementation(async () => new Response('<html><title>Attention Required! | Cloudflare</title></html>', { status: 403 }));
    const g = gate();
    const r1 = await g.metar({ ids: 'EGLL' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe('upstream_forbidden');
      expect(r1.retryAfterSec).toBe(900);
      expect(r1.message).toMatch(/AviationWeather\.gov is currently refusing requests/);
    }
    const r2 = await g.metar({ ids: 'KJFK' });
    expect(!r2.ok && r2.code).toBe('upstream_forbidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const h = await g.healthReport();
    expect(h.providers.find((p) => p.id === 'aviationweather')?.lastError).toMatch(/Access refused \(HTTP 403: Attention Required/);
  });

  it('serves the last good report, flagged as degraded, when the provider fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    fetchMock.mockResolvedValueOnce(ok([metarRecord('EGLL')]));
    const g = gate();
    parse(await g.metar({ ids: 'EGLL' }));
    vi.setSystemTime(1_000_000 + 4 * 60_000); // within the 5 min METAR TTL
    expect(parse(await g.metar({ ids: 'EGLL' })).cache.hit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 6 * 60_000); // past the TTL
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    const r = parse(await g.metar({ ids: 'EGLL' }));
    expect(r.data).toHaveLength(1);
    expect(String(r.degraded)).toMatch(/last good report/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never serves a report that is too old, even when the provider fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    fetchMock.mockResolvedValueOnce(ok([metarRecord('EGLL')]));
    const g = gate();
    parse(await g.metar({ ids: 'EGLL' }));
    vi.setSystemTime(1_000_000 + 11 * 60_000); // TTL (5 min) + stale window (5 min) exceeded
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    const r = await g.metar({ ids: 'EGLL' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('upstream_unavailable');
  });

  it('rejects malformed upstream data', async () => {
    fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    const r = await gate().metar({ ids: 'EGLL' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('upstream_invalid');
    fetchMock.mockResolvedValue(ok({ unexpected: true }));
    const r2 = await gate().metar({ ids: 'EGLL' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('upstream_invalid');
  });

  it('handles weather 204 responses as empty data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const w = await gate().metar({ ids: 'ZZZZ' });
    expect(w.ok).toBe(true);
    if (w.ok) expect(JSON.parse(w.body).data).toEqual([]);
  });
});
