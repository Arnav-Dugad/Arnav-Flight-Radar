import { describe, expect, it } from 'vitest';
import { AIRLINE_EXTRA, telephonyOf } from '../../src/data/sim/airlineInfo';
import { ALL_AIRLINES } from '../../src/data/sim/airlines';
import { SCHENGEN, TERMINAL_RULES, terminalFor } from '../../src/data/sim/terminals';

const HEX = /^#[0-9a-f]{6}$/i;
const MODELS = new Set(['full', 'low', 'regional', 'leisure', 'cargo', 'bizjet', 'charter']);

describe('airline extra info', () => {
  it('has an entry with valid colours for every airline', () => {
    for (const a of ALL_AIRLINES) {
      const x = AIRLINE_EXTRA[a.icao];
      expect(x, a.icao).toBeDefined();
      expect(x!.body, a.icao).toMatch(HEX);
      expect(x!.tail, a.icao).toMatch(HEX);
      expect(MODELS.has(x!.model), a.icao).toBe(true);
      expect(x!.tel, a.icao).toBe(x!.tel.toUpperCase());
      expect(x!.tel.length, a.icao).toBeGreaterThan(1);
    }
  });

  it('lists every airline once, with sane profiles', () => {
    const codes = ALL_AIRLINES.map((a) => a.icao);
    expect(codes.filter((c, i) => codes.indexOf(c) !== i)).toEqual([]);
    expect(codes.length).toBeGreaterThanOrEqual(400);
    for (const a of ALL_AIRLINES) {
      expect(a.icao, a.name).toMatch(/^[A-Z]{3}$/);
      expect(a.dom, a.icao).toBeGreaterThanOrEqual(0);
      expect(a.dom, a.icao).toBeLessThanOrEqual(1);
      expect(a.size, a.icao).toBeGreaterThan(0);
      expect(a.fleet.every(([, w]) => w > 0), a.icao).toBe(true);
    }
    // Indian carriers fly a large share of international flights.
    const dom = (icao: string) => ALL_AIRLINES.find((a) => a.icao === icao)!.dom;
    expect(dom('AIC')).toBeLessThanOrEqual(0.55);
    expect(dom('AXB')).toBeLessThanOrEqual(0.55);
    expect(dom('IGO')).toBeLessThan(0.85);
  });

  it('has no entries for unknown airlines', () => {
    const known = new Set(ALL_AIRLINES.map((a) => a.icao));
    expect(Object.keys(AIRLINE_EXTRA).filter((k) => !known.has(k))).toEqual([]);
  });

  it('marks all-cargo operators as cargo', () => {
    for (const c of ['FDX', 'UPS', 'GTI', 'CLX', 'BCS', 'CKS']) expect(AIRLINE_EXTRA[c]!.model).toBe('cargo');
  });

  it('resolves telephony designators with a fallback', () => {
    expect(telephonyOf('BAW', 'British Airways')).toBe('SPEEDBIRD');
    expect(telephonyOf('EIN', 'Aer Lingus')).toBe('SHAMROCK');
    expect(telephonyOf('AFR', 'Air France')).toBe('AIRFRANS');
    expect(telephonyOf('ZZZ', 'Zéphyr Airways')).toBe('ZEPHYR');
    expect(telephonyOf('ZZZ', '')).toBe('ZZZ');
  });
});

