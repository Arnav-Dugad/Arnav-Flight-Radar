import { describe, expect, it } from 'vitest';
import type { Aircraft, AircraftResponse } from '../../shared/types';
import { activeFilterCount, compileFilter, EMPTY_FILTERS } from '../../src/lib/filters';
import { fmtAltitude, fmtBearing, fmtSpeed, fmtVRate, NA } from '../../src/lib/format';
import { scaleColor, ALTITUDE_STOPS } from '../../src/lib/colors';

// The traffic engine is framework-free; import it directly.
import { traffic } from '../../src/state/traffic';

const ac = (o: Partial<Aircraft>): Aircraft => ({
  id: '400a5b',
  icao24: '400a5b',
  lat: 51,
  lon: 0,
  onGround: false,
  positionSource: 'adsb',
  observedAt: 0,
  seenAt: 0,
  receivedAt: 0,
  provider: 'adsbfi',
  freshness: 'live',
  ...o,
});

describe('filters', () => {
  const fleet = [
    ac({ id: 'a', icao24: '400001', callsign: 'BAW12', aircraftType: 'B77W', altitudeBarometric: 36000, groundSpeed: 480, verticalRate: 0 }),
    ac({ id: 'b', icao24: '800001', callsign: 'IGO5', aircraftType: 'A20N', altitudeBarometric: 4000, groundSpeed: 190, verticalRate: -900, registration: 'VT-NHZ' }),
    ac({ id: 'c', icao24: 'a00001', onGround: true, groundSpeed: 10, squawk: '7700' }),
    ac({ id: 'd', icao24: '400002', positionSource: 'mlat', military: true }),
  ];
  const run = (f: Partial<typeof EMPTY_FILTERS>) => fleet.filter((x) => compileFilter({ ...EMPTY_FILTERS, ...f })(x)).map((x) => x.id);

  it('passes everything with no filters', () => {
    expect(run({})).toEqual(['a', 'b', 'c', 'd']);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
  it('filters by altitude, keeping unknown unless excluded', () => {
    expect(run({ altitude: [30000, 40000] })).toEqual(['a', 'd']);
    expect(run({ altitude: [30000, 40000], excludeUnknown: true })).toEqual(['a']);
    expect(run({ altitude: [0, 1000] })).toEqual(['c', 'd']); // ground = 0 ft
  });
  it('filters by state, class, text, squawk, country, source and flags', () => {
    expect(run({ ground: 'airborne' })).toEqual(['a', 'b', 'd']);
    expect(run({ vertical: ['descending'] })).toEqual(['b', 'd']);
    expect(run({ classes: ['widebody'] })).toEqual(['a']);
    expect(run({ callsign: 'baw' })).toEqual(['a']);
    expect(run({ registration: 'vtnhz' })).toEqual(['b']);
    expect(run({ type: 'A20' })).toEqual(['b']);
    expect(run({ squawk: '77' })).toEqual(['c']);
    expect(run({ countries: ['IN'] })).toEqual(['b']);
    expect(run({ sources: ['mlat'] })).toEqual(['d']);
    expect(run({ militaryOnly: true })).toEqual(['d']);
    expect(run({ emergenciesOnly: true })).toEqual(['c']);
  });
  it('combines filters', () => {
    expect(run({ ground: 'airborne', countries: ['GB'], militaryOnly: true })).toEqual(['d']);
    expect(activeFilterCount({ ...EMPTY_FILTERS, ground: 'airborne', countries: ['GB'] })).toBe(2);
  });
});

describe('formatting', () => {
  it('shows "Not available" for missing values', () => {
    expect(fmtAltitude(undefined, 'ft')).toBe(NA);
    expect(fmtSpeed(undefined, 'kt')).toBe(NA);
    expect(fmtBearing(undefined)).toBe(NA);
  });
  it('formats with units', () => {
    expect(fmtAltitude(35000, 'fl')).toBe('FL350');
    expect(fmtAltitude(0, 'ft', true)).toBe('GND');
    expect(fmtBearing(5)).toBe('005°');
    expect(fmtVRate(-1200, 'fpm')).toMatch(/^−1,?200 ft\/min$/);
  });
  it('colour scale clamps at its ends', () => {
    expect(scaleColor(ALTITUDE_STOPS.aurora, -500)).toBe('#ffd166');
    expect(scaleColor(ALTITUDE_STOPS.aurora, 99999)).toBe('#5ce1ff');
  });
});

function response(aircraft: Aircraft[], t: number, region = { lat: 51, lon: 0, radiusNm: 100 }): AircraftResponse {
  return {
    provider: 'adsbfi',
    attribution: { name: 'adsb.fi', url: 'https://adsb.fi', license: 'test' },
    query: region,
    providerNow: t,
    fetchedAt: t,
    servedAt: t,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: 10000 },
    count: aircraft.length,
    aircraft,
  };
}

describe('traffic engine', () => {
  it('tracks, interpolates between reports without overshooting, and records trails', () => {
    traffic.tracks.clear();
    traffic.expectedIntervalMs = 10_000;
    traffic.smooth = true;
    const t0 = 1_000_000;
    traffic.ingest(response([ac({ lat: 51, lon: 0, observedAt: t0 - 1000, track: 90 })], t0), t0);
    traffic.ingest(response([ac({ lat: 51, lon: 0.03, observedAt: t0 + 9000, track: 90 })], t0 + 10_000), t0 + 10_000);
    const t = traffic.get('400a5b')!;
    const mid = traffic.displayPosition(t, t0 + 10_000 + t.animDur / 2);
    expect(mid.lon).toBeGreaterThan(0);
    expect(mid.lon).toBeLessThan(0.03);
    const end = traffic.displayPosition(t, t0 + 10_000 + t.animDur * 5);
    expect(end.lon).toBeCloseTo(0.03); // stops at the newest report, never beyond
    expect(t.trail).toHaveLength(2);
  });

  it('breaks trails across long gaps and implausible jumps', () => {
    traffic.tracks.clear();
    const t0 = 2_000_000;
    traffic.ingest(response([ac({ lat: 51, lon: 0, observedAt: t0 })], t0), t0);
    traffic.ingest(response([ac({ lat: 51, lon: 0.01, observedAt: t0 + 200_000 })], t0 + 200_000), t0 + 200_000);
    traffic.ingest(response([ac({ lat: 55, lon: 10, observedAt: t0 + 210_000 })], t0 + 210_000), t0 + 210_000);
    const trail = traffic.get('400a5b')!.trail;
    expect(trail[1]!.gap).toBe(true);
    expect(trail[2]!.gap).toBe(true);
  });

  it('marks aircraft that vanish inside the region as lost, and removes them later', () => {
    traffic.tracks.clear();
    traffic.pinned = new Set();
    traffic.lostSec = 60;
    const t0 = 3_000_000;
    traffic.ingest(response([ac({ observedAt: t0 })], t0), t0);
    traffic.ingest(response([], t0 + 15_000), t0 + 15_000);
    expect(traffic.stateOf(traffic.get('400a5b')!, t0 + 15_000)).toBe('lost');
    traffic.ingest(response([], t0 + 90_000), t0 + 90_000);
    expect(traffic.get('400a5b')).toBeUndefined();
  });

  it('measures age on the provider clock, immune to device clock skew', () => {
    traffic.tracks.clear();
    const serverT = 5_000_000;
    const skewedClient = serverT + 3_600_000; // device clock an hour fast
    traffic.ingest(response([ac({ observedAt: serverT - 2000 })], serverT), skewedClient);
    const age = traffic.ageMs(traffic.get('400a5b')!, skewedClient);
    expect(age).toBeGreaterThanOrEqual(2000);
    expect(age).toBeLessThan(5000);
  });
});
