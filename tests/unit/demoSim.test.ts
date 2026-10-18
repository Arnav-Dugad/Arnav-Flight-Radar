import majorRaw from '../../public/data/airports/index-major.json?raw';
import runwaysRaw from '../../public/data/airports/runways-major.json?raw';
import { describe, expect, it } from 'vitest';
import { decodeRow, type AirportRow } from '@shared/airports';
import { distanceNm } from '@shared/geo';
import { AIRLINES, TYPES } from '@/data/demo/fleet';
import { DemoWorld } from '@/data/demo/sim';

const airports = (JSON.parse(majorRaw) as { rows: AirportRow[] }).rows.map(decodeRow);
const runways = (JSON.parse(runwaysRaw) as { runways: Record<string, never[]> }).runways;

const NOW = Date.UTC(2026, 9, 18, 14, 0, 0);

function world(scale = 0.2) {
  const w = new DemoWorld(42, airports, runways);
  w.populate(NOW, scale);
  return w;
}

describe('demo world simulator', () => {
  it('uses only real airports for airline hubs and only known aircraft types', () => {
    const idents = new Set(airports.map((a) => a.ident));
    const missing = AIRLINES.flatMap((a) => a.hubs.filter((h) => !idents.has(h)).map((h) => `${a.icao}:${h}`));
    expect(missing).toEqual([]);
    const badTypes = AIRLINES.flatMap((a) => a.fleet.filter(([t]) => !TYPES[t]).map(([t]) => `${a.icao}:${t}`));
    expect(badTypes).toEqual([]);
  });

  it('populates a realistic worldwide fleet', () => {
    const w = world(0.75);
    const states = w.airframes.map((af) => w.state(af, NOW)).filter((s) => s.emit);
    const airborne = states.filter((s) => !s.onGround);
    expect(airborne.length).toBeGreaterThan(5000);
    expect(airborne.length).toBeLessThan(16000);
    // Traffic spans every inhabited continent.
    const bands = new Set(airborne.map((s) => `${Math.sign(s.lat)}:${Math.floor((s.lon + 180) / 60)}`));
    expect(bands.size).toBeGreaterThanOrEqual(7);
  });

  it('produces physically consistent states along every leg', () => {
    const w = world();
    for (const af of w.airframes.slice(0, 400)) {
      const leg = af.leg;
      expect(leg.tOn).toBeGreaterThan(leg.tOff);
      expect(leg.sta).toBeGreaterThan(leg.std);
      let prev = w.state(af, leg.tOff);
      for (let t = leg.tOff; t < leg.tOn; t += 30_000) {
        const s = w.state(af, t);
        expect(Number.isFinite(s.lat) && Number.isFinite(s.lon)).toBe(true);
        expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
        if (!s.onGround) {
          expect(s.alt).toBeGreaterThan(-1500);
          expect(s.alt).toBeLessThanOrEqual(af.type.ft + 1);
        }
        // No teleporting: 30 s at ≤ 700 kt ≈ 6 NM.
        expect(distanceNm(prev.lat, prev.lon, s.lat, s.lon)).toBeLessThan(7);
        prev = s;
      }
      const end = w.state(af, leg.tOn - 1);
      expect(distanceNm(end.lat, end.lon, leg.to.lat, leg.to.lon)).toBeLessThan(5);
    }
  });

  it('lands on the runway in use and departs from it', () => {
    const w = world();
    const af = w.airframes.find((a) => a.type.cls === 'narrow')!;
    const leg = af.leg;
    const land = leg.segs.find((s) => s.phase === 'landing')!;
    expect(land.a[0]).toBeCloseTo(leg.to.inUse.lat, 6);
    const roll = leg.segs.find((s) => s.phase === 'takeoff')!;
    expect(roll.a[0]).toBeCloseTo(leg.from.inUse.lat, 6);
  });

  it('chains legs: the next flight departs from where the last one arrived', () => {
    const w = world();
    const af = w.airframes[3]!;
    const first = af.leg;
    w.advance(first.tOn + 6 * 3_600_000);
    expect(af.prev).toBeDefined();
    expect(af.leg.tOff).toBeGreaterThan(first.tOff);
    expect(af.prev!.to).toBe(af.leg.from);
  });

  it('gives hubs a balanced flow of arrivals and departures, quieter at night', () => {
    const w = world(0.3);
    const arr = new Set<string>();
    const dep = new Set<string>();
    const byHour = new Array<number>(24).fill(0);
    for (let t = NOW; t < NOW + 24 * 3_600_000; t += 10 * 60_000) {
      w.advance(t);
      for (const af of w.airframes) {
        const l = af.leg;
        const key = `${af.hex}-${l.std}`;
        if (l.to.ident === 'EGLL' && t >= l.tOn - 600_000 && t < l.tOn) arr.add(key);
        if (l.from.ident === 'EGLL' && t >= l.tOff && t < l.tOff + 600_000 && !dep.has(key)) {
          dep.add(key);
          byHour[new Date(l.tOff).getUTCHours()]!++;
        }
      }
    }
    expect(arr.size).toBeGreaterThan(40);
    expect(dep.size / arr.size).toBeGreaterThan(0.6);
    expect(dep.size / arr.size).toBeLessThan(1.6);
    const night = byHour.slice(0, 4).reduce((a, b) => a + b, 0);
    const day = byHour.slice(9, 13).reduce((a, b) => a + b, 0);
    expect(night).toBeLessThan(day);
  });

  it('is deterministic for a given seed', () => {
    const a = world();
    const b = world();
    expect(a.airframes.slice(0, 50).map((x) => x.hex + x.reg + x.leg.flight)).toEqual(b.airframes.slice(0, 50).map((x) => x.hex + x.reg + x.leg.flight));
  });
});
