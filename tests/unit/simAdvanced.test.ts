// The deeper simulation: procedures on real navaids, North Atlantic tracks, wake
// separation, taxi clearances with real names and runway crossings, emergencies,
// special operations, schedules, load sheets and the radio transcript.
import majorRaw from '../../public/data/airports/index-major.json?raw';
import runwaysRaw from '../../public/data/airports/runways-major.json?raw';
import navRaw from '../../public/data/sim/navaids.json?raw';
import heliRaw from '../../public/data/sim/heliports.json?raw';
import glideRaw from '../../public/data/sim/gliding.json?raw';
import { describe, expect, it, vi } from 'vitest';

// Building a whole world takes a few seconds; allow for parallel test files.
vi.setConfig({ testTimeout: 60_000 });
import { decodeRow, type AirportRow } from '@shared/airports';
import { distanceNm } from '@shared/geo';
import { World } from '@/data/sim/engine';
import { assignNat, fixName, natTracks, NavDb, sidFor, starFor } from '@/data/sim/procedures';
import { transcript, speakable, airportName } from '@/data/sim/radio';
import { daysLabel, iataSeason, loadFactor, operatesOn, routeDays, seasonalWeight, leisureOf, daylight } from '@/data/sim/schedule';
import { loadSheet } from '@/data/sim/loadsheet';
import { specOf } from '@/data/sim/typeSpecs';

const airports = (JSON.parse(majorRaw) as { rows: AirportRow[] }).rows.map(decodeRow);
const runways = (JSON.parse(runwaysRaw) as { runways: Record<string, never[]> }).runways;
const navRows = JSON.parse(navRaw).rows;
const NOW = Date.UTC(2026, 6, 15, 14, 0, 0); // a summer Wednesday afternoon

let cached: World | null = null;
function world() {
  if (cached) return cached;
  const w = new World(42, airports, runways);
  w.setNavaids(navRows);
  w.populate(NOW, 0.5);
  w.populateExtra(NOW, 0.5, JSON.parse(heliRaw).rows, JSON.parse(glideRaw).rows);
  cached = w;
  return w;
}

describe('procedures on real navaids', () => {
  const nav = new NavDb(navRows);
  const lhr = airports.find((a) => a.ident === 'EGLL')!;

  it('leaves Heathrow towards Frankfurt over a real VOR to the east', () => {
    const sid = sidFor(nav, lhr, '27R', 105);
    expect(sid.fix.real).toBe(true);
    expect(['DVR', 'DET', 'LAM', 'BIG', 'CLN', 'SFD']).toContain(sid.fix.ident);
    expect(sid.name).toMatch(/^[A-Z]{3,5} \d[A-Z]$/);
  });

  it('arrives at Heathrow from the north over a real stack navaid', () => {
    const star = starFor(nav, lhr, '27L', 10);
    expect(star.fix.real).toBe(true);
    expect(distanceNm(lhr.lat, lhr.lon, star.fix.lat, star.fix.lon)).toBeGreaterThan(20);
    expect(distanceNm(lhr.lat, lhr.lon, star.fix.lat, star.fix.lon)).toBeLessThan(61);
  });

  it('falls back to a pronounceable generated waypoint', () => {
    const name = fixName('test');
    expect(name).toMatch(/^[BDFGKLMNPRSTVZ][AEIOU][BDFGKLMNPRSTVZ][AEIOU][BDFGKLMNPRSTVZ]$/);
    const sid = sidFor(null, lhr, '27R', 90);
    expect(sid.fix.real).toBe(false);
  });
});

