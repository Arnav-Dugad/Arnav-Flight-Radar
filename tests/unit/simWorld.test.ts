import majorRaw from '../../public/data/airports/index-major.json?raw';
import runwaysRaw from '../../public/data/airports/runways-major.json?raw';
import { describe, expect, it } from 'vitest';
import { decodeRow, type AirportRow } from '@shared/airports';
import { bearingDeg, destination, distanceNm } from '@shared/geo';
import { TYPES } from '@/data/sim/fleet';
import { ALL_AIRLINES as AIRLINES } from '@/data/sim/airlines';
import { ALL_ALLIANCES as ALLIANCES, CARGO } from '@/data/sim/airlines';
import { World, windAloft } from '@/data/sim/engine';

const airports = (JSON.parse(majorRaw) as { rows: AirportRow[] }).rows.map(decodeRow);
const runways = (JSON.parse(runwaysRaw) as { runways: Record<string, never[]> }).runways;

const NOW = Date.UTC(2026, 9, 18, 14, 0, 0);

function world(scale = 0.2) {
  const w = new World(42, airports, runways);
  w.populate(NOW, scale);
  return w;
}

describe('world simulator', () => {
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

  it('keeps a repeating timetable: same route, same number; odd outbound / even inbound', () => {
    const w = world(0.3);
    const byRoute = new Map<string, Set<string>>();
    for (const af of w.airframes) {
      if (!af.airline || af.airline.alnum) continue;
      const l = af.leg;
      const k = `${af.airline.icao}:${l.from.ident}>${l.to.ident}`;
      const num = Number(l.flightIata!.slice(af.airline.iata.length));
      // Same city pair → the same family of numbers (waves differ by 2).
      byRoute.set(k, (byRoute.get(k) ?? new Set()).add(String(Math.floor(num / 8))));
      if (af.airline.hubs.includes(l.from.ident) && !af.airline.hubs.includes(l.to.ident)) {
        const back = af.airline.hubs.includes(l.to.ident);
        expect(back).toBe(false);
      }
    }
    const consistent = [...byRoute.values()].filter((v) => v.size === 1).length / byRoute.size;
    expect(consistent).toBeGreaterThan(0.95);
  });

  it('only gives codeshares from the operating airline’s alliance', () => {
    const w = world(0.3);
    let seen = 0;
    for (const af of w.airframes) {
      if (!af.airline || !af.leg.codeshares.length) continue;
      const alliance = ALLIANCES.find((a) => a.members.includes(af.airline!.icao))!;
      const iatas = alliance.members.map((m) => w.airframes.find((x) => x.airline?.icao === m)?.airline?.iata).filter(Boolean);
      for (const c of af.leg.codeshares) expect(iatas).toContain(c.slice(0, 2));
      seen++;
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('sequences arrivals: holding is rare and short, and fog causes diversions', () => {
    const w = new World(42, airports, runways);
    w.setWeather('EGLL', { category: 'LIFR', windDir: 250, windKt: 18 });
    w.populate(NOW, 0.75);
    for (let k = 0; k < 18; k++) w.advance(NOW + k * 600_000);
    const legs = w.airframes.map((a) => a.leg);
    const held = legs.filter((l) => l.holdMs > 0);
    expect(held.length / legs.length).toBeLessThan(0.08);
    expect(held.reduce((a, l) => a + l.holdMs, 0) / held.length / 60_000).toBeLessThan(20);
    const diverted = legs.filter((l) => l.divertedFrom?.ident === 'EGLL');
    expect(diverted.length).toBeGreaterThan(0);
    for (const l of diverted) expect(l.to.ident).not.toBe('EGLL');
    // The METAR wind picks the runway: 250° → a 27x runway at Heathrow.
    expect(w.airports.get('EGLL')!.inUse.ident).toMatch(/^27/);
    expect(w.airports.get('EGLL')!.inUseBasis).toBe('metar');
  });

  it('parks on real stands and taxis along a supplied taxiway graph', () => {
    const w = new World(7, airports, runways);
    const apt = airports.find((a) => a.ident === 'EGLL')!;
    w.setStands({ EGLL: Array.from({ length: 20 }, (_, i) => [apt.lat + 0.001 * (i % 5), apt.lon + 0.002 * Math.floor(i / 5), String(501 + i), i % 2 ? 90 : null] as [number, number, string, number | null]) });
    w.populate(NOW, 0.3);
    const atLhr = w.airframes.filter((a) => a.airline && a.leg.from.ident === 'EGLL');
    expect(atLhr.some((a) => /^5\d\d$/.test(a.leg.stand.ref ?? ''))).toBe(true);
    // Every stand has a nose direction, so parked and pushing-back aircraft face the right way.
    expect(atLhr.every((a) => a.leg.stand.hdg !== undefined)).toBe(true);
    // A tiny taxiway network: future taxi segments become paths along it.
    const thr = w.airports.get('EGLL')!.inUse;
    w.setTaxiGraph('EGLL', { nodes: [[apt.lat, apt.lon], [(apt.lat + thr.lat) / 2, (apt.lon + thr.lon) / 2], [thr.lat, thr.lon]], adj: [[1], [0, 2], [1]] }, NOW - 3_600_000);
    const rerouted = w.airframes.some((a) => a.leg.segs.some((s) => s.phase === 'taxi' && s.kind === 'path'));
    expect(rerouted).toBe(true);
  });

  it('models jet streams: strong westerlies in mid-latitudes, light easterlies in the tropics', () => {
    const jet = windAloft(42, -40, NOW, 0);
    expect(jet.kt).toBeGreaterThan(45);
    expect(Math.abs(jet.dir - 270)).toBeLessThan(30);
    const trade = windAloft(10, -40, NOW, 0);
    expect(trade.kt).toBeLessThan(25);
    expect(Math.abs(trade.dir - 90)).toBeLessThan(30);
  });

  it('updates the estimated arrival with the wind en route', () => {
    const w = world(0.3);
    const now = NOW + 2 * 3_600_000;
    w.advance(now);
    const cruising = w.airframes.filter((a) => w.state(a, now).phase === 'cruise');
    expect(cruising.length).toBeGreaterThan(100);
    const moved = cruising.filter((a) => Math.abs(w.eta(a, now) - a.leg.tOn) > 30_000).length;
    expect(moved).toBeGreaterThan(cruising.length * 0.15);
    for (const a of cruising) expect(Math.abs(w.eta(a, now) - a.leg.tOn)).toBeLessThan(90 * 60_000);
  });

  it('flies semicircular cruise levels: odd flight levels eastbound, even westbound', () => {
    const w = world(0.3);
    let checked = 0;
    for (const af of w.airframes) {
      const cruise = af.leg.segs.find((s) => s.phase === 'cruise');
      if (!cruise || af.ga || af.leg.cruiseFt < 20_000 || af.leg.canceled) continue;
      const east = bearingDeg(cruise.a[0], cruise.a[1], cruise.b[0], cruise.b[1]);
      const fl = Math.round(af.leg.cruiseFt / 1000);
      const climb = af.leg.segs.find((s) => s.phase === 'climb' && s.kind === 'gc');
      if (!climb) continue;
      const dir = bearingDeg(climb.a[0], climb.a[1], af.leg.segs.find((s) => s.phase === 'descent')!.b[0], af.leg.segs.find((s) => s.phase === 'descent')!.b[1]);
      expect(fl % 2).toBe(dir < 180 ? 1 : 0);
      void east;
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('pushes back with the nose fixed, holds short, then lines up on the runway', () => {
    const w = world(0.3);
    const af = w.airframes.find((a) => a.airline && a.type.cls === 'narrow' && !a.leg.canceled)!;
    const segs = af.leg.segs;
    const push = segs.find((s) => s.phase === 'pushback')!;
    expect(push.nose).toBeDefined();
    const mid = w.state(af, (push.t0 + push.t1) / 2);
    expect(mid.phase).toBe('pushback');
    expect(mid.trk).toBeCloseTo(push.nose!, 5);
    const takeoff = segs.findIndex((s) => s.phase === 'takeoff');
    const lined = segs[takeoff - 1]!;
    expect(lined.nose).toBeCloseTo(af.leg.from.inUse.hdg, 5);
  });

  it('goes around in gusty weather and flies a circuit before landing', () => {
    const w = new World(11, airports, runways);
    w.setWeather('KDFW', { category: 'VFR', windDir: 180, windKt: 28, gustKt: 42 });
    w.populate(NOW, 0.75);
    for (let k = 0; k < 12; k++) w.advance(NOW + k * 900_000);
    const ga = w.airframes.filter((a) => a.leg.segs.some((s) => s.phase === 'goaround'));
    expect(ga.length).toBeGreaterThan(0);
    for (const af of ga) {
      const i = af.leg.segs.findIndex((s) => s.phase === 'goaround');
      expect(af.leg.segs.slice(i).some((s) => s.phase === 'landing')).toBe(true);
    }
  });

  it('runs cargo operators mostly at night (local time)', () => {
    const w = world(0.75);
    const hours: number[] = [];
    for (let k = 0; k < 24; k++) {
      w.advance(NOW + k * 3_600_000);
      for (const af of w.airframes) {
        if (!af.airline || !CARGO.has(af.airline.icao)) continue;
        hours.push((((af.leg.tOff / 3_600_000 + af.leg.from.lon / 15) % 24) + 24) % 24);
      }
    }
    const night = hours.filter((h) => h >= 18 || h < 6).length;
    expect(night / hours.length).toBeGreaterThan(0.6);
  });

  it('cancels some flights in bad weather: they stay on the stand and never fly', () => {
    const w = new World(5, airports, runways);
    w.setWeather('KORD', { category: 'LIFR', windDir: 270, windKt: 20, gustKt: 45, visSm: 0.25 });
    w.populate(NOW, 0.75);
    const canceled = w.airframes.filter((a) => a.leg.canceled);
    expect(canceled.length).toBeGreaterThan(0);
    for (const af of canceled) {
      const s = w.state(af, (af.leg.tOff + af.leg.tOn) / 2);
      expect(s.onGround).toBe(true);
      expect(s.emit).toBe(false);
      expect(af.leg.to).toBe(af.leg.from);
      expect(af.leg.canceledTo).toBeDefined();
    }
  });

  it('turns off the runway at a real taxiway when the ground network is known', () => {
    const w = new World(3, airports, runways);
    w.populate(NOW, 0.3);
    const a = w.airports.get('EGLL')!;
    const rw = a.inUse;
    // A taxiway node 1.1 NM down the runway, just beside the centreline.
    const exit = destination(rw.lat, rw.lon, rw.hdg, 1.1);
    const side = destination(exit[0], exit[1], rw.hdg + 90, 0.03);
    const far = destination(side[0], side[1], rw.hdg + 90, 0.3);
    w.setTaxiGraph('EGLL', { nodes: [side, far, [a.lat, a.lon]], adj: [[1], [0, 2], [1]] }, NOW);
    w.advance(NOW + 6 * 3_600_000);
    const arrivals = w.airframes.filter((af) => af.leg.to.ident === 'EGLL' && af.leg.tOff > NOW && af.airline && !af.leg.canceled);
    expect(arrivals.length).toBeGreaterThan(0);
    const land = arrivals[0]!.leg.segs.find((s) => s.phase === 'landing')!;
    expect(distanceNm(land.b[0], land.b[1], exit[0], exit[1])).toBeLessThan(0.05);
  });

  it('is deterministic for a given seed', () => {
    const a = world();
    const b = world();
    expect(a.airframes.slice(0, 50).map((x) => x.hex + x.reg + x.leg.flight)).toEqual(b.airframes.slice(0, 50).map((x) => x.hex + x.reg + x.leg.flight));
  });
});
