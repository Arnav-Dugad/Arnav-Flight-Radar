// Weight and balance (trim sheet) and fuel tankering on the simulated load sheet.
import { describe, expect, it } from 'vitest';
import { cgLimitsAt, loadSheet, planTanker, withTanker } from '@/data/sim/loadsheet';
import { specOf } from '@/data/sim/typeSpecs';

const base = (code: string, extra: Partial<Parameters<typeof loadSheet>[0]> = {}) =>
  loadSheet({ spec: specOf(code)!, model: 'full', lf: 0.85, seed: 11, airborneH: 2, taxiMin: 14, ...extra });

describe('trim sheet', () => {
  it('balances an A320 inside its CG envelope with an Airbus THS setting', () => {
    const s = base('A320', { model: 'low', lf: 0.93 });
    const t = s.trim!;
    expect(t).toBeDefined();
    expect(t.zones.map((z) => z.id)).toEqual(['0A', '0B', '0C']);
    expect(t.zones.reduce((a, z) => a + (z.pax ?? 0), 0)).toBe(s.pax);
    expect(t.holds.map((h) => h.id)).toEqual(['fwd', 'aft', 'bulk']);
    expect(Math.round(t.holds.reduce((a, h) => a + h.kg, 0))).toBeCloseTo(s.bagsKg + s.cargoKg, -1);
    expect(t.zfw.kg).toBe(s.zfwKg);
    expect(t.tow.kg).toBe(s.towKg);
    expect(t.lw.kg).toBe(s.lwKg);
    expect(t.inLimits).toBe(true);
    for (const p of [t.zfw, t.tow, t.lw]) {
      const [f, a] = cgLimitsAt(t.envelope, p.kg);
      expect(p.mac).toBeGreaterThanOrEqual(f);
      expect(p.mac).toBeLessThanOrEqual(a);
    }
    expect(t.stab).toMatch(/^\d\.\d (UP|DN)$|^0\.0$/);
    expect(t.mzfwKg).toBeGreaterThanOrEqual(s.zfwKg);
    // Index arithmetic adds up: DOI + zones + holds = ZFW index.
    const sum = t.doi + t.zones.reduce((a, z) => a + z.index, 0) + t.holds.reduce((a, h) => a + h.index, 0);
    expect(Math.abs(sum - t.zfw.index)).toBeLessThan(0.5);
  });

  it('uses Boeing stab units, upper-deck zones and freighter main deck', () => {
    expect(base('B738').trim!.stab).toMatch(/units$/);
    const w = base('A388', { airborneH: 12 });
    expect(w.trim!.zones.some((z) => z.upper)).toBe(true);
    expect(w.trim!.crew[0]).toBe(3);
    const f = base('B77L', { model: 'cargo' });
    if (f.trim) expect(f.trim.holds[0]!.id).toBe('main');
  });

  it('stays deterministic and inside limits across many types and loads', () => {
    for (const code of ['A20N', 'A21N', 'A333', 'A359', 'B77W', 'B789', 'B744', 'E190', 'CRJ9', 'AT76', 'DH8D', 'A388']) {
      const spec = specOf(code);
      if (!spec) continue;
      for (const lf of [0.4, 0.8, 1]) {
        const a = loadSheet({ spec, model: 'full', lf, seed: 7, airborneH: 3, taxiMin: 12 });
        const b = loadSheet({ spec, model: 'full', lf, seed: 7, airborneH: 3, taxiMin: 12 });
        expect(a.trim).toEqual(b.trim);
        expect(a.trim?.inLimits, `${code} @ ${lf}: ZFW ${a.trim?.zfw.mac} TOW ${a.trim?.tow.mac} LW ${a.trim?.lw.mac}`).toBe(true);
      }
    }
  });

  it('has no trim sheet for helicopters and light pistons', () => {
    for (const code of ['C172', 'EC35']) {
      const spec = specOf(code);
      if (spec) expect(loadSheet({ spec, model: 'charter', lf: 0.5, seed: 1, airborneH: 1, taxiMin: 5 }).trim).toBeUndefined();
    }
  });
});

describe('fuel tankering', () => {
  it('tankers on a short sector from cheap to expensive fuel and saves money', () => {
    const s = base('A320', { model: 'low', lf: 0.8, airborneH: 1.4 });
    const t = withTanker(s, { origin: 0.85, dest: 1.25 });
    expect(t.tanker!.on).toBe(true);
    expect(t.tanker!.extraKg).toBeGreaterThanOrEqual(500);
    expect(t.tanker!.savingUsd).toBeGreaterThan(50);
    // Burn penalty 2.5–4 % per flight hour.
    expect(t.tanker!.burnKg / t.tanker!.extraKg / 1.4).toBeGreaterThanOrEqual(0.025);
    expect(t.tanker!.burnKg / t.tanker!.extraKg / 1.4).toBeLessThanOrEqual(0.04);
    expect(t.blockFuelKg).toBe(s.blockFuelKg + t.tanker!.extraKg);
    expect(t.tripFuelKg).toBe(s.tripFuelKg + t.tanker!.burnKg);
    expect(t.lwKg).toBeLessThanOrEqual(t.mlwKg);
    expect(t.towKg).toBeLessThanOrEqual(t.mtowKg);
    expect(t.blockFuelKg).toBeLessThanOrEqual(t.maxFuelKg);
    expect(t.trim!.fuelKg).toBe(s.trim!.fuelKg + t.tanker!.extraKg);
  });

  it('does not tanker when the burn penalty exceeds the saving or fuel is dearer at origin', () => {
    const s = base('A320', { airborneH: 3 });
    const small = planTanker(s, { origin: 1, dest: 1.05 });
    expect(small.on).toBe(false);
    expect(small.reason).toMatch(/burn penalty/i);
    expect(planTanker(s, { origin: 1.2, dest: 1 }).on).toBe(false);
    expect(planTanker(base('B77W', { airborneH: 9 }), { origin: 0.7, dest: 1.4 }).on).toBe(false);
  });

  it('is applied by loadSheet when fuel prices are given', () => {
    const s = base('A320', { airborneH: 1.2, lf: 0.7, fuelPrice: { origin: 0.8, dest: 1.3 } });
    expect(s.tanker?.on).toBe(true);
    expect(base('A320').tanker).toBeUndefined();
  });
});
