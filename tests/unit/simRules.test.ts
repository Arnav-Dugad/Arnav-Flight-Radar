import majorRaw from '../../public/data/airports/index-major.json?raw';
import runwaysRaw from '../../public/data/airports/runways-major.json?raw';
import airwaysRaw from '../../public/data/sim/airways-us.json?raw';
import procsRaw from '../../public/data/sim/procedures-us.json?raw';
import { describe, expect, it, vi } from 'vitest';
import { decodeRow, type AirportRow } from '@shared/airports';
import { World } from '@/data/sim/engine';
import { curfewEnd, segregatedPair } from '@/data/sim/runwayConfig';
import { acmiFor, etopsFor, maintenanceDue } from '@/data/sim/opsRules';

vi.setConfig({ testTimeout: 120_000 });

const airports = (JSON.parse(majorRaw) as { rows: AirportRow[] }).rows.map(decodeRow);
const runways = (JSON.parse(runwaysRaw) as { runways: Record<string, never[]> }).runways;
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // mid-July: summer wet leases are flying

let shared: World | null = null;
function world() {
  if (shared) return shared;
  const w = new World(5, airports, runways);
  w.setUsProcedures(JSON.parse(procsRaw));
  w.setUsAirways(JSON.parse(airwaysRaw));
  w.populate(NOW, 0.4);
  for (let k = 1; k <= 24; k++) w.advance(NOW + k * 3_600_000);
  shared = w;
  return w;
}

