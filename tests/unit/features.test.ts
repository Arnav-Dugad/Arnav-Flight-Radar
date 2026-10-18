// Synthetic geometry only — no live data.
import { describe, expect, it } from 'vitest';
import { approachTargets, observedMovements, runwayEnds } from '../../shared/approach';
import { destination, distanceNm, intermediatePoint } from '../../shared/geo';
import type { Aircraft, AircraftResponse, Runway } from '../../shared/types';
import { traffic } from '../../src/state/traffic';

// A runway 09/27 at roughly Heathrow's latitude.
const RWY: Runway = {
  leIdent: '09',
  heIdent: '27',
  lighted: true,
  closed: false,
  leLat: 51.4775,
  leLon: -0.485,
  heLat: 51.4775,
  heLon: -0.433,
  leHeadingDegT: 90,
  heHeadingDegT: 270,
  leElevationFt: 80,
  heElevationFt: 80,
};

const ac = (o: Partial<Aircraft>): Aircraft => ({
  id: 'abc001',
  icao24: 'abc001',
  lat: 0,
  lon: 0,
  onGround: false,
  positionSource: 'adsb',
  observedAt: 0,
  seenAt: 0,
  receivedAt: 0,
  provider: 'sim',
  freshness: 'live',
  ...o,
});

describe('runway approach geometry', () => {
  const ends = runwayEnds([RWY, { ...RWY, closed: true }]);

  it('derives both landing directions from open runways only', () => {
    expect(ends.map((e) => e.ident)).toEqual(['09', '27']);
  });

  it('finds an aircraft on a 3° final to runway 27 and measures its path', () => {
    // 6 NM east of the 27 threshold (approach from the east), ~1,900 ft above it.
    const [lat, lon] = destination(RWY.heLat!, RWY.heLon!, 90, 6);
    const t = approachTargets(ends, 80, [ac({ callsign: 'TST27', lat, lon, altitudeBarometric: 1990, track: 271, verticalRate: -700 })]);
    expect(t).toHaveLength(1);
    expect(t[0]!.runway).toBe('27');
    expect(t[0]!.distNm).toBeCloseTo(6, 1);
    expect(t[0]!.angleDeg).toBeGreaterThan(2.7);
    expect(t[0]!.angleDeg).toBeLessThan(3.3);
  });

  it('ignores aircraft that are climbing, off-axis, flying away or too high', () => {
    const [lat, lon] = destination(RWY.heLat!, RWY.heLon!, 90, 6);
    const [olat, olon] = destination(RWY.heLat!, RWY.heLon!, 130, 6);
    const list = [
      ac({ id: 'a', lat, lon, altitudeBarometric: 2000, track: 270, verticalRate: 1500 }),
      ac({ id: 'b', lat: olat, lon: olon, altitudeBarometric: 2000, track: 270 }),
      ac({ id: 'c', lat, lon, altitudeBarometric: 2000, track: 90 }),
      ac({ id: 'd', lat, lon, altitudeBarometric: 12000, track: 270 }),
      ac({ id: 'e', lat, lon, onGround: true, track: 270 }),
    ];
    expect(approachTargets(ends, 80, list)).toEqual([]);
  });
});

describe('observed airport movements', () => {
  const apt = { lat: 51.47, lon: -0.46 };
  it('counts ground→air as a departure and air→ground as an arrival', () => {
    const m = observedMovements(apt.lat, apt.lon, [
      { id: 'dep', label: 'DEP1', trail: [{ lat: 51.47, lon: -0.46, alt: 0, t: 1 }, { lat: 51.5, lon: -0.4, alt: 2500, t: 2 }] },
      { id: 'arr', label: 'ARR1', trail: [{ lat: 51.5, lon: -0.6, alt: 3000, t: 3 }, { lat: 51.471, lon: -0.461, alt: 0, t: 4 }] },
      { id: 'over', label: 'OVR1', trail: [{ lat: 51.5, lon: -0.4, alt: 35000, t: 5 }, { lat: 51.6, lon: -0.2, alt: 35000, t: 6 }] },
      { id: 'far', label: 'FAR1', trail: [{ lat: 52.5, lon: 1, alt: 0, t: 7 }, { lat: 52.6, lon: 1.1, alt: 3000, t: 8 }] },
    ]);
    expect(m.map((x) => `${x.id}:${x.kind}`).sort()).toEqual(['arr:arrival', 'dep:departure']);
  });
});

describe('great-circle interpolation', () => {
  it('starts, ends and splits the route correctly', () => {
    const a: [number, number] = [51.47, -0.45];
    const b: [number, number] = [40.64, -73.78];
    expect(intermediatePoint(...a, ...b, 0)[0]).toBeCloseTo(a[0]);
    expect(intermediatePoint(...a, ...b, 1)[1]).toBeCloseTo(b[1]);
    const mid = intermediatePoint(...a, ...b, 0.5);
    expect(distanceNm(a[0], a[1], mid[0], mid[1])).toBeCloseTo(distanceNm(mid[0], mid[1], b[0], b[1]), 0);
    expect(mid[0]).toBeGreaterThan(51); // great circle bows north of both endpoints
  });
});

function resp(aircraft: Aircraft[], t: number): AircraftResponse {
  return {
    provider: 'sim',
    attribution: { name: 'test', url: 'https://example.test', license: 'test' },
    query: { lat: 51, lon: 0, radiusNm: 100 },
    providerNow: t,
    fetchedAt: t,
    servedAt: t,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: 10000 },
    count: aircraft.length,
    aircraft,
  };
}

describe('curved motion', () => {
  it('follows a turn between two reports and ends exactly on the newest one', () => {
    traffic.reset();
    traffic.smooth = true;
    traffic.curved = true;
    traffic.expectedIntervalMs = 10_000;
    const t0 = 10_000_000;
    traffic.ingest(resp([ac({ lat: 51, lon: 0, track: 0, observedAt: t0 })], t0), t0);
    traffic.ingest(resp([ac({ lat: 51.02, lon: 0.03, track: 90, observedAt: t0 + 10_000 })], t0 + 10_000), t0 + 10_000);
    const t = traffic.get('abc001')!;
    const early = traffic.displayPosition(t, t0 + 10_000 + t.animDur * 0.1);
    expect(early.trk).toBeLessThan(45); // still heading roughly north at the start
    const late = traffic.displayPosition(t, t0 + 10_000 + t.animDur * 0.9);
    expect(late.trk).toBeGreaterThan(45); // turned toward east by the end
    const end = traffic.displayPosition(t, t0 + 10_000 + t.animDur * 3);
    expect(end.lat).toBe(51.02);
    expect(end.lon).toBe(0.03);
  });

  it('reset clears tracks, metadata, snapshots and coverage history', () => {
    traffic.ingest(resp([ac({ observedAt: 1 })], 1), 1);
    traffic.reset();
    expect(traffic.tracks.size).toBe(0);
    expect(traffic.meta).toBeNull();
    expect(traffic.snapshots).toEqual([]);
    expect(traffic.regionsQueried).toEqual([]);
  });
});
