import { describe, expect, it } from 'vitest';
import { inferRunwayInUse, type ApproachTarget, type RunwayEnd } from '@shared/approach';
import { airlinePrefix, decodeAirline } from '@/data/airlines';
import { nightFeatures, solarElevation, subsolarPoint } from '@/map/extraOverlays';

const ENDS: RunwayEnd[] = [
  { ident: '09L', lat: 51.4775, lon: -0.4849, headingDeg: 90 },
  { ident: '27R', lat: 51.4776, lon: -0.4333, headingDeg: 270 },
];

describe('runway in use (inferred)', () => {
  it('prefers aircraft observed on final', () => {
    const t = (runway: string): ApproachTarget => ({ id: runway + Math.random(), label: 'X', runway, distNm: 6, heightFt: 1900, angleDeg: 3 });
    expect(inferRunwayInUse(ENDS, [t('09L'), t('27R'), t('27R')], { dirDeg: 90, speedKt: 15 })).toEqual({ runway: '27R', basis: 'approaches', count: 2 });
  });
  it('falls back to the largest headwind component', () => {
    expect(inferRunwayInUse(ENDS, [], { dirDeg: 250, speedKt: 12 })).toMatchObject({ runway: '27R', basis: 'wind' });
    expect(inferRunwayInUse(ENDS, [], { dirDeg: 100, speedKt: 12 })).toMatchObject({ runway: '09L', basis: 'wind' });
  });
  it('makes no guess in calm or variable wind', () => {
    expect(inferRunwayInUse(ENDS, [], { dirDeg: 250, speedKt: 2 })).toBeUndefined();
    expect(inferRunwayInUse(ENDS, [], { speedKt: 8 })).toBeUndefined();
    expect(inferRunwayInUse([], [], { dirDeg: 250, speedKt: 20 })).toBeUndefined();
  });
});

describe('day / night terminator', () => {
  it('puts the sun over the tropic of Cancer at the June solstice, near Greenwich at noon UTC', () => {
    const s = subsolarPoint(Date.UTC(2026, 5, 21, 12, 0));
    expect(s.lat).toBeCloseTo(23.44, 0);
    expect(Math.abs(s.lon)).toBeLessThan(1.5);
  });
  it('moves the sun 15° west per hour', () => {
    const a = subsolarPoint(Date.UTC(2026, 2, 20, 12));
    const b = subsolarPoint(Date.UTC(2026, 2, 20, 13));
    expect(((a.lon - b.lon + 540) % 360) - 180).toBeCloseTo(15, 0);
  });
  it('builds nested twilight bands that cover the dark side only', () => {
    const t = Date.UTC(2026, 2, 20, 12);
    const sun = subsolarPoint(t);
    expect(solarElevation(sun.lat, sun.lon, sun)).toBeCloseTo(90, 3);
    const f = nightFeatures(t);
    expect(f.map((x) => x.properties!.band)).toEqual([0, -6, -12, -18]);
    const area = (x: (typeof f)[number]) =>
      (x.geometry as { coordinates: number[][][][] }).coordinates.reduce((acc, p) => acc + Math.abs(p[0]![2]![1]! - p[0]![0]![1]!), 0);
    expect(area(f[0]!)).toBeGreaterThan(area(f[1]!));
    expect(area(f[1]!)).toBeGreaterThan(area(f[3]!));
    // Noon at Greenwich: Greenwich is lit, the antimeridian is dark.
    const dark = (lon: number) =>
      (f[0]!.geometry as { coordinates: number[][][][] }).coordinates.some((p) => {
        const r = p[0]!;
        return lon >= r[0]![0]! && lon < r[1]![0]! && 0 >= Math.min(r[0]![1]!, r[2]![1]!) && 0 <= Math.max(r[0]![1]!, r[2]![1]!);
      });
    expect(dark(0.5)).toBe(false);
    expect(dark(179.5)).toBe(true);
  });
});

describe('airline from callsign', () => {
  it('extracts the ICAO telephony prefix only from airline-style callsigns', () => {
    expect(airlinePrefix('BAW123')).toBe('BAW');
    expect(airlinePrefix('EZY45LX')).toBe('EZY');
    expect(airlinePrefix('N123AB')).toBeUndefined();
    expect(airlinePrefix('GABCD')).toBeUndefined();
    expect(airlinePrefix(undefined)).toBeUndefined();
  });
  it('decodes table rows', () => {
    expect(decodeAirline('BAW', ['British Airways', 'BA', 'SPEEDBIRD', 'United Kingdom', 1])).toEqual({
      icao: 'BAW',
      name: 'British Airways',
      iata: 'BA',
      telephony: 'SPEEDBIRD',
      country: 'United Kingdom',
      active: true,
    });
  });
});
