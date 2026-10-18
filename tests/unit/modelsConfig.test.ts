import { describe, expect, it } from 'vitest';
import { nightFactor, sunAltitudeDeg } from '@/map/models3d';
import { stepConfig, type AircraftConfig, type FlightState } from '@/map/modelsBridge';

/** Runs a sequence of flight states, `dt` seconds apart, and returns every configuration. */
function fly(states: FlightState[], dt = 1): AircraftConfig[] {
  const out: AircraftConfig[] = [];
  let c: AircraftConfig | undefined;
  let t = 0;
  for (const s of states) {
    c = stepConfig(c, s, c ? dt : 0, t);
    out.push(c);
    t += dt * 1000;
  }
  return out;
}

const rep = (n: number, s: FlightState) => Array.from({ length: n }, () => s);

describe('gear and flap configuration', () => {
  it('departure: take-off flaps on the roll, gear up above ~800 ft, clean above 3,000 ft', () => {
    const seq = fly([
      ...rep(3, { onGround: true, gs: 15, vr: 0, agl: 0 }), // taxi out
      ...rep(20, { onGround: true, gs: 140, vr: 0, agl: 0 }), // take-off roll
      ...rep(5, { onGround: false, gs: 160, vr: 2000, agl: 500 }),
      ...rep(10, { onGround: false, gs: 180, vr: 2000, agl: 1500 }),
      ...rep(15, { onGround: false, gs: 250, vr: 2000, agl: 5000 }),
    ]);
    expect(seq[0]!.gear).toBe(1);
    expect(seq[22]!.flaps).toBeCloseTo(0.35, 2);
    expect(seq[27]!.gearDown).toBe(true); // below 800 ft after take-off
    expect(seq[29]!.gearDown).toBe(false);
    expect(seq[29]!.gear).toBeGreaterThan(0.5); // still travelling (6 s)
    expect(seq[37]!.gear).toBe(0);
    expect(seq[37]!.flapTarget).toBeCloseTo(0.35, 2);
    expect(seq[seq.length - 1]!.flaps).toBe(0);
  });

  it('arrival: flaps ramp on the approach, gear down below 2,500 ft, flaps 1 on the roll, 0 taxiing in', () => {
    const states: FlightState[] = [];
    for (let agl = 5000; agl > 0; agl -= 100) states.push({ onGround: false, gs: 160, vr: -800, agl });
    const seq = fly([...states, ...rep(10, { onGround: true, gs: 120, vr: 0, agl: 0 }), ...rep(15, { onGround: true, gs: 15, vr: 0, agl: 0 })]);
    expect(seq[0]!.gear).toBe(0);
    expect(seq[0]!.flaps).toBe(0);
    const at = (agl: number) => seq[Math.round((5000 - agl) / 100)]!;
    expect(at(3000).flapTarget).toBeGreaterThan(0.25);
    expect(at(2400).gearDown).toBe(true);
    expect(at(2700).gearDown).toBe(false);
    expect(at(100).flaps).toBeGreaterThan(0.85);
    expect(at(100).gear).toBe(1);
    const roll = seq[states.length + 5]!;
    expect(roll.landed).toBe(true);
    expect(roll.flapTarget).toBe(1);
    expect(seq[seq.length - 1]!.flaps).toBe(0);
    expect(seq[seq.length - 1]!.gear).toBe(1);
  });

  it('keeps the gear down when levelling off on the approach and raises it on a go-around', () => {
    const seq = fly([
      ...rep(10, { onGround: false, gs: 160, vr: -700, agl: 2000 }),
      ...rep(10, { onGround: false, gs: 160, vr: 0, agl: 2000 }),
      ...rep(10, { onGround: false, gs: 170, vr: 1500, agl: 1200 }),
    ]);
    expect(seq[19]!.gearDown).toBe(true);
    expect(seq[29]!.gearDown).toBe(false);
    expect(seq[29]!.flapTarget).toBeCloseTo(0.35, 2);
  });

  it('starts in a sensible state when first seen (no animation from defaults)', () => {
    expect(stepConfig(undefined, { onGround: false, gs: 450, vr: 0, agl: 35000 }, 0, 0)).toMatchObject({ gear: 0, flaps: 0 });
    expect(stepConfig(undefined, { onGround: true, gs: 0, vr: 0, agl: 0 }, 0, 0)).toMatchObject({ gear: 1, flaps: 0 });
    expect(stepConfig(undefined, { onGround: false, gs: 140, vr: -700, agl: 600 }, 0, 0).gear).toBe(1);
  });
});

describe('sun position', () => {
  it('matches known solar altitudes', () => {
    // London, 2026-06-21 12:00 UTC: ~62° (solar noon ≈ 12:02 UTC)
    expect(sunAltitudeDeg(51.47, -0.46, Date.UTC(2026, 5, 21, 12, 2))).toBeCloseTo(62, 0);
    // London, 2026-12-21 12:00 UTC: ~15°
    expect(sunAltitudeDeg(51.47, -0.46, Date.UTC(2026, 11, 21, 12, 0))).toBeGreaterThan(14);
    expect(sunAltitudeDeg(51.47, -0.46, Date.UTC(2026, 11, 21, 12, 0))).toBeLessThan(16);
    // London at midnight: well below the horizon
    expect(sunAltitudeDeg(51.47, -0.46, Date.UTC(2026, 9, 18, 0, 0))).toBeLessThan(-30);
    // Equator at the March equinox noon: nearly overhead
    expect(sunAltitudeDeg(0, 0, Date.UTC(2026, 2, 20, 12, 7))).toBeGreaterThan(88);
  });

  it('turns lights on through civil dusk', () => {
    expect(nightFactor(20)).toBe(0);
    expect(nightFactor(2)).toBe(0);
    expect(nightFactor(-1)).toBeGreaterThan(0.2);
    expect(nightFactor(-4)).toBeGreaterThan(0.95);
    expect(nightFactor(-30)).toBe(1);
  });
});
