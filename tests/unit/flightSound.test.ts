import { describe, expect, it } from 'vitest';
import { soundKindFor, thrustForState } from '../../src/lib/flightSound';

const ground = (gs: number) => ({ onGround: true, gs, vr: 0, alt: 0 });
const air = (gs: number, vr: number, alt: number) => ({ onGround: false, gs, vr, alt });

describe('thrustForState', () => {
  it('idles when parked and runs low power while taxiing', () => {
    expect(thrustForState(ground(0))).toMatchObject({ phase: 'parked', reverse: 0 });
    const taxi = thrustForState(ground(15));
    expect(taxi.phase).toBe('taxi');
    expect(taxi.thrust).toBeLessThan(0.3);
  });

  it('applies full thrust on the take-off roll', () => {
    expect(thrustForState(ground(110), -3)).toMatchObject({ phase: 'takeoff', thrust: 1, reverse: 0 });
    expect(thrustForState(ground(110), null).phase).toBe('takeoff');
  });

  it('fires reverse thrust when decelerating hard after touchdown', () => {
    const r = thrustForState(ground(120), 4);
    expect(r.phase).toBe('reverse');
    expect(r.reverse).toBeGreaterThan(0.5);
    expect(r.reverse).toBeLessThanOrEqual(1);
    // Gentle braking at lower speed is an idle roll-out.
    expect(thrustForState(ground(50), 1)).toMatchObject({ phase: 'rollout', reverse: 0 });
  });

  it('orders airborne phases climb > cruise > descent', () => {
    const climb = thrustForState(air(280, 2500, 8000));
    const cruise = thrustForState(air(460, 0, 37000));
    const descent = thrustForState(air(400, -1800, 20000));
    expect(climb.phase).toBe('climb');
    expect(cruise.phase).toBe('cruise');
    expect(descent.phase).toBe('descent');
    expect(climb.thrust).toBeGreaterThan(cruise.thrust);
    expect(cruise.thrust).toBeGreaterThan(descent.thrust);
    expect(thrustForState(air(150, -700, 2500)).phase).toBe('approach');
  });

  it('keeps output in range for junk input', () => {
    const r = thrustForState({ onGround: false, gs: NaN, vr: Infinity, alt: -50 }, NaN);
    expect(r.thrust).toBeGreaterThanOrEqual(0);
    expect(r.thrust).toBeLessThanOrEqual(1);
  });
});

describe('soundKindFor', () => {
  it('maps aircraft classes to sound models', () => {
    for (const c of ['widebody', 'narrowbody', 'regional', 'bizjet', 'military'] as const) expect(soundKindFor(c)).toBe('jet');
    expect(soundKindFor('turboprop')).toBe('turboprop');
    expect(soundKindFor('helicopter')).toBe('heli');
    expect(soundKindFor('light')).toBe('piston');
    expect(soundKindFor('glider')).toBe('glider');
  });
});
