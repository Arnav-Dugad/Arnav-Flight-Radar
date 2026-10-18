import awyRaw from '../../public/data/sim/airways-us.json?raw';
import procRaw from '../../public/data/sim/procedures-us.json?raw';
import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceNm } from '@shared/geo';
import {
  airwayString,
  buildAirwayGraph,
  routeLengthNm,
  routeViaAirways,
  type AirwayLeg,
  type AirwaysData,
  type RawAirway,
} from '@/data/sim/usAirways';
import { pickSid, pickStar, type ProceduresData } from '@/data/sim/usProcedures';

// The ARINC 424 parser lives in the build script (plain .mjs, no type declarations).
interface FixRec {
  key: string;
  ident: string;
  lat: number;
  lon: number;
  kind?: number;
  name?: string;
}
interface AwyRec {
  id: string;
  seq: number;
  fix: string;
  fixKey: string | null;
  end: boolean;
  level: string;
  dir: string;
  min: number | null;
  max: number | null;
}
interface AirwaysModule {
  parseFixRecord(line: string): FixRec | null;
  parseAirwayRecord(line: string): AwyRec | null;
  buildAirways(records: AwyRec[], fixes: Map<string, FixRec>): { fixes: AirwaysData['fixes']; airways: RawAirway[] };
}
const scriptPath = '../../scripts/build-airways.mjs';
const build = (await import(/* @vite-ignore */ scriptPath)) as AirwaysModule;

const data = JSON.parse(awyRaw) as AirwaysData;
const procs = JSON.parse(procRaw) as ProceduresData;

// Real CIFP 2610 records (FAA, public domain): the first legs of J60 and their fixes.
const ER = [
  'SUSAER       J60         0100LAX  K2D 0V    OH                        07590451     18000     45000                         574872010',
  'SUSAER       J60         0110PDZ  K2D 0V    OH                        029900990764 18000     45000                         574882010',
  'SUSAER       J60         0120CIVETK2EA0E    OH                        029903010305 18000     45000                         574892010',
  'SUSAER       J60         0130RESORK2EA0EE   OH                        029903470305 18000     45000                         574902010',
];
const FIXES = [
  'SUSAD        LAX   K2011360VTHW N33555934W118255525    N33560033W118255677E0150001852     NARLOS ANGELES                   254832510',
  'SUSAD        PDZ   K2011220VTHW N33550601W117314799    N33550685W117314642E0150014322     NARPARADISE                      257162012',
  'SUSAEAENRT   CIVET K20    R   B N34020696W117232378                       E0112     NAR           CIVET                    315572605',
  'SUSAEAENRT   RESOR K20    C   B N34232422W116574079                       E0112     NAR           RESOR                    481912504',
];
const setCol = (line: string, c: number, ch: string) => line.slice(0, c - 1) + ch + line.slice(c);

function fixtureData(er = ER): AirwaysData {
  const fixes = new Map<string, FixRec>();
  for (const l of FIXES) {
    const f = build.parseFixRecord(l);
    if (f) fixes.set(f.key, f);
  }
  const recs = er.map((l) => build.parseAirwayRecord(l)).filter((r): r is AwyRec => !!r);
  return { v: 1, source: 'fixture', cycle: '2610', ...build.buildAirways(recs, fixes) };
}

/** True when fixes a → b are consecutive on a segment of `airway` (either direction). */
function onAirway(d: AirwaysData, airway: string, a: AirwayLeg, b: AirwayLeg): boolean {
  const same = (i: number, l: AirwayLeg) => {
    const f = d.fixes[i]!;
    return f[0] === l.ident && f[1] === l.lat && f[2] === l.lon;
  };
  return d.airways.some(
    (s) => s.a === airway && s.f.some((i, k) => k + 1 < s.f.length && ((same(i, a) && same(s.f[k + 1]!, b)) || (same(i, b) && same(s.f[k + 1]!, a)))),
  );
}

