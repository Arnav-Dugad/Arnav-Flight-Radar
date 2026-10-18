// Reference data for the simulation only — no live data.
import { describe, expect, it } from 'vitest';
import { cabinFor, seatsPerRow } from '../../src/data/sim/cabin';
import type { AirlineModel } from '../../src/data/sim/refTypes';
import { TYPE_SPECS, searchTypes, specOf } from '../../src/data/sim/typeSpecs';

const CODES = (
  'A319 A320 A20N A321 A21N BCS3 B737 B738 B739 B38M B39M B752 B763 B772 B77W B77L B788 B789 B78X B744 B748 ' +
  'A332 A333 A339 A359 A35K A388 E75L E190 E195 E295 CRJ7 CRJ9 SU95 AT76 DH8D C68A CL35 GLF6 PC12 A318 BCS1 ' +
  'B37M B712 B753 B762 B764 A306 A343 MD11 E170 E145 CRJ2 AT45 SF34 C208 B190 GLEX E55P PC24 F2TH C172 PA28 ' +
  'SR22 EC35 EC45 AS50 C17 K35R C30J A400 E3TF P8 EUFI F16 F35 RFAL HAWK H60 A109 A169 B350 LJ45 S92 EC75 ' +
  'A139 EC30 S76 AS21 DUOD DISC LS8 GLID DR40 PA25 DA40 C152 C182'
).split(' ');

const MODELS: AirlineModel[] = ['full', 'low', 'regional', 'leisure', 'charter', 'bizjet'];

describe('type specs', () => {
  it('has a spec for every designator', () => {
    for (const c of CODES) expect(specOf(c), c).toBeDefined();
    expect(Object.keys(TYPE_SPECS).length).toBe(new Set(CODES).size);
  });

  it('has plausible, self-consistent figures', () => {
    for (const s of Object.values(TYPE_SPECS)) {
      expect(s.mlwKg, s.code).toBeLessThanOrEqual(s.mtowKg);
      expect(s.oewKg, s.code).toBeLessThan(s.mtowKg);
      expect(s.seatsTypical, s.code).toBeLessThanOrEqual(s.seatsMax);
      if (s.role === 'glider') expect([s.burnKgH, s.engines.kind], s.code).toEqual([0, 'none']);
      if (s.role === 'helicopter') expect([s.wing, s.vrKt], s.code).toEqual(['rotor', 0]);
      expect(s.blurb.length, s.code).toBeGreaterThan(20);
    }
  });

  it('assigns wake categories from MTOW (A380 = J)', () => {
    for (const s of Object.values(TYPE_SPECS)) {
      const want = s.code === 'A388' ? 'J' : s.mtowKg >= 136_000 ? 'H' : s.mtowKg >= 7_000 ? 'M' : 'L';
      expect(s.wake, s.code).toBe(want);
    }
    expect(specOf('A388')?.recat).toBe('A');
  });

  it('searches by code, maker and model', () => {
    expect(searchTypes('b738')[0]?.code).toBe('B738');
    expect(searchTypes('a350').map((s) => s.code)).toEqual(expect.arrayContaining(['A359', 'A35K']));
    expect(searchTypes('gulfstream')[0]?.code).toBe('GLF6');
    expect(searchTypes('boeing 787').map((s) => s.code).sort()).toEqual(['B788', 'B789', 'B78X']);
    expect(searchTypes('')).toEqual([]);
  });
});

describe('cabin layouts', () => {
  const airliners = Object.values(TYPE_SPECS).filter((s) => s.role === 'airliner');

  it('gives every airliner a realistic layout for every business model', () => {
    for (const s of airliners) {
      for (const m of MODELS) {
        const c = cabinFor(s.code, m);
        expect(c, `${s.code}/${m}`).not.toBeNull();
        if (!c) continue;
        expect(c.seats, `${s.code}/${m}`).toBeGreaterThanOrEqual(Math.floor(0.6 * s.seatsMax));
        expect(c.seats, `${s.code}/${m}`).toBeLessThanOrEqual(s.seatsMax);
      }
    }
  });

  it('keeps seat totals equal to the sum of sections, with continuous row numbers', () => {
    for (const s of Object.values(TYPE_SPECS)) {
      for (const m of MODELS) {
        for (const opts of [undefined, { first: true }, { premEco: true }, { first: true, premEco: false }]) {
          const c = cabinFor(s.code, m, opts);
          if (!c) continue;
          const by = { F: 0, J: 0, W: 0, Y: 0 };
          let row = 1;
          for (const d of c.decks)
            for (const sec of d.sections) {
              expect(sec.rows, s.code).toBeGreaterThan(0);
              expect(sec.firstRow, s.code).toBe(row);
              row += sec.rows;
              by[sec.cls] += sec.rows * seatsPerRow(sec.abreast);
            }
          expect(c.byClass, s.code).toEqual(by);
          expect(c.seats, s.code).toBe(by.F + by.J + by.W + by.Y);
          if (s.seatsMax > 0) expect(c.seats, s.code).toBeLessThanOrEqual(s.seatsMax);
        }
      }
    }
  });

  it('matches typical low-cost densities and wide-body layouts', () => {
    expect(cabinFor('A320', 'low')?.seats).toBeGreaterThanOrEqual(180);
    expect(cabinFor('B738', 'low')?.seats).toBeGreaterThanOrEqual(186);
    const a21n = cabinFor('A21N', 'low')?.seats ?? 0;
    expect(a21n).toBeGreaterThanOrEqual(220);
    expect(a21n).toBeLessThanOrEqual(240);
    const a388 = cabinFor('A388', 'full', { first: true });
    expect(a388?.decks.map((d) => d.deck)).toEqual(['main', 'upper']);
    expect(a388?.byClass.F).toBeGreaterThan(0);
    const b789 = cabinFor('B789', 'full');
    expect(b789?.decks[0]?.sections.map((s) => `${s.cls}:${s.abreast}`)).toEqual(['J:1-2-1', 'W:2-3-2', 'Y:3-3-3']);
    expect(cabinFor('B789', 'full', { premEco: false })?.byClass.W).toBe(0);
  });

  it('returns null for freighters, military types, gliders, cargo operators and unknown codes', () => {
    for (const c of ['A306', 'MD11', 'EUFI', 'F16', 'F35', 'RFAL', 'HAWK', 'C17', 'K35R', 'E3TF', 'P8', 'A400', 'C30J', 'AS21', 'DUOD', 'DISC', 'LS8', 'GLID']) {
      expect(cabinFor(c, 'full'), c).toBeNull();
    }
    expect(cabinFor('B77W', 'cargo')).toBeNull();
    expect(cabinFor('ZZZZ', 'full')).toBeNull();
  });
});
