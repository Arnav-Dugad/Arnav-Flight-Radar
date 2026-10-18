import { describe, expect, it } from 'vitest';
import { contrailAlpha, contrailHalfWidthM, contrailLifeS, contrailLight, engineOffsets, formsContrail, isaOatC, persistence } from '@/map/contrails';

const jet = { onGround: false, jet: true };

describe('contrail formation', () => {
  it('needs a jet, high and in cold air', () => {
    expect(formsContrail({ ...jet, altFt: 35_000, oatC: -54 })).toBe(true);
    expect(formsContrail({ ...jet, altFt: 24_000, oatC: -45 })).toBe(false); // too low
    expect(formsContrail({ ...jet, altFt: 33_000, oatC: -35 })).toBe(false); // too warm
    expect(formsContrail({ onGround: false, jet: false, altFt: 27_000, oatC: -45 })).toBe(false); // turboprop
    expect(formsContrail({ onGround: true, jet: true, altFt: 0, oatC: 15 })).toBe(false);
    expect(formsContrail({ ...jet, altFt: undefined, oatC: -60 })).toBe(false);
  });

  it('falls back to ISA temperatures when the simulator gives none', () => {
    expect(isaOatC(0)).toBeCloseTo(15, 6);
    expect(isaOatC(40_000)).toBe(-56.5);
    expect(formsContrail({ ...jet, altFt: 37_000, oatC: undefined })).toBe(true);
    expect(formsContrail({ ...jet, altFt: 26_000, oatC: undefined })).toBe(false); // ISA −36.5 °C
  });

  it('keeps a forming trail going a little lower and warmer (no flicker at the threshold)', () => {
    const edge = { ...jet, altFt: 25_600, oatC: -39 };
    expect(formsContrail(edge, false)).toBe(false);
    expect(formsContrail(edge, true)).toBe(true);
  });
});

describe('contrail appearance', () => {
  it('forms behind the engines, then fades out by the end of its life', () => {
    expect(contrailAlpha(0, 90)).toBe(0);
    expect(contrailAlpha(5, 90)).toBeGreaterThan(0.8);
    expect(contrailAlpha(60, 90)).toBeLessThan(contrailAlpha(20, 90));
    expect(contrailAlpha(90, 90)).toBe(0);
    expect(contrailAlpha(-1, 90)).toBe(0);
  });

  it('lives 20 s in dry air and up to 2 minutes in moist air', () => {
    expect(contrailLifeS(0)).toBe(20);
    expect(contrailLifeS(1)).toBe(120);
    expect(contrailLifeS(0.5)).toBeGreaterThan(20);
    expect(contrailLifeS(0.5)).toBeLessThan(120);
  });

  it('humidity field is in [0, 1], deterministic and smooth', () => {
    const t = Date.UTC(2026, 9, 18, 12);
    let prev = persistence(50, -30, t);
    for (let lon = -30; lon < 30; lon += 0.05) {
      const v = persistence(50, lon, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    expect(persistence(40, 10, t)).toBe(persistence(40, 10, t));
  });

  it('spreads with age', () => {
    expect(contrailHalfWidthM(60, 36)).toBeGreaterThan(contrailHalfWidthM(0, 36) + 20);
  });

  it('one trail per engine: twins two, quads four, symmetric about the centreline', () => {
    expect(engineOffsets(2, 'wing', 36)).toHaveLength(2);
    const quad = engineOffsets(4, 'wing', 64);
    expect(quad).toHaveLength(4);
    expect(quad[0]! + quad[3]!).toBeCloseTo(0, 9);
    expect(Math.abs(quad[0]!)).toBeGreaterThan(Math.abs(quad[1]!));
    // rear-mounted twins sit close together
    expect(Math.abs(engineOffsets(2, 'rear', 21)[0]!)).toBeLessThan(Math.abs(engineOffsets(2, 'wing', 21)[0]!));
    expect(engineOffsets(1, 'fuselage', 10)).toEqual([0]);
  });

  it('is white by day and faint at night', () => {
    expect(contrailLight(40).color.every((c) => c > 0.9)).toBe(true);
    expect(contrailLight(-30).alpha).toBeLessThan(contrailLight(40).alpha / 2);
  });
});