describe('runway configuration rules', () => {
  it('pairs independent parallels in segregated mode and leaves single runways mixed', () => {
    const lhr = world().airports.get('EGLL')!;
    const pair = segregatedPair(lhr.runways, lhr.runways.find((r) => r.ident.startsWith('27'))!, 'EGLL', NOW, lhr.lon);
    expect(pair).toBeTruthy();
    expect(pair!.arr.ident.slice(0, 2)).toBe('27');
    expect(pair!.dep.ident).not.toBe(pair!.arr.ident);
    const lgw = world().airports.get('EGKK')!;
    // Gatwick's two runways are too close to be used at the same time.
    expect(segregatedPair(lgw.runways, lgw.runways[0]!, 'EGKK', NOW, lgw.lon)).toBeUndefined();
  });

  it('knows when a night curfew is in force and when it lifts', () => {
    const fra = world().airports.get('EDDF')!;
    // 23:30 local (UTC+1 by longitude) is inside Frankfurt's 23:00–05:00 curfew.
    const t = Date.UTC(2026, 6, 15, 22, 30) - (fra.lon / 15 - 1) * 3_600_000;
    const lift = curfewEnd('EDDF', t, fra.lon);
    expect(lift).not.toBeNull();
    expect((lift! - t) / 3_600_000).toBeCloseTo(5.5, 1);
    expect(curfewEnd('EDDF', Date.UTC(2026, 6, 15, 12), fra.lon)).toBeNull();
  });

  it('schedules no airline take-offs from Frankfurt during its curfew', () => {
    const w = world();
    const fra = w.airports.get('EDDF')!;
    let checked = 0;
    for (const af of w.airframes) {
      for (const leg of [af.prev, af.leg]) {
        if (!leg || !af.airline || leg.from !== fra || leg.canceled || leg.tOff <= NOW + 3_600_000) continue;
        expect(curfewEnd('EDDF', leg.tTakeoff, fra.lon)).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('real US airways', () => {
  it('files domestic US jets along published J and Q airways', () => {
    const w = world();
    const us = w.airframes.filter((af) => af.leg.route?.airways && af.leg.from.country === 'US' && af.leg.to.country === 'US');
    expect(us.length).toBeGreaterThan(20);
    const r = us[0]!.leg.route!;
    expect(r.airways).toMatch(/^FAA CIFP \d{4}$/);
    expect(r.text).toMatch(/\b[JQVT]\d+\b/);
    expect(r.via.every((f) => f.real)).toBe(true);
  });
});

describe('ETOPS, maintenance and wet leases', () => {
  it('needs ETOPS for twins crossing the North Atlantic and lists en-route alternates', () => {
    const w = world();
    const twins = w.airframes.filter((af) => ['B77W', 'B789', 'A359', 'A333', 'B763', 'A339', 'B788'].includes(af.type.code) && af.leg.from.country !== af.leg.to.country);
    const atlantic = twins.filter((af) => (af.leg.from.lon < -50 && af.leg.to.lon > -15) || (af.leg.to.lon < -50 && af.leg.from.lon > -15));
    expect(atlantic.length).toBeGreaterThan(3);
    const e = w.etops(atlantic[0]!);
    expect(e).not.toBeNull();
    expect(e!.minutes).toBeGreaterThanOrEqual(120);
    expect(e!.alternates.length).toBeGreaterThanOrEqual(2);
    // Four-engine aircraft are not ETOPS flights.
    const quad = w.airframes.find((af) => ['A388', 'B748', 'B744'].includes(af.type.code));
    if (quad) expect(w.etops(quad)).toBeNull();
  });

  it('computes the rule time from the farthest point from land', () => {
    const route: [number, number][] = [
      [40, -70],
      [50, -30],
      [51, -5],
    ];
    const adequate = [
      { ident: 'KBOS', name: 'Boston', lat: 42.36, lon: -71 },
      { ident: 'EINN', name: 'Shannon', lat: 52.7, lon: -8.9 },
    ];
    const e = etopsFor(route, adequate, 400)!;
    expect(e.minutes).toBeGreaterThanOrEqual(180);
    expect(e.alternates.map((a) => a.ident)).toEqual(['KBOS', 'EINN']);
    expect(etopsFor([[51, -1], [52, 4]], [{ ident: 'EGLL', name: 'Heathrow', lat: 51.47, lon: -0.45 }], 400)).toBeNull();
  });

  it('takes aircraft out of service for overnight A-checks and rare C-checks', () => {
    expect(maintenanceDue(0.01, 23, true)?.check).toBe('A-check');
    expect(maintenanceDue(0.001, 23, true)?.check).toBe('C-check');
    expect(maintenanceDue(0.01, 12, true)).toBeNull();
    expect(maintenanceDue(0.01, 23, false)).toBeNull();
    const w = world();
    const m = w.airframes.filter((af) => af.leg.maint || af.prev?.maint);
    expect(m.length).toBeGreaterThan(0);
    for (const af of m) {
      const leg = af.leg.maint ? af.leg : af.prev!;
      expect(af.airline!.hubs).toContain(leg.from.ident);
      expect(leg.tOff).toBeGreaterThanOrEqual(leg.maint!.until - 60_000);
    }
  });

  it('flies some summer flights with wet-leased aircraft and crews', () => {
    expect(acmiFor('BAW', 'A320', 'narrow', NOW, 1, 0.01)?.name).toBeTruthy();
    expect(acmiFor('BAW', 'A320', 'narrow', Date.UTC(2026, 0, 15), 1, 0.01)).toBeUndefined();
    expect(acmiFor('XXX', 'A320', 'narrow', NOW, 1, 0.01)).toBeUndefined();
    const w = world();
    const leased = w.airframes.filter((af) => af.acmi);
    expect(leased.length).toBeGreaterThan(0);
    for (const af of leased) {
      expect(af.airline).toBeTruthy();
      // The lessor's registration (e.g. LY-, YL-, G-, CS-, EC-, TF-).
      expect(af.reg.startsWith(af.acmi!.prefix)).toBe(true);
    }
  });
});

describe('published procedures for the airport panel', () => {
  it('lists the published FAA SIDs and STARs for the runways in use at JFK', () => {
    const w = world();
    const jfk = w.airports.get('KJFK')!;
    const p = w.airportProcedures(jfk, NOW);
    expect(p.published).toBe(true);
    expect(p.sids.length + p.stars.length).toBeGreaterThan(2);
    for (const s of [...p.sids, ...p.stars]) expect(s.fixes!.length).toBeGreaterThanOrEqual(2);
    const lhr = w.airportProcedures(w.airports.get('EGLL')!, NOW);
    expect(lhr.published).toBe(false);
    expect(lhr.sids.length).toBeGreaterThan(1);
  });
});
