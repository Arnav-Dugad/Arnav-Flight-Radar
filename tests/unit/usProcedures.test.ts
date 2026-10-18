import procRaw from '../../public/data/sim/procedures-us.json?raw';
import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceNm } from '@shared/geo';
import {
  normalizeRunway,
  parseConstraint,
  pickSid,
  pickStar,
  type ProceduresData,
  type ProcTrack,
} from '@/data/sim/usProcedures';

// The ARINC 424 parser lives in the build script (plain .mjs, no type declarations).
interface ArincModule {
  parseLat(s: string): number | null;
  parseLon(s: string): number | null;
  parseAlt(s: string): number | null;
  parseRecord(line: string): Record<string, unknown> | null;
  expandRunway(trans: string, runways: string[]): string[];
  buildProcedures(
    legs: unknown[],
    fixes: Map<string, [number, number]>,
    runways: string[],
  ): { sids: ProceduresData['airports'][string]['sids']; stars: ProceduresData['airports'][string]['stars'] };
}
const scriptPath = '../../scripts/build-procedures.mjs';
const arinc = (await import(/* @vite-ignore */ scriptPath)) as ArincModule;

const data = JSON.parse(procRaw) as ProceduresData;

// Real FAA CIFP 2610 records (public domain), 132 characters each.
const SAMPLE = [
  'SUSAP KJFKK6AJFK     0     145YHN40382374W073464329W013000013         1800018000C    MNAR    JOHN F KENNEDY INTL           305031912',
  'SUSAP KJFKK6GRW04L   0120790440 N40372318W073470505         -0028300012046057200IIHIQ1                                     309641709',
  'SUSAP KJFKK6GRW04R   0084000440 N40373154W073461324         -0028400012000053200IIJFK3                                     309652308',
  'SUSAP KJFKK6GRW31L   0145113140 N40375728W073465479         -0028100013326458200IIMOH1                                     309702308',
  'SUSAP KJFKK6GRW31R   0100003140 N40384260W073454483         -0028100013102742200IIRTH1                                     309712504',
  'SUSAP KJFKK6CCESID K60    W     N40322484W073512504                       W0125     NAR           CESID                    305122605',
  'SUSAP KJFKK6CPONAE K60    W     N40401997W073444686                       W0126     NAR           PONAE                    305452603',
  'SUSAP KJFKK6CSKORR K60    W     N40354701W073532184                       W0125     NAR           SKORR                    305542605',
  'SUSAP KJFKK6CYNKEE K60    W     N40290090W073505718                       W0125     NAR           YNKEE                    305622605',
  'SUSAP KJFKK6CBOTON K60    R     N39245210W074271708                       W0121     NAR           BOTON                    305062506',
  'SUSAEAENRT   CANDR K60    C   H N40581555W074573538                       W0121     NAR           CANDR                    301682504',
  'SUSAEAENRT   DEEZZ K60    C     N41065200W073464000                       W0126     NAR           DEEZZ                    328292605',
  'SUSAEAENRT   HEERO K60    W     N41100788W074065609                       W0125     NAR           HEERO                    373362605',
  'SUSAEAENRT   KURNL K60    W     N41120470W074273037                       W0124     NAR           KURNL                    424822504',
  'SUSAD        SIE   K6011480VTHW N39054383W074480124    N39054383W074480124W0090000082     NARSEA ISLE                      258402609',
  'SUSADB       AA    K3003650HOLW N47003259W096485466                       E0040           NARKENIE                         268621805',
  'SUSAP KJFKK6DDEEZZ64RW04L 010         0        VA                     0438        + 00520     18000       KJFK  K6PA       305672603',
  'SUSAP KJFKK6DDEEZZ64RW04L 020PONAEK6PC0EY      DF                                                                          305682603',
  'SUSAP KJFKK6DDEEZZ64RW04L 030         0 E      VM                     0990                                                 305692603',
  'SUSAP KJFKK6DDEEZZ64RW04R 010         0        VA                     0438        + 00520     18000                        305702603',
  'SUSAP KJFKK6DDEEZZ64RW04R 020         0 E      VM                     0990                                                 305712603',
  'SUSAP KJFKK6DDEEZZ64RW31B 010         0        VA                     3138        + 00520     18000                        305722603',
  'SUSAP KJFKK6DDEEZZ64RW31B 020SKORRK6PC0E   L   DF                                 + 02500          210               -     305732603',
  'SUSAP KJFKK6DDEEZZ64RW31B 030CESIDK6PC0E       TF                                 + 02500          250               -     305742603',
  'SUSAP KJFKK6DDEEZZ64RW31B 040YNKEEK6PC0E       TF                                                                          305752603',
  'SUSAP KJFKK6DDEEZZ64RW31B 050YNKEEK6PC0EE      FM CCC K6      254205491870    D                                            305762603',
  'SUSAP KJFKK6DDEEZZ65      010DEEZZK6EA0E       IF                                             18000                        305772603',
  'SUSAP KJFKK6DDEEZZ65      020HEEROK6EA0EE      TF                                                                          305782603',
  'SUSAP KJFKK6DDEEZZ66CANDR 010HEEROK6EA0E       IF                                             18000                        305792603',
  'SUSAP KJFKK6DDEEZZ66CANDR 020KURNLK6EA0E       TF                                                                          305802603',
  'SUSAP KJFKK6DDEEZZ66CANDR 030CANDRK6EA0EE      TF                                                                          305812603',
  'SUSAP KJFKK6ECAMRN52ALL   010SIE  K6D 0V       IF                                             18000                        305942506',
  'SUSAP KJFKK6ECAMRN52ALL   020BOTONK6PC0E       TF                                                                          305952506',
  'SUSAP 05C K5ELUCIT34COOKS 040ROEPRK5EA0E       TF                                 B 1300011000                             793362411',
];