describe('terminal allocation', () => {
  it('only references known airlines, alliances and keywords', () => {
    const known = new Set(ALL_AIRLINES.map((a) => a.icao));
    const keywords = new Set(['oneworld', 'Star Alliance', 'SkyTeam', 'domestic', 'international', 'schengen', 'non-schengen', 'low-cost', 'cargo', '*']);
    const quals = new Set(['domestic', 'international', 'schengen', 'non-schengen']);
    const bad: string[] = [];
    for (const [apt, rules] of Object.entries(TERMINAL_RULES)) {
      for (const rule of rules) {
        for (const u of rule.users) {
          if (keywords.has(u)) continue;
          const [code, q] = u.split('@');
          if (!known.has(code!) || (q !== undefined && !quals.has(q))) bad.push(`${apt}:${u}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(Object.keys(TERMINAL_RULES).length).toBeGreaterThanOrEqual(70);
  });

  it('puts carriers at their Heathrow terminals', () => {
    const lhr = ['Terminal 3', 'Terminal 5', 'Terminal 2', 'Terminal 4'];
    expect(terminalFor('EGLL', lhr, { icao: 'BAW', alliance: 'oneworld', domestic: false })).toBe(1);
    expect(terminalFor('EGLL', lhr, { icao: 'AAL', alliance: 'oneworld', domestic: false })).toBe(0);
    expect(terminalFor('EGLL', lhr, { icao: 'JAL', alliance: 'oneworld', domestic: false })).toBe(0);
    expect(terminalFor('EGLL', lhr, { icao: 'DLH', alliance: 'Star Alliance', domestic: false })).toBe(2);
    expect(terminalFor('EGLL', lhr, { icao: 'KAL', alliance: 'SkyTeam', domestic: false })).toBe(3);
    expect(terminalFor('EGLL', lhr, { icao: 'QTR', alliance: 'oneworld', domestic: false })).toBe(3);
    expect(terminalFor('EGLL', lhr, { icao: 'XXX', domestic: false })).toBe(3);
  });

  it('prefers specific prefixes and satellites', () => {
    const cdg = ['Terminal 1', 'Terminal 2A', 'Terminal 2E', 'Terminal 2F', 'Terminal 2G', 'Terminal 3'];
    expect(terminalFor('LFPG', cdg, { icao: 'AFR', alliance: 'SkyTeam', domestic: false, schengen: false })).toBe(2);
    expect(terminalFor('LFPG', cdg, { icao: 'AFR', alliance: 'SkyTeam', domestic: false, schengen: true })).toBe(3);
    expect(terminalFor('LFPG', cdg, { icao: 'HOP', domestic: true, schengen: true })).toBe(4);
    expect(terminalFor('LFPG', cdg, { icao: 'DLH', alliance: 'Star Alliance', domestic: false, schengen: true })).toBe(0);
    // 'Terminal 5' matches the satellite when no main building is mapped.
    expect(terminalFor('EGLL', ['Terminal 2', 'Terminal 5B'], { icao: 'BAW', domestic: false })).toBe(1);
    // 'Terminal 1' never matches 'Terminal 12'.
    expect(terminalFor('EDDM', ['Terminal 12'], { icao: 'XXX', domestic: false })).toBe(-1);
  });

  it('handles domestic, schengen and normalised names', () => {
    const syd = ['Terminal 1', 'Terminal 2', 'Terminal 3'];
    expect(terminalFor('YSSY', syd, { icao: 'QFA', alliance: 'oneworld', domestic: true })).toBe(2);
    expect(terminalFor('YSSY', syd, { icao: 'QFA', alliance: 'oneworld', domestic: false })).toBe(0);
    expect(terminalFor('YSSY', syd, { icao: 'VOZ', domestic: true })).toBe(1);
    expect(terminalFor('LKPR', ['Terminal 1', 'Terminal 2'], { icao: 'TVS', domestic: false, schengen: true })).toBe(1);
    expect(terminalFor('LKPR', ['Terminal 1', 'Terminal 2'], { icao: 'TVS', domestic: false, schengen: false })).toBe(0);
    expect(terminalFor('OMDB', ['مبنى 1', 'المبنى ٢', 'مبنى 3'], { icao: 'UAE', domestic: false })).toBe(2);
    expect(terminalFor('OMDB', ['T1', 'T2', 'T3'], { icao: 'FDB', domestic: false, lowCost: true })).toBe(1);
    expect(terminalFor('KLAX', ['Terminal 7', 'Tom Bradley International Termin'], { icao: 'QFA', alliance: 'oneworld', domestic: false })).toBe(1);
    expect(terminalFor('KLAX', ['Terminal 7', 'Tom Bradley International Termin'], { icao: 'UAL', domestic: true })).toBe(0);
    expect(terminalFor('ZZZZ', ['Terminal 1'], { icao: 'BAW', domestic: false })).toBe(-1);
  });

  it('lists the current Schengen members', () => {
    expect(SCHENGEN.size).toBe(29);
    for (const c of ['HR', 'BG', 'RO', 'CH', 'NO', 'IS', 'LI']) expect(SCHENGEN.has(c)).toBe(true);
    for (const c of ['GB', 'IE', 'CY']) expect(SCHENGEN.has(c)).toBe(false);
  });
});