describe('build-airways (ARINC 424 ER records)', () => {
  it('parses airway and fix records', () => {
    const r = build.parseAirwayRecord(ER[0]!)!;
    expect(r).toMatchObject({ id: 'J60', seq: 100, fix: 'LAX', fixKey: 'D|LAX|K2', end: false, level: 'H', dir: ' ', min: 18000, max: 45000 });
    expect(build.parseAirwayRecord(ER[3]!)!.end).toBe(true);
    const lax = build.parseFixRecord(FIXES[0]!)!;
    expect(lax).toMatchObject({ key: 'D|LAX|K2', ident: 'LAX', kind: 2, name: 'Los Angeles' });
    expect(lax.lat).toBeCloseTo(33.9332, 3);
    expect(lax.lon).toBeCloseTo(-118.4320, 3);
    expect(build.parseFixRecord(FIXES[2]!)).toMatchObject({ key: 'EA|CIVET|K2', ident: 'CIVET' });
    expect(build.parseFixRecord(FIXES[2]!)!.kind).toBeUndefined();
  });

  it('builds a compact fix table and segments, and a graph from them', () => {
    const d = fixtureData();
    expect(d.fixes.map((f) => f[0])).toEqual(['LAX', 'PDZ', 'CIVET', 'RESOR']);
    expect(d.fixes[0]).toEqual(['LAX', 33.9332, -118.432, 2, 'Los Angeles']);
    expect(d.airways).toEqual([{ a: 'J60', l: 'H', f: [0, 1, 2, 3], m: 180, x: 450 }]);
    const g = buildAirwayGraph(d);
    expect(g.to.length).toBe(6); // 3 legs, both directions
    expect(g.names).toEqual(['J60']);
    // PDZ connects to LAX and CIVET.
    const pdz = [...g.to.slice(g.start[1]!, g.start[2]!)].sort();
    expect(pdz).toEqual([0, 2]);
  });

  it('breaks an airway at an end-of-route marker and at unknown fixes', () => {
    const er = [ER[0]!, setCol(ER[1]!, 41, 'E'), ER[2]!, ER[3]!];
    expect(fixtureData(er).airways.map((s) => s.f)).toEqual([[0, 1], [2, 3]]);
    const missing = [ER[0]!, ER[1]!, ER[2]!.replace('CIVET', 'NOFIX'), ER[3]!];
    expect(fixtureData(missing).airways.map((s) => s.f)).toEqual([[0, 1]]);
  });

  it('honours one-way legs', () => {
    // PDZ → CIVET coded forward only.
    const d = fixtureData([ER[0]!, setCol(ER[1]!, 47, 'F'), ER[2]!, ER[3]!]);
    expect(d.airways[0]!.d).toBe(' F ');
    const g = buildAirwayGraph(d);
    expect(g.to.length).toBe(5);
    const east = routeViaAirways(d, 'LAX', 'RESOR', { high: true, maxDetourRatio: 2 });
    expect(east?.map((l) => l.ident)).toEqual(['LAX', 'PDZ', 'CIVET', 'RESOR']);
    expect(routeViaAirways(d, 'RESOR', 'LAX', { high: true, maxDetourRatio: 2 })).toBeNull();
    // Without the restriction the reverse route exists.
    expect(routeViaAirways(fixtureData(), 'RESOR', 'LAX', { high: true, maxDetourRatio: 2 })?.map((l) => l.ident)).toEqual(['RESOR', 'CIVET', 'PDZ', 'LAX']);
    // Low airways are not used for a high route and vice versa.
    expect(routeViaAirways(fixtureData(), 'LAX', 'RESOR', { high: false, maxDetourRatio: 2 })).toBeNull();
  });
});

