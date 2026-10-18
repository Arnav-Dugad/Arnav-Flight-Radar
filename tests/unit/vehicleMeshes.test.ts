import { describe, expect, it } from 'vitest';
import { LIGHT_AMBER, LIGHT_SPRAY, LIGHT_STRIDE, LIGHT_WORK, MAT_LAMP, MAT_RUBBER, PART_LIFT, PART_SCISSOR, PART_SCISSOR_TOP, PART_SWING } from '@/map/modelMeshes';
import { DEICE_BOOM, SPRAY_PARTICLES, VEHICLE_SHAPES, buildVehicleMesh, getVehicleMesh, vehicleInfo } from '@/map/vehicleMeshes';

/** Rodrigues rotation of v about unit axis k by angle a. */
function arot(v: number[], k: number[], a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k[0]! * v[0]! + k[1]! * v[1]! + k[2]! * v[2]!;
  const cr = [k[1]! * v[2]! - k[2]! * v[1]!, k[2]! * v[0]! - k[0]! * v[2]!, k[0]! * v[1]! - k[1]! * v[0]!];
  return [0, 1, 2].map((i) => v[i]! * c + cr[i]! * s + k[i]! * d * (1 - c));
}

/** Vertex v of a vehicle mesh with its moving part at lift fraction g — exactly as the vertex shader does it. */
function animated(m: ReturnType<typeof buildVehicleMesh>, v: number, g: number): number[] {
  const p = [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const kind = m.part[v * 4]!;
  if (kind < 0.5) return p;
  const kf = Math.floor(kind + 0.001);
  const kp = kind - kf;
  const piv = [m.part[v * 4 + 1]!, m.part[v * 4 + 2]!, m.part[v * 4 + 3]!];
  let ax = [m.axis[v * 4]!, m.axis[v * 4 + 1]!, m.axis[v * 4 + 2]!];
  const w = m.axis[v * 4 + 3]!;
  let ang = 0;
  let sl = [0, 0, 0];
  const ss = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  if (kf === 4) sl = [0, kp * ss(0.32, 0.42, g), w * g];
  else if (kf === 5 || kf === 6) {
    const lb = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
    ax = ax.map((x) => x / lb);
    ang = Math.asin(Math.min(1, kp + (g * w) / lb)) - Math.asin(kp);
    if (kf === 6) sl = [0, 0, w * g];
  } else if (kf === 7) ang = g * w;
  const r = arot([p[0]! - piv[0]!, p[1]! - piv[1]!, p[2]! - piv[2]!], ax, ang);
  return [piv[0]! + r[0]! + sl[0]!, piv[1]! + r[1]! + sl[1]!, piv[2]! + r[2]! + sl[2]!];
}

describe('vehicle meshes', () => {
  it('builds every vehicle at every level of detail, unit length, standing on the ground', () => {
    expect(VEHICLE_SHAPES.length).toBeGreaterThanOrEqual(10);
    for (const shape of VEHICLE_SHAPES) {
      const tris: number[] = [];
      for (const lod of [0, 1, 2]) {
        const m = buildVehicleMesh(shape, lod);
        expect(m.vertexCount % 3).toBe(0);
        expect(m.positions.length).toBe(m.vertexCount * 3);
        expect(m.max[1] - m.min[1]).toBeCloseTo(1, 5);
        expect(m.min[1]).toBeCloseTo(-0.5, 5);
        // wheels touch z = 0, nothing below it
        expect(m.min[2]).toBeGreaterThan(-1e-4);
        expect(m.min[2]).toBeLessThan(1e-3);
        let bad = 0;
        for (let i = 0; i < m.positions.length; i++) if (!Number.isFinite(m.positions[i])) bad++;
        for (let v = 0; v < m.vertexCount; v++) {
          if (Math.abs(Math.hypot(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!) - 1) > 1e-4) bad++;
          if (m.colorIndex[v]! > MAT_LAMP) bad++;
        }
        expect(bad).toBe(0);
        expect(m.opaqueVertexCount).toBe(m.vertexCount);
        expect(m.colorIndex.includes(MAT_RUBBER)).toBe(true);
        tris.push(m.triangleCount);
      }
      expect(tris[2]!).toBeLessThan(tris[0]!);
      expect(tris[0]!).toBeLessThan(6000);
    }
  });

  it('has true-scale dimensions', () => {
    const near = (shape: (typeof VEHICLE_SHAPES)[number], len: [number, number], width: [number, number]) => {
      const i = vehicleInfo(shape);
      expect(i.lengthM).toBeGreaterThan(len[0]);
      expect(i.lengthM).toBeLessThan(len[1]);
      expect(i.widthM).toBeGreaterThan(width[0]);
      expect(i.widthM).toBeLessThan(width[1]);
      expect(getVehicleMesh(shape).recipeLengthM).toBeCloseTo(i.lengthM, 6);
    };
    near('veh-tug', [6.4, 7.2], [2.9, 3.2]);
    near('veh-catering', [8.8, 9.6], [2.4, 2.7]);
    near('veh-fuel', [10, 10.6], [2.4, 2.7]);
    near('veh-stairs', [7.2, 7.8], [2.2, 2.5]);
    near('veh-bus', [13.4, 14], [2.9, 3.2]);
    near('veh-baggage', [12, 16], [1.5, 1.9]);
    // the catering platform reaches beyond the cab once deployed
    expect(vehicleInfo('veh-catering').reach).toBeGreaterThan(4.5);
    expect(vehicleInfo('veh-tug').reach).toBeLessThan(-1);
  });

  it('carries rotating amber beacons on every vehicle', () => {
    for (const shape of VEHICLE_SHAPES) {
      const m = getVehicleMesh(shape);
      let amber = 0;
      for (let i = 0; i < m.lightCount; i++) {
        const t = m.lights[i * LIGHT_STRIDE + 3]!;
        expect(t).toBeGreaterThanOrEqual(LIGHT_AMBER);
        if (t === LIGHT_AMBER) amber++;
      }
      expect(amber).toBeGreaterThanOrEqual(1);
    }
  });

  it('lifts the catering box on scissors that stay attached to it', () => {
    const m = buildVehicleMesh('veh-catering', 0);
    const L = m.recipeLengthM;
    let lift = 0;
    let arms = 0;
    for (let v = 0; v < m.vertexCount; v++) {
      const k = Math.floor(m.part[v * 4]! + 0.001);
      if (k === PART_LIFT) lift++;
      if (k === PART_SCISSOR || k === PART_SCISSOR_TOP) arms++;
    }
    expect(lift).toBeGreaterThan(0);
    expect(arms).toBeGreaterThan(0);
    for (const g of [0, 0.42, 1]) {
      // top of the arms ≈ just under the box floor; arm feet stay on the chassis
      let boxFloor = Infinity;
      let armTop = -Infinity;
      let armBottom = Infinity;
      for (let v = 0; v < m.vertexCount; v++) {
        const k = Math.floor(m.part[v * 4]! + 0.001);
        const kp = m.part[v * 4]! - k;
        const z = animated(m, v, g)[2]! * L;
        if (k === PART_LIFT && kp < 0.01 && m.colorIndex[v] === 0) boxFloor = Math.min(boxFloor, z);
        if (k === PART_SCISSOR || k === PART_SCISSOR_TOP) {
          armTop = Math.max(armTop, z);
          armBottom = Math.min(armBottom, z);
        }
      }
      expect(boxFloor).toBeCloseTo(1.72 + 4 * g, 2);
      expect(armTop).toBeGreaterThan(boxFloor - 0.25);
      expect(armTop).toBeLessThan(boxFloor + 0.05);
      expect(armBottom).toBeGreaterThan(1.0);
      expect(armBottom).toBeLessThan(1.3);
    }
  });

  it('raises the de-icing boom to its working pose with the basket level, spray at the nozzle', () => {
    const m = buildVehicleMesh('veh-deice', 0);
    const L = m.recipeLengthM;
    const c = vehicleInfo('veh-deice').centreY;
    let swing = 0;
    let maxZ0 = 0;
    let maxZ1 = 0;
    let topX = 0;
    for (let v = 0; v < m.vertexCount; v++) {
      if (Math.floor(m.part[v * 4]! + 0.001) !== PART_SWING) continue;
      swing++;
      maxZ0 = Math.max(maxZ0, m.positions[v * 3 + 2]! * L);
      const p = animated(m, v, 1);
      if (p[2]! * L > maxZ1) {
        maxZ1 = p[2]! * L;
        topX = p[0]! * L;
      }
    }
    expect(swing).toBeGreaterThan(0);
    // stowed below ~6 m, raised: basket roof at ~11.5 m, out over the right side
    expect(maxZ1).toBeCloseTo(DEICE_BOOM.basket[2] + 1.45, 1);
    expect(maxZ0).toBeLessThan(maxZ1 - 3);
    expect(topX).toBeGreaterThan(4.5);
    let spray = 0;
    let work = 0;
    for (let i = 0; i < m.lightCount; i++) {
      const o = i * LIGHT_STRIDE;
      if (m.lights[o + 3] === LIGHT_SPRAY) {
        spray++;
        expect(m.lights[o]! * L).toBeCloseTo(DEICE_BOOM.nozzle[0], 3);
        expect(m.lights[o + 1]! * L + c).toBeCloseTo(DEICE_BOOM.nozzle[1], 3);
        expect(m.lights[o + 6]!).toBeGreaterThan(0);
        expect(m.lights[o + 6]!).toBeLessThan(1);
      }
      if (m.lights[o + 3] === LIGHT_WORK) work++;
    }
    expect(spray).toBe(SPRAY_PARTICLES);
    expect(work).toBe(1);
  });
});
