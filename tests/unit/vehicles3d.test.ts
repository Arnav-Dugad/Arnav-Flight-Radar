import { describe, expect, it } from 'vitest';
import { airframeGeometry, offsetLatLon, servicePlan, type Placement } from '@/map/vehicles3d';
import { vehicleInfo } from '@/map/vehicleMeshes';

const A320 = { id: '~a320', lengthM: 37.57, spanM: 35.8 };
const B777 = { id: '~b777', lengthM: 63.7, spanM: 60.9 };
type Kind = 'catering' | 'fuel' | 'stairs' | 'baggage' | 'tug' | 'deice';
const plan = (ac: typeof A320, kinds: Kind[], o: { contact?: boolean; deiceSides?: number[]; t?: number } = {}) =>
  servicePlan(ac, new Set(kinds), { contact: o.contact ?? false, deiceSides: o.deiceSides ?? [], t: o.t ?? 0 });
const byKey = (ps: Placement[], k: string) => ps.find((p) => p.key.endsWith(`|${k}`));

describe('service vehicle placement', () => {
  it('derives airframe geometry from length and span', () => {
    const g = airframeGeometry(A320.lengthM, A320.spanM);
    expect(g.W).toBeCloseTo(3.95, 1);
    expect(g.sill).toBeGreaterThan(3);
    expect(g.sill).toBeLessThan(3.8);
    expect(g.wide).toBe(false);
    expect(g.yL1).toBeGreaterThan(10);
    expect(g.yL1).toBeLessThan(g.L / 2);
    expect(g.yAftDoor).toBeLessThan(-10);
    expect(g.yLE(10)).toBeLessThan(g.yLE(2));
    expect(airframeGeometry(B777.lengthM, B777.spanM).wide).toBe(true);
  });

  it('puts the stairs at L1 facing the fuselage, the caterer and loaders on the right', () => {
    const ps = plan(A320, ['stairs', 'catering', 'fuel', 'baggage']);
    const g = airframeGeometry(A320.lengthM, A320.spanM);
    const stairs = byKey(ps, 'stairs')!;
    expect(stairs.shape).toBe('veh-stairs');
    expect(stairs.x).toBeLessThan(-g.W / 2);
    expect(stairs.rel).toBe(90);
    expect(stairs.y).toBeCloseTo(g.yL1, 6);
    // its platform tip just touches the fuselage side
    expect(stairs.x + vehicleInfo('veh-stairs').reach).toBeGreaterThan(-g.W / 2 - 0.3);
    expect(stairs.x + vehicleInfo('veh-stairs').reach).toBeLessThan(-g.W / 2 + 0.2);
    const cat = byKey(ps, 'catering')!;
    expect(cat.x).toBeGreaterThan(g.W / 2);
    expect(cat.rel).toBe(-90);
    expect(cat.lift).toBeGreaterThanOrEqual(0.42);
    expect(cat.liftS).toBeGreaterThan(0);
    const fuel = byKey(ps, 'fuel')!;
    expect(fuel.x).toBeGreaterThan(g.W / 2 + 4);
    expect(fuel.rel).toBe(0);
    // entirely ahead of the wing's leading edge
    expect(fuel.y - vehicleInfo(fuel.shape).lengthM / 2).toBeGreaterThan(g.yLE(fuel.x - vehicleInfo(fuel.shape).widthM / 2));
    expect(byKey(ps, 'loader')!.shape).toBe('veh-belt');
    expect(byKey(ps, 'train')!.shape).toBe('veh-baggage');
    // no bus while catering / fuelling is under way
    expect(byKey(ps, 'bus')).toBeUndefined();
  });

  it('uses jet bridges at contact stands, a bus at remote ones, wide-body kit for wide-bodies', () => {
    expect(byKey(plan(A320, ['stairs', 'baggage'], { contact: true }), 'stairs')).toBeUndefined();
    expect(byKey(plan(A320, ['stairs', 'baggage']), 'bus')?.shape).toBe('veh-bus');
    const wide = plan(B777, ['stairs', 'baggage', 'tug']);
    expect(byKey(wide, 'stairs')!.shape).toBe('veh-stairs-hi');
    expect(byKey(wide, 'loader')!.shape).toBe('veh-cloader');
    expect(byKey(wide, 'train')!.shape).toBe('veh-uld');
    const tug = byKey(wide, 'tug')!;
    expect(tug.scale).toBeGreaterThan(1.1);
    expect(tug.x).toBe(0);
    // the cradle sits at the nose gear
    const g = airframeGeometry(B777.lengthM, B777.spanM);
    expect(tug.y + vehicleInfo('veh-tug').reach * tug.scale).toBeCloseTo(g.yNoseGear, 6);
  });

  it('sends two de-icers round either side, the aircraft always to their right', () => {
    for (const t of [0, 100, 200, 333]) {
      const ps = plan(A320, ['deice'], { deiceSides: [-1, 1], t });
      const l = byKey(ps, 'deice-1')!;
      const r = byKey(ps, 'deice1')!;
      expect(l.x).toBeLessThan(0);
      expect(r.x).toBeGreaterThan(0);
      expect(l.rel).toBe(0);
      expect(r.rel).toBe(180);
      expect(l.lift).toBeGreaterThan(0.98);
      // clear of the fuselage and engines
      expect(Math.abs(l.x)).toBeGreaterThan(6);
    }
  });

  it('offsets positions in the aircraft frame', () => {
    const [lat, lon] = offsetLatLon(51, 0, 90, 0, 100); // 100 m ahead heading east
    expect(lat).toBeCloseTo(51, 6);
    expect((lon * 111_320 * Math.cos((51 * Math.PI) / 180)) / 1).toBeCloseTo(100, 1);
    const [lat2] = offsetLatLon(51, 0, 90, 50, 0); // 50 m to the right of east = south
    expect((lat2 - 51) * 111_320).toBeCloseTo(-50, 1);
  });
});