describe('routeViaAirways — synthetic network', () => {
  // A square A-B-C with a fast but one-way diagonal and a two-airway alternative.
  const net: AirwaysData = {
    v: 1,
    source: 'test',
    cycle: '0000',
    fixes: [
      ['AAAAA', 40, -80],
      ['BBBBB', 40, -78],
      ['CCCCC', 40, -76],
      ['DDDDD', 40.6, -78],
    ],
    airways: [
      { a: 'J1', l: 'H', f: [0, 1, 2], d: 'BB' }, // westbound only
      { a: 'J2', l: 'H', f: [0, 3] },
      { a: 'J3', l: 'H', f: [3, 2] },
    ],
  };
  it('takes the direct airway when allowed and detours around one-way legs', () => {
    expect(routeViaAirways(net, 'CCCCC', 'AAAAA', { high: true })?.map((l) => `${l.airway}:${l.ident}`)).toEqual(['DCT:CCCCC', 'J1:BBBBB', 'J1:AAAAA']);
    const east = routeViaAirways(net, 'AAAAA', 'CCCCC', { high: true })!;
    expect(east.map((l) => l.ident)).toEqual(['AAAAA', 'DDDDD', 'CCCCC']);
    expect(airwayString(east)).toBe('AAAAA J2 DDDDD J3 CCCCC');
  });
  it('rejects routes beyond the detour ratio', () => {
    expect(routeViaAirways(net, 'AAAAA', 'CCCCC', { high: true, maxDetourRatio: 1.01 })).toBeNull();
  });
  it('joins and leaves airways near off-airway points', () => {
    const r = routeViaAirways(net, { lat: 40.1, lon: -80.2 }, { lat: 39.9, lon: -75.9 }, { high: true, maxDetourRatio: 1.3 })!;
    expect(r[0]!.ident).toBe('AAAAA');
    expect(r.at(-1)!.ident).toBe('CCCCC');
    expect(routeViaAirways(net, { lat: 30, lon: -100 }, 'CCCCC', { high: true })).toBeNull();
  });
});

describe('airwayString', () => {
  it('collapses consecutive legs on one airway', () => {
    const L = (ident: string, airway: string) => ({ ident, airway });
    expect(airwayString([L('CANDR', 'DCT'), L('NEWEL', 'J60'), L('GYNTS', 'J60'), L('PSB', 'J60'), L('X1', 'J584'), L('SLT', 'J584')])).toBe('CANDR J60 PSB J584 SLT');
    const r = [L('CANDR', 'DCT'), L('PSB', 'J60')];
    expect(airwayString(r, { from: 'CANDR', to: 'PSB' })).toBe('CANDR J60 PSB');
    expect(airwayString(r, { from: 'DEEZZ', to: 'HAYNZ' })).toBe('DEEZZ DCT CANDR J60 PSB DCT HAYNZ');
    expect(airwayString([L('A', 'DCT')])).toBe('A');
    expect(airwayString([])).toBe('');
  });
});

