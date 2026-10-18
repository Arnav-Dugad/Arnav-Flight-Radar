import { describe, expect, it } from 'vitest';
import { angleSpringStep, chaseDistanceM, chaseSky, modelAltitudeM, springStep, wrap180, zoomForDistance, type Spring } from '@/map/chaseView';

const rgb = (c: unknown) => (String(c).match(/\d+/g) ?? []).map(Number);

describe('chase camera springs', () => {
  it('a critically damped spring settles on the target without overshoot', () => {
    const s: Spring = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 600; i++) {
      springStep(s, 10, 2, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeCloseTo(10, 3);
    expect(max).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('is frame-rate independent (30 fps and 144 fps land in the same place)', () => {
    const a: Spring = { x: 0, v: 0 };
    const b: Spring = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) springStep(a, 1, 3, 1 / 30);
    for (let i = 0; i < 144; i++) springStep(b, 1, 3, 1 / 144);
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it('ignores zero / negative frame times and snaps for an infinite frequency', () => {
    const s: Spring = { x: 2, v: 1 };
    springStep(s, 5, 2, 0);
    expect(s).toEqual({ x: 2, v: 1 });
    springStep(s, 5, Infinity, 0.016);
    expect(s).toEqual({ x: 5, v: 0 });
  });

  it('turns the short way round through north', () => {
    expect(wrap180(350 - 10)).toBe(-20);
    expect(wrap180(10 - 350)).toBe(20);
    const s: Spring = { x: 350, v: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) seen.push(angleSpringStep(s, 10, 2, 1 / 60).x);
    expect(s.x).toBeCloseTo(10, 2);
    // never swings the long way (through 180°)
    expect(seen.every((h) => h >= 349.9 || h <= 10.0001)).toBe(true);
  });
});

describe('chase framing', () => {
  it('bigger aircraft and narrower screens put the camera further back', () => {
    const a320 = chaseDistanceM(37.6, 35.8, 1280, 720, 36.87);
    const b747 = chaseDistanceM(76.3, 68.4, 1280, 720, 36.87);
    const phone = chaseDistanceM(37.6, 35.8, 375, 330, 36.87);
    expect(b747).toBeGreaterThan(a320 * 1.6);
    expect(phone).toBeGreaterThan(a320);
    expect(a320).toBeGreaterThan(40);
    expect(a320).toBeLessThan(200);
  });

  it('zoom puts the camera at the requested distance', () => {
    // At zoom z the camera is cameraToCenter px × metres-per-px away.
    const H = 800;
    const fov = 36.87;
    const z = zoomForDistance(120, 51.5, H, fov);
    const mpp = (40_075_016.686 * Math.cos((51.5 * Math.PI) / 180)) / (512 * 2 ** z);
    const ctc = (0.5 * H) / Math.tan(((fov / 2) * Math.PI) / 180);
    expect(ctc * mpp).toBeCloseTo(120, 6);
    expect(zoomForDistance(240, 51.5, H, fov)).toBeCloseTo(z - 1, 9);
  });

  it('places the camera at the same height the 3D model is drawn at', () => {
    // Without terrain models stand on a sea-level map: height above the field.
    expect(modelAltitudeM(35_000, 300, false, false)).toBeCloseTo((35_000 - 300) * 0.3048, 6);
    expect(modelAltitudeM(35_000, 300, false, true)).toBeCloseTo(35_000 * 0.3048, 6);
    expect(modelAltitudeM(undefined, 300, true, false)).toBe(0);
    expect(modelAltitudeM(undefined, 300, true, true)).toBeCloseTo(300 * 0.3048, 6);
  });
});

describe('chase sky', () => {
  it('is blue by day, warm at sunset and dark at night', () => {
    const day = chaseSky(45);
    const sunset = chaseSky(2);
    const night = chaseSky(-30);
    const [dr, , db] = rgb(day['sky-color']);
    expect(db!).toBeGreaterThan(dr! + 80);
    const [hr, , hb] = rgb(sunset['horizon-color']);
    expect(hr!).toBeGreaterThan(hb! + 60);
    expect(Math.max(...rgb(night['sky-color']))).toBeLessThan(30);
    expect(Math.max(...rgb(night['horizon-color']))).toBeLessThan(60);
  });

  it('changes smoothly with the sun', () => {
    for (let a = -20; a < 40; a += 0.5) {
      const p = rgb(chaseSky(a)['horizon-color']);
      const q = rgb(chaseSky(a + 0.5)['horizon-color']);
      for (let i = 0; i < 3; i++) expect(Math.abs(p[i]! - q[i]!)).toBeLessThan(25);
    }
  });
});