describe('ARINC 424 parsing (FAA CIFP)', () => {
  it('decodes hemisphere DDMMSSss coordinates', () => {
    expect(arinc.parseLat('N40401997')).toBeCloseTo(40.672214, 5);
    expect(arinc.parseLon('W073444686')).toBeCloseTo(-73.746350, 5);
    expect(arinc.parseLat('S33565000')).toBeCloseTo(-33.947222, 5);
    expect(arinc.parseLon('E151104200')).toBeCloseTo(151.178333, 5);
    expect(arinc.parseLat('N4040')).toBeNull();
    expect(arinc.parseAlt('02500')).toBe(2500);
    expect(arinc.parseAlt('FL240')).toBe(24000);
    expect(arinc.parseAlt('     ')).toBeNull();
  });

  it('classifies waypoint, navaid, airport and procedure records', () => {
    expect(SAMPLE.every((l) => l.length === 132)).toBe(true);
    const [apt, , , , , , ponae] = SAMPLE.map((l) => arinc.parseRecord(l));
    expect(apt).toMatchObject({ kind: 'fix', key: 'PA|KJFK' });
    expect(ponae).toMatchObject({ kind: 'fix', key: 'PC|KJFK|PONAE' });
    expect(arinc.parseRecord(SAMPLE[12]!)).toMatchObject({ kind: 'fix', key: 'EA|HEERO|K6' });
    expect(arinc.parseRecord(SAMPLE[14]!)).toMatchObject({ kind: 'fix', key: 'D|SIE|K6' });
    expect(arinc.parseRecord(SAMPLE[15]!)).toMatchObject({ kind: 'fix', key: 'DB|AA|K3' });
    const leg = arinc.parseRecord(SAMPLE[22]!);
    expect(leg).toMatchObject({
      kind: 'leg',
      airport: 'KJFK',
      sub: 'D',
      proc: 'DEEZZ6',
      routeType: '4',
      trans: 'RW31B',
      seq: 20,
      fix: 'SKORR',
      fixKey: 'PC|KJFK|SKORR',
      leg: 'DF',
      alt: '+2500',
    });
    expect(arinc.parseRecord(SAMPLE[33]!)).toMatchObject({ proc: 'LUCIT3', trans: 'COOKS', alt: 'B13000/11000' });
    expect(arinc.parseRecord('HDR01FAACIFP18')).toBeNull();
  });

  it('assembles runway transitions, common route and en-route transitions', () => {
    const recs = SAMPLE.map((l) => arinc.parseRecord(l)!).filter(Boolean);
    const fixes = new Map<string, [number, number]>();
    const runways: string[] = [];
    for (const r of recs)
      if (r.kind === 'fix') {
        fixes.set(r.key as string, [r.lat as number, r.lon as number]);
        if ((r.key as string).startsWith('PG|')) runways.push(r.ident as string);
      }
    expect(arinc.expandRunway('RW31B', runways)).toEqual(['RW31L', 'RW31R']);
    expect(arinc.expandRunway('ALL', runways)).toEqual(['ALL']);
    const legs = recs.filter((r) => r.kind === 'leg' && r.airport === 'KJFK');
    const { sids, stars } = arinc.buildProcedures(legs, fixes, runways);
    expect(sids).toHaveLength(1);
    const sid = sids[0]!;
    expect(sid.name).toBe('DEEZZ6');
    expect(sid.rwys).toEqual(['RW04L', 'RW04R', 'RW31L', 'RW31R']);
    expect(sid.tracks).toHaveLength(1);
    expect(sid.tracks[0]!.map((f) => f[0])).toEqual(['DEEZZ', 'HEERO', 'KURNL', 'CANDR']);
    expect(sid.rwt?.RW04L?.map((f) => f[0])).toEqual(['PONAE']);
    expect(sid.rwt?.RW31R?.map((f) => f[0])).toEqual(['SKORR', 'CESID', 'YNKEE']);
    expect(sid.rwt?.RW31R?.[0]).toEqual(['SKORR', 40.5964, -73.8894, '+2500']);
    expect(sid.rwt?.RW04R).toBeUndefined(); // headings only
    expect(stars).toEqual([
      { name: 'CAMRN5', rwys: ['ALL'], tracks: [[['SIE', 39.0955, -74.8003], ['BOTON', 39.4145, -74.4547]]] },
    ]);
  });
});