describe('North Atlantic tracks', () => {
  it('builds westbound day tracks and eastbound night tracks along whole degrees', () => {
    const tr = natTracks(NOW, 42);
    expect(tr.filter((t) => !t.eastbound).map((t) => t.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(tr.filter((t) => t.eastbound)[0]!.letter).toBe('Z');
    for (const t of tr) for (const la of t.lats) expect(Number.isInteger(la)).toBe(true);
  });

  it('puts London–New York flights crossing 30°W at midday on a westbound track', () => {
    const lhr = { lat: 51.47, lon: -0.46 };
    const jfk = { lat: 40.64, lon: -73.78 };
    const day = Math.floor(NOW / 86_400_000) * 86_400_000;
    const nat = assignNat(lhr, jfk, day + 14 * 3_600_000, 42, 'x');
    expect(nat).not.toBeNull();
    expect(nat!.track.eastbound).toBe(false);
    expect(nat!.pts[0]![1]).toBe(-20);
    // Outside the validity window: random routing.
    expect(assignNat(lhr, jfk, day + 23 * 3_600_000, 42, 'x')).toBeNull();
  });

  it('routes real simulated transatlantic flights on the tracks', () => {
    const w = world();
    const nat = w.airframes.filter((a) => a.leg.route?.nat);
    expect(nat.length).toBeGreaterThan(5);
    for (const af of nat.slice(0, 10)) expect(af.leg.route!.text).toContain(`NAT ${af.leg.route!.nat!.letter}`);
  });

  it('flies over the track points: crossing 30°W at the track latitude', () => {
    const w = world();
    const nat = w.airframes.filter((a) => a.leg.route?.nat && !a.leg.emergency).slice(0, 15);
    for (const af of nat) {
      const lat30 = Number(af.leg.route!.nat!.text.split(' ')[1]!.split('/')[0]);
      let prev = w.state(af, af.leg.tTakeoff);
      let crossed: number | undefined;
      for (let t = af.leg.tTakeoff; t < af.leg.tLand && crossed === undefined; t += 60_000) {
        const s = w.state(af, t);
        if ((prev.lon + 30) * (s.lon + 30) <= 0) crossed = (prev.lat + s.lat) / 2;
        prev = s;
      }
      expect(crossed).toBeDefined();
      expect(Math.abs(crossed! - lat30)).toBeLessThan(0.3);
    }
  });
});

describe('runways, wake separation and ground movement', () => {
  it('spaces departures behind heavies further apart than behind mediums', () => {
    const w = world();
    // Departures from one runway: consecutive take-offs keep at least 60 s, and a light
    // or medium behind a heavy or super waits at least 2 minutes.
    const lhr = w.airframes.filter((a) => a.leg.from.ident === 'EGLL' && a.airline && !a.leg.canceled).map((a) => ({ t: a.leg.segs.find((s) => s.phase === 'takeoff')!.t0, w: a.leg.wake }));
    lhr.sort((a, b) => a.t - b.t);
    let checked = 0;
    for (let i = 1; i < lhr.length; i++) {
      const gap = lhr[i]!.t - lhr[i - 1]!.t;
      expect(gap).toBeGreaterThan(55_000);
      if ((lhr[i - 1]!.w === 'H' || lhr[i - 1]!.w === 'J') && (lhr[i]!.w === 'M' || lhr[i]!.w === 'L')) {
        expect(gap).toBeGreaterThan(115_000);
        checked++;
      }
    }
    expect(lhr.length).toBeGreaterThan(10);
    void checked;
  });

  it('taxis on named taxiways, stops before crossing a runway and names the exit', () => {
    const w = new World(3, airports, runways);
    const a = w.airports.get('EGLL')!;
    // A tiny synthetic taxiway network: a straight taxiway "A" crossing runway 09L/27R.
    const strip = a.strips.find((s) => s.name.includes('27R'))!;
    const mid: [number, number] = [(strip.a[0] + strip.b[0]) / 2, (strip.a[1] + strip.b[1]) / 2];
    const n: [number, number][] = [
      [mid[0] - 0.01, mid[1]],
      [mid[0], mid[1]],
      [mid[0] + 0.01, mid[1]],
    ];
    w.setTaxiGraph('EGLL', { nodes: n, adj: [[1], [0, 2], [1]], edgeNames: new Map([['0-1', 'A'], ['1-2', 'A']]), holds: [{ pt: n[0]!, ref: 'A1' }] }, NOW);
    const plan = (w as unknown as { taxiPlan: (a: unknown, f: unknown, t: unknown, m: string, r: string) => { via: string[]; crossings: { runway: string }[] } }).taxiPlan(a, n[0], n[2], 'in', '09R');
    expect(plan.via).toEqual(['A']);
    expect(plan.crossings.map((c) => c.runway)).toContain(strip.name);
  });

  it('holds departures at the gate when the departure queue is long', () => {
    const w = world();
    expect(w.airframes.some((a) => a.leg.gateHoldMs > 0)).toBe(true);
  });

  it('de-ices in freezing precipitation', () => {
    const w = new World(8, airports, runways);
    w.setWeather('EFHK', { category: 'IFR', tempC: -4, wx: '-SN', windDir: 220, windKt: 12, visSm: 2 });
    w.populate(Date.UTC(2026, 0, 15, 10), 0.6);
    const hel = w.airframes.filter((a) => a.leg.from.ident === 'EFHK' && a.airline && !a.leg.canceled);
    expect(hel.length).toBeGreaterThan(0);
    expect(hel.every((a) => a.leg.deiceMs > 0)).toBe(true);
    expect(hel[0]!.leg.events.some((e) => e.k === 'deice')).toBe(true);
  });
});

describe('special operations', () => {
  it('flies military, air-ambulance, offshore, shuttle and glider traffic', () => {
    const w = world();
    const roles = new Set(w.airframes.map((a) => a.role));
    for (const r of ['mil', 'hems', 'offshore', 'shuttle', 'glider', 'tow', 'ambulance']) expect(roles).toContain(r);
    const mil = w.airframes.filter((a) => a.role === 'mil');
    // US military aircraft use the US military ICAO address block (AE…).
    expect(mil.filter((a) => a.op?.icao === 'RCH').every((a) => a.hex.startsWith('ae') || a.hex.startsWith('af'))).toBe(true);
    // Tankers and AWACS orbit on station.
    const orbit = w.airframes.filter((a) => a.leg.kind === 'tanker' || a.leg.kind === 'awacs');
    expect(orbit.some((a) => a.leg.segs.some((s) => s.phase === 'orbit'))).toBe(true);
  });

  it('runs HEMS missions from a hospital to a scene and on to a hospital', () => {
    const w = world();
    const hems = w.airframes.find((a) => a.role === 'hems')!;
    expect(hems.home?.site).toBe('hospital');
    let leg = hems.leg;
    const sites: string[] = [];
    for (let i = 0; i < 4; i++) {
      w.advance(leg.tOn + leg.turnAfter + 1);
      leg = hems.leg;
      sites.push(leg.to.site ?? 'airport');
    }
    expect(sites).toContain('scene');
    expect(sites).toContain('hospital');
  });

  it('only launches gliders in daylight and thermals up in circles', () => {
    const w = world();
    const gl = w.airframes.filter((a) => a.role === 'glider');
    expect(gl.length).toBeGreaterThan(10);
    for (const af of gl.slice(0, 40)) {
      const h = (((af.leg.tOff / 3_600_000 + af.leg.from.lon / 15) % 24) + 24) % 24;
      const { rise, set } = daylight(af.leg.tOff, af.leg.from.lat);
      expect(h).toBeGreaterThanOrEqual(Math.min(rise + 2.4, 9.4));
      expect(h).toBeLessThanOrEqual(Math.min(set - 0.9, 18.6));
    }
    const soar = gl[0]!.leg.segs.filter((s) => s.phase === 'soaring');
    expect(soar.length).toBeGreaterThan(1);
    expect(soar.some((s) => s.alt1 > s.alt0)).toBe(true);
  });

  it('diverts emergencies to the nearest suitable airport with squawk 7700', () => {
    const w = new World(77, airports, runways);
    w.setNavaids(navRows);
    w.populate(NOW, 0.75);
    let found = w.airframes.filter((a) => a.leg.emergency);
    for (let k = 1; k < 30 && !found.some((a) => a.leg.emergency!.kind !== 'medical'); k++) {
      w.advance(NOW + k * 3_600_000);
      found = w.airframes.filter((a) => a.leg.emergency);
    }
    expect(found.length).toBeGreaterThan(0);
    const af = found.find((a) => a.leg.emergency!.kind !== 'medical') ?? found[0]!;
    const e = af.leg.emergency!;
    expect(af.leg.to).toBe(e.divertTo);
    if (e.kind !== 'medical') expect(w.squawkAt(af, e.t + 60_000)).toBe('7700');
    expect(af.leg.events.some((x) => x.k === 'emergency')).toBe(true);
  }, 120_000);
});

describe('timetable', () => {
  it('runs thin routes on fixed weekdays and trunk routes daily', () => {
    const thin = routeDays('BAW', 'EGLL', 'LGKR', { distNm: 1300, hubEnd: true, bothLarge: false, leisure: 'summer-sun', model: 'full' });
    expect(thin.perWeek).toBeLessThan(7);
    expect(daysLabel(thin)).not.toBe('Daily');
    const trunk = routeDays('BAW', 'EGLL', 'KJFK', { distNm: 3000, hubEnd: true, bothLarge: true, leisure: null, model: 'full' });
    expect(daysLabel(trunk)).toBe('Daily');
    expect([0, 1, 2, 3, 4, 5, 6].filter((d) => operatesOn(thin, d)).length).toBe(thin.perWeek);
  });

  it('knows IATA seasons and seasonal leisure demand', () => {
    expect(iataSeason(NOW).code).toBe('S26');
    expect(iataSeason(Date.UTC(2026, 11, 20)).code).toBe('W26');
    expect(iataSeason(Date.UTC(2026, 1, 1)).code).toBe('W25');
    const palma = leisureOf('LEPA', 39.55, 2.73);
    expect(palma).toBe('summer-sun');
    expect(seasonalWeight(palma, Date.UTC(2026, 7, 1), 'low')).toBeGreaterThan(seasonalWeight(palma, Date.UTC(2026, 1, 1), 'low') * 4);
    expect(leisureOf('LOWI', 47.26, 11.34)).toBe('ski');
  });

  it('fills low-cost flights fuller than full-service ones on average', () => {
    const avg = (model: 'low' | 'full') => {
      let s = 0;
      for (let i = 0; i < 200; i++) s += loadFactor({ model, flight: `X${i}`, std: NOW + i * 3_600_000, fromLon: 0, leisure: null, longHaul: false });
      return s / 200;
    };
    expect(avg('low')).toBeGreaterThan(avg('full'));
  });
});

describe('load sheet', () => {
  it('produces a plausible A320 load sheet within structural limits', () => {
    const spec = specOf('A320')!;
    const s = loadSheet({ spec, model: 'low', lf: 0.92, seed: 1, airborneH: 2.2, taxiMin: 15 });
    expect(s.pax).toBeGreaterThan(150);
    expect(s.pax).toBeLessThanOrEqual(s.seats);
    expect(s.towKg).toBeLessThanOrEqual(spec.mtowKg);
    expect(s.blockFuelKg).toBeGreaterThan(s.tripFuelKg);
    expect(s.tripFuelKg).toBeGreaterThan(4000);
    expect(s.tripFuelKg).toBeLessThan(8000);
  });

  it('carries no passengers on positioning flights and none on freighters', () => {
    expect(loadSheet({ spec: specOf('B738')!, model: 'full', lf: 0.8, seed: 2, airborneH: 1, taxiMin: 10, positioning: true }).pax).toBe(0);
    const f = loadSheet({ spec: specOf('MD11')!, model: 'cargo', lf: 0.8, seed: 3, airborneH: 5, taxiMin: 12 });
    expect(f.freighter).toBe(true);
    expect(f.cargoKg).toBeGreaterThan(20_000);
  });
});

describe('radio transcript', () => {
  it('reads an airline flight gate to gate in standard phraseology', () => {
    const w = world();
    const af = w.airframes.find((a) => a.airline && a.leg.from.ident === 'EGLL' && !a.leg.canceled && a.leg.route)!;
    const lines = transcript({ leg: af.leg, callsign: 'Speedbird 123', wake: af.leg.wake, freq: () => 118.7, countryAt: () => 'GB', squawk: af.squawk, typeName: af.type.desc, fmtTime: () => '12:00', ga: false });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/request clearance to/);
    expect(text).toMatch(/push and start approved/);
    expect(text).toMatch(/cleared for take-off/);
    expect(text).toMatch(/cleared to land/);
    expect(lines[0]!.station).toMatch(/Heathrow/);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.t).toBeGreaterThanOrEqual(lines[i - 1]!.t);
  });

  it('names airports the way their towers do and speaks numbers the ATC way', () => {
    const w = world();
    expect(airportName(w.airports.get('EGLL')!)).toBe('Heathrow');
    expect(airportName(w.airports.get('KJFK')!)).toBe('Kennedy');
    expect(speakable('climb flight level 350')).toBe('climb flight level three five zero');
    expect(speakable('runway 27R')).toBe('runway two seven right');
  });
});