describe('real FAA airways (CIFP)', () => {
  it('has the US network with source and cycle', () => {
    expect(data.source).toMatch(/^FAA CIFP \d{4} \(public domain\)$/);
    expect(data.cycle).toMatch(/^\d{4}$/);
    const ids = new Set(data.airways.map((s) => s.a));
    for (const id of ['J60', 'J80', 'V16', 'Q480', 'T295']) expect(ids.has(id)).toBe(true);
    expect(ids.size).toBeGreaterThan(1000);
    for (const s of data.airways) for (const i of s.f) expect(data.fixes[i]).toBeDefined();
  });

  it('routes KJFK → KORD on high airways from the SID exit to the STAR entry', () => {
    const jfk = procs.airports.KJFK!;
    const ord = procs.airports.KORD!;
    const sid = pickSid(procs, 'KJFK', 'ALL', bearingDeg(jfk.lat, jfk.lon, ord.lat, ord.lon))!;
    const star = pickStar(procs, 'KORD', 'ALL', bearingDeg(ord.lat, ord.lon, jfk.lat, jfk.lon))!;
    expect(sid).not.toBeNull();
    expect(star).not.toBeNull();
    const a = sid.fixes.at(-1)!;
    const z = star.fixes[0]!;
    const route = routeViaAirways(data, a, z, { high: true })!;
    expect(route).not.toBeNull();
    expect(`${sid.name} ${airwayString(route)} ${star.name}`).toMatch(/^\w+\d [A-Z]{2,5}( [JQ]\d+ [A-Z]{2,5})+ \w+\d$/);
    expect(route.length).toBeGreaterThan(3);
    expect(route[0]!.airway).toBe('DCT');
    // A SID exit fix that is itself on a high airway is where the airway route starts.
    const onHigh = (ident: string) => data.airways.some((s) => s.l !== 'L' && s.f.some((i) => data.fixes[i]![0] === ident));
    if (onHigh(a.ident)) expect(route[0]!.ident).toBe(a.ident);
    if (onHigh(z.ident)) expect(route.at(-1)!.ident).toBe(z.ident);
    // Every leg is a real leg of the named airway.
    for (let i = 1; i < route.length; i++) expect(onAirway(data, route[i]!.airway, route[i - 1]!, route[i]!), `${route[i - 1]!.ident} ${route[i]!.airway} ${route[i]!.ident}`).toBe(true);
    // High airways only.
    for (let i = 1; i < route.length; i++) expect(route[i]!.airway).toMatch(/^[JQ]/);
    // Joins near the SID exit, leaves near the STAR entry.
    expect(distanceNm(a.lat, a.lon, route[0]!.lat, route[0]!.lon)).toBeLessThan(60);
    expect(distanceNm(z.lat, z.lon, route.at(-1)!.lat, route.at(-1)!.lon)).toBeLessThan(60);
    // Bounded detour and steady progress towards the arrival.
    const gc = distanceNm(a.lat, a.lon, z.lat, z.lon);
    const len = distanceNm(a.lat, a.lon, route[0]!.lat, route[0]!.lon) + routeLengthNm(route) + distanceNm(route.at(-1)!.lat, route.at(-1)!.lon, z.lat, z.lon);
    expect(len / gc).toBeLessThanOrEqual(1.25);
    for (let i = 1; i < route.length; i++) {
      const before = distanceNm(route[i - 1]!.lat, route[i - 1]!.lon, z.lat, z.lon);
      const after = distanceNm(route[i]!.lat, route[i]!.lon, z.lat, z.lon);
      expect(after).toBeLessThan(before + 10);
    }
    // Cached: the same answer, as a fresh copy.
    const again = routeViaAirways(data, a, z, { high: true })!;
    expect(again).toEqual(route);
    expect(again).not.toBe(route);
  });

  it('finds sensible routes across the country on high and low airways', () => {
    const at = (icao: string) => ({ lat: procs.airports[icao]!.lat, lon: procs.airports[icao]!.lon });
    const pairs: [string, { lat: number; lon: number }, { lat: number; lon: number }, boolean, RegExp][] = [
      ['KLAX-KJFK', at('KLAX'), at('KJFK'), true, /^[JQ]/],
      ['KSEA-KDFW', at('KSEA'), at('KDFW'), true, /^[JQ]/],
      ['KATL-KDEN', at('KATL'), at('KDEN'), true, /^[JQ]/],
      ['KBOS-KDCA', at('KBOS'), at('KDCA'), false, /^[VT]/],
      // Alaska: Victor, T and colored airways.
      ['PANC-PAFA', at('PANC'), { lat: 64.8151, lon: -147.8564 }, false, /^[VTABGR]/],
    ];
    for (const [name, A, Z, high, re] of pairs) {
      const route = routeViaAirways(data, A, Z, { high })!;
      expect(route, name).not.toBeNull();
      for (let i = 1; i < route.length; i++) {
        expect(onAirway(data, route[i]!.airway, route[i - 1]!, route[i]!), name).toBe(true);
        expect(route[i]!.airway, name).toMatch(re);
      }
    }
  });
});