describe('US procedures (generated FAA CIFP data)', () => {
  const apt = (id: string) => data.airports[id]!;
  const lastFix = (t: ProcTrack) => t.fixes[t.fixes.length - 1]!;
  const brg = (id: string, f: { lat: number; lon: number }) => bearingDeg(apt(id).lat, apt(id).lon, f.lat, f.lon);
  const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it('covers the busiest US airports with real procedures', () => {
    expect(data.v).toBe(1);
    expect(data.source).toMatch(/^FAA CIFP \d{4} \(public domain\)$/);
    for (const id of ['KJFK', 'KATL', 'KLAX', 'KORD', 'KDFW', 'KDEN', 'KSFO', 'KSEA', 'KLAS', 'KMCO', 'KEWR', 'KBOS'])
      expect(apt(id).sids.length + apt(id).stars.length, id).toBeGreaterThan(3);
    for (const a of Object.values(data.airports))
      for (const p of [...a.sids, ...a.stars])
        for (const t of p.tracks)
          for (const f of t) {
            expect(Math.abs(f[1]) <= 90 && Math.abs(f[2]) <= 180).toBe(true);
            expect(distanceNm(a.lat, a.lon, f[1], f[2])).toBeLessThan(600);
          }
  });

  it('normalizes runways and parses constraints', () => {
    expect(normalizeRunway('4l')).toBe('RW04L');
    expect(normalizeRunway('RW31R')).toBe('RW31R');
    expect(normalizeRunway('')).toBe('ALL');
    expect(parseConstraint('+2500')).toEqual({ altMin: 2500 });
    expect(parseConstraint('B13000/11000')).toEqual({ altMin: 11000, altMax: 13000 });
    expect(parseConstraint('@9000')).toEqual({ altMin: 9000, altMax: 9000 });
  });

  it('picks a KJFK SID toward the departure course', () => {
    const west = pickSid(data, 'KJFK', '31L', 280)!;
    expect(west).not.toBeNull();
    expect(west.rwys).toContain('RW31L');
    expect(off(brg('KJFK', lastFix(west)), 280)).toBeLessThanOrEqual(50);
    expect(west.fixes[0]!.ident).toBe('SKORR'); // runway 31L transition flown first
    // JFK's eastbound departures are vectored (no coded SID goes east): honest null.
    expect(pickSid(data, 'KJFK', '04L', 90)).toBeNull();
  });

  it('picks a KATL SID whose last fix is east for an eastbound departure', () => {
    const east = pickSid(data, 'KATL', '08R', 80)!;
    expect(east).not.toBeNull();
    const f = lastFix(east);
    expect(off(brg('KATL', f), 80)).toBeLessThanOrEqual(50);
    expect(f.lon).toBeGreaterThan(apt('KATL').lon);
    expect(distanceNm(apt('KATL').lat, apt('KATL').lon, f.lat, f.lon)).toBeGreaterThanOrEqual(15);
  });

  it('picks a KATL STAR entering from the north for a flight from the north', () => {
    const north = pickStar(data, 'KATL', '26R', 10)!;
    expect(north).not.toBeNull();
    const entry = north.fixes[0]!;
    expect(off(brg('KATL', entry), 10)).toBeLessThanOrEqual(45);
    expect(entry.lat).toBeGreaterThan(apt('KATL').lat);
    expect(north.transition).toBe(entry.ident);
  });

  it('picks a KJFK STAR from the right side and appends the runway transition', () => {
    const ne = pickStar(data, 'KJFK', '04R', 60)!;
    expect(ne.name).toMatch(/^PARCH/);
    expect(ne.fixes.at(-1)!.ident).toBe('JFK'); // RW04B transition ROBER → JFK
    const sw = pickStar(data, 'KJFK', 'ALL', 210)!;
    expect(sw.name).toMatch(/^CAMRN/);
    expect(pickStar(data, 'XXXX', '04L', 0)).toBeNull();
  });
});
