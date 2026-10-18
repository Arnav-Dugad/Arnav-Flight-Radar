import { describe, expect, it, vi } from 'vitest';

// Full-detail meshes take a few seconds each on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
import {
  LIGHT_BEACON,
  LIGHT_BEAM,
  LIGHT_LANDING,
  LIGHT_LOGO,
  LIGHT_NAV_L,
  LIGHT_NAV_R,
  LIGHT_STRIDE,
  LIGHT_STROBE,
  LIGHT_TAIL,
  MAT_ROTOR,
  MODEL_SHAPES,
  PART_FLAP,
  PART_GEAR,
  PART_SLAT,
  buildModelMesh,
  getModelMesh,
  type ModelMesh,
} from '@/map/modelMeshes';

type Shape = (typeof MODEL_SHAPES)[number];

const EXPECTED_SHAPES = [
  'narrow',
  'rear-jet',
  'wide-twin',
  'tri-jet',
  'quad',
  'b747',
  'a380',
  'high-turboprop',
  'low-turboprop',
  'high-quad-turboprop',
  'high-jet-quad',
  'single-high',
  'single-low',
  'single-turboprop',
  'heli',
  'glider',
  'fighter',
  'awacs',
];

// Rough real-world span / length of the representative type behind each recipe.
const SPAN_RANGE: Record<string, [number, number]> = {
  narrow: [0.85, 1.05],
  'rear-jet': [0.7, 0.9],
  'wide-twin': [0.85, 1.05],
  'tri-jet': [0.75, 0.95],
  quad: [0.85, 1.05],
  b747: [0.8, 1.0],
  a380: [1.0, 1.2],
  'high-turboprop': [0.9, 1.1],
  'low-turboprop': [1.1, 1.35],
  'high-quad-turboprop': [1.25, 1.45],
  'high-jet-quad': [0.88, 1.08],
  'single-high': [1.2, 1.5],
  'single-low': [1.3, 1.6],
  'single-turboprop': [1.05, 1.3],
  heli: [0.9, 1.15],
  glider: [2.0, 2.6],
  fighter: [0.6, 0.78],
  awacs: [0.85, 1.05],
};

const AIRLINERS = ['narrow', 'rear-jet', 'wide-twin', 'tri-jet', 'quad', 'b747', 'a380'];
const FIXED_GEAR = ['single-high', 'single-low'];
const NO_FLAPS = ['heli', 'glider', 'fighter'];

/** Rodrigues rotation of v about unit axis k by angle a. */
function arot(v: number[], k: number[], a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k[0]! * v[0]! + k[1]! * v[1]! + k[2]! * v[2]!;
  const cr = [k[1]! * v[2]! - k[2]! * v[1]!, k[2]! * v[0]! - k[0]! * v[2]!, k[0]! * v[1]! - k[1]! * v[0]!];
  return [0, 1, 2].map((i) => v[i]! * c + cr[i]! * s + k[i]! * d * (1 - c));
}

/** Position of vertex v after rotating its moving part by `ang` (as the vertex shader does). */
function moved(m: ModelMesh, v: number, ang: number): number[] {
  const piv = [m.part[v * 4 + 1]!, m.part[v * 4 + 2]!, m.part[v * 4 + 3]!];
  const ax = [m.axis[v * 4]!, m.axis[v * 4 + 1]!, m.axis[v * 4 + 2]!];
  const rel = [0, 1, 2].map((i) => m.positions[v * 3 + i]! - piv[i]!);
  const r = arot(rel, ax, ang);
  return [0, 1, 2].map((i) => piv[i]! + r[i]!);
}

function lightsOf(m: ModelMesh, type: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.lightCount; i++) {
    const o = i * LIGHT_STRIDE;
    if (m.lights[o + 3] === type) out.push([m.lights[o]!, m.lights[o + 1]!, m.lights[o + 2]!, m.lights[o + 4]!, m.lights[o + 5]!]);
  }
  return out;
}

describe('procedural aircraft meshes', () => {
  it('has a recipe for every ModelShape', () => {
    expect([...MODEL_SHAPES].sort()).toEqual([...EXPECTED_SHAPES].sort());
  });

  for (const shape of EXPECTED_SHAPES) {
    for (const lod of [0, 1, 2]) {
      it(`builds a sane mesh for ${shape} (lod ${lod})`, () => {
        const m = buildModelMesh(shape as Shape, lod);
        expect(m.lod).toBe(lod);
        expect(m.positions.length).toBe(m.normals.length);
        expect(m.positions.length % 9).toBe(0);
        expect(m.colorIndex.length * 3).toBe(m.positions.length);
        expect(m.disc.length).toBe(m.positions.length);
        expect(m.part.length).toBe(m.vertexCount * 4);
        expect(m.axis.length).toBe(m.vertexCount * 4);
        expect(m.vertexCount * 3).toBe(m.positions.length);
        expect(m.opaqueVertexCount % 3).toBe(0);
        const budget = [4200, 2000, 1000][lod]!;
        expect(m.triangleCount).toBeLessThanOrEqual(budget);
        expect(m.triangleCount).toBeGreaterThan(lod === 2 ? 120 : 300);
        expect(m.gearTriangleCount).toBeLessThanOrEqual(1200);

        for (let v = 0; v < m.vertexCount; v++) {
          const l = Math.hypot(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!);
          expect(Math.abs(l - 1)).toBeLessThan(1e-4);
          expect(Number.isFinite(m.positions[v * 3]! + m.positions[v * 3 + 1]! + m.positions[v * 3 + 2]!)).toBe(true);
          // translucent discs strictly after the opaque airframe
          expect(m.colorIndex[v] === MAT_ROTOR).toBe(v >= m.opaqueVertexCount);
        }

        // opaque airframe is 1 unit long along +y, centred, wheels on z = 0
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        let sumX = 0;
        for (let v = 0; v < m.opaqueVertexCount; v++) {
          minY = Math.min(minY, m.positions[v * 3 + 1]!);
          maxY = Math.max(maxY, m.positions[v * 3 + 1]!);
          minZ = Math.min(minZ, m.positions[v * 3 + 2]!);
          sumX += m.positions[v * 3]!;
        }
        expect(maxY - minY).toBeCloseTo(1, 5);
        expect(maxY).toBeCloseTo(0.5, 5);
        expect(minZ).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.abs(sumX / m.opaqueVertexCount)).toBeLessThan(1e-3); // left/right symmetric

        const [lo, hi] = SPAN_RANGE[shape]!;
        expect(m.spanRatio).toBeGreaterThan(lo);
        expect(m.spanRatio).toBeLessThan(hi);
        expect(m.max[2] - m.min[2]).toBeLessThan(0.45); // not absurdly tall
      });
    }
  }

  it('caches meshes per shape and level of detail', () => {
    expect(getModelMesh('narrow')).toBe(getModelMesh('narrow'));
    expect(getModelMesh('narrow', 1)).toBe(getModelMesh('narrow', 1));
    expect(getModelMesh('narrow', 1)).not.toBe(getModelMesh('narrow'));
  });

  it('gets cheaper with every level of detail', () => {
    for (const shape of MODEL_SHAPES) {
      const [a, b, c] = [0, 1, 2].map((l) => getModelMesh(shape, l));
      expect(b!.triangleCount).toBeLessThan(a!.triangleCount * 0.62);
      expect(c!.triangleCount).toBeLessThan(b!.triangleCount);
      expect(c!.gearVertexCount + c!.flapVertexCount + c!.slatVertexCount).toBe(0);
      expect(b!.lightCount).toBe(a!.lightCount); // same light points (the renderer uses LOD 0's)
    }
  });

  it('has spinning discs exactly where expected', () => {
    for (const shape of ['heli', 'high-turboprop', 'low-turboprop', 'high-quad-turboprop', 'single-high', 'single-low', 'single-turboprop']) {
      expect(getModelMesh(shape as Shape).opaqueVertexCount).toBeLessThan(getModelMesh(shape as Shape).vertexCount);
    }
    for (const shape of ['narrow', 'a380', 'glider', 'fighter', 'awacs']) {
      const m = getModelMesh(shape as Shape);
      expect(m.opaqueVertexCount).toBe(m.vertexCount);
    }
  });
});

describe('landing gear', () => {
  it('is flagged retractable on every family except fixed-gear singles and helicopters', () => {
    for (const shape of MODEL_SHAPES) {
      const m = getModelMesh(shape);
      if (shape === 'heli') {
        expect(m.gearTriangleCount).toBe(0); // skids are part of the airframe
        expect(m.gearVertexCount).toBe(0);
      } else if (FIXED_GEAR.includes(shape)) {
        expect(m.gearTriangleCount).toBeGreaterThan(0); // fixed: always drawn, not flagged
        expect(m.gearVertexCount).toBe(0);
      } else {
        expect(m.gearVertexCount).toBe(m.gearTriangleCount * 3);
        expect(m.gearVertexCount).toBeGreaterThan(0);
      }
    }
  });

  it('puts the wheels on the ground and folds them up and in when retracted', () => {
    for (const shape of MODEL_SHAPES) {
      const m = getModelMesh(shape);
      if (!m.gearVertexCount) continue;
      let lowest = Infinity;
      let nose = false;
      let mainsL = false;
      let mainsR = false;
      for (let v = 0; v < m.vertexCount; v++) {
        if (m.part[v * 4] !== PART_GEAR) continue;
        const z = m.positions[v * 3 + 2]!;
        lowest = Math.min(lowest, z);
        const pivZ = m.part[v * 4 + 3]!;
        expect(pivZ).toBeGreaterThan(z - 0.02); // pivot (strut top) above the leg (glider wheel: semi-recessed)
        // fully retracted (90°): the leg ends up roughly level with the strut top
        const r = moved(m, v, Math.PI / 2);
        expect(r[2]!).toBeGreaterThan(pivZ - 0.05);
        const px = m.part[v * 4 + 1]!;
        if (Math.abs(px) < 1e-6) nose = true;
        else {
          if (px > 0) mainsR = true;
          else mainsL = true;
          // mains swing inboard
          expect(Math.abs(r[0]!)).toBeLessThanOrEqual(Math.abs(m.positions[v * 3]!) + 0.035);
        }
      }
      expect(lowest).toBeCloseTo(0, 4);
      expect(nose).toBe(true);
      if (shape !== 'glider') {
        expect(mainsL).toBe(true);
        expect(mainsR).toBe(true);
      }
    }
  });
});

describe('flaps and slats', () => {
  it('are present where the real aircraft has them', () => {
    for (const shape of MODEL_SHAPES) {
      const m = getModelMesh(shape);
      if (NO_FLAPS.includes(shape)) expect(m.flapVertexCount).toBe(0);
      else expect(m.flapVertexCount).toBeGreaterThan(0);
      if (AIRLINERS.includes(shape) || shape === 'awacs' || shape === 'high-jet-quad') expect(m.slatVertexCount).toBeGreaterThan(0);
      else expect(m.slatVertexCount).toBe(0);
    }
  });

  it('hinge so that both sides deflect trailing edge down (flaps) and leading edge down (slats)', () => {
    for (const shape of MODEL_SHAPES) {
      const m = getModelMesh(shape);
      let left = 0;
      let right = 0;
      for (let v = 0; v < m.vertexCount; v++) {
        const kind = m.part[v * 4];
        if (kind !== PART_FLAP && kind !== PART_SLAT) continue;
        const ax = [m.axis[v * 4]!, m.axis[v * 4 + 1]!, m.axis[v * 4 + 2]!];
        expect(Math.hypot(ax[0]!, ax[1]!, ax[2]!)).toBeCloseTo(1, 4);
        // offset from the hinge line, perpendicular to it
        const rel = [0, 1, 2].map((i) => m.positions[v * 3 + i]! - m.part[v * 4 + 1 + i]!);
        const along = rel[0]! * ax[0]! + rel[1]! * ax[1]! + rel[2]! * ax[2]!;
        const perp = rel.map((c, i) => c - along * ax[i]!);
        const z = m.positions[v * 3 + 2]!;
        if (kind === PART_FLAP) {
          expect(perp[1]!).toBeLessThanOrEqual(5e-3); // flap panels lie aft of their hinge
          if (-perp[1]! > 0.005) {
            expect(moved(m, v, 0.61)[2]!).toBeLessThan(z); // 35° moves the trailing edge down
            if (m.part[v * 4 + 1]! < 0) left++;
            else right++;
          }
        } else {
          expect(perp[1]!).toBeGreaterThanOrEqual(-5e-3); // slats lie ahead of their hinge
          if (perp[1]! > 0.5 * Math.abs(perp[2]!) + 0.003) expect(moved(m, v, -0.33)[2]!).toBeLessThan(z);
        }
      }
      if (m.flapVertexCount) {
        expect(left).toBeGreaterThan(0);
        expect(left).toBe(right);
      }
    }
  });
});

describe('exterior lights', () => {
  it('has red on the left wingtip, green on the right, tail, strobes and beacon', () => {
    for (const shape of MODEL_SHAPES) {
      const m = getModelMesh(shape);
      if (shape === 'glider') {
        expect(m.lightCount).toBe(0);
        continue;
      }
      const [l] = lightsOf(m, LIGHT_NAV_L);
      const [r] = lightsOf(m, LIGHT_NAV_R);
      expect(l).toBeDefined();
      expect(r).toBeDefined();
      expect(l![0]!).toBeLessThan(0);
      expect(r![0]!).toBeGreaterThan(0);
      expect(l![0]!).toBeCloseTo(-r![0]!, 6);
      if (shape !== 'heli') expect(Math.abs(r![0]!) * 2).toBeGreaterThan(m.spanRatio * 0.9); // at the tips
      expect(lightsOf(m, LIGHT_TAIL)).toHaveLength(1);
      expect(m.anchors.navL[3]).toBeGreaterThan(0);
      if (shape !== 'fighter') {
        expect(lightsOf(m, LIGHT_STROBE).length).toBeGreaterThanOrEqual(2);
        expect(lightsOf(m, LIGHT_BEACON).length).toBeGreaterThanOrEqual(1);
      }
      expect(lightsOf(m, LIGHT_LANDING).length).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < m.lightCount; i++) {
        expect(m.lights[i * LIGHT_STRIDE + 4]!).toBeGreaterThan(0); // glow size
        expect(m.lights[i * LIGHT_STRIDE + 5]!).toBeGreaterThan(0); // intensity
      }
    }
  });

  it('gives airliners logo lights and a taxi-light beam ahead of the nose gear', () => {
    for (const shape of AIRLINERS) {
      const m = getModelMesh(shape as Shape);
      expect(lightsOf(m, LIGHT_LOGO)).toHaveLength(2);
      expect(m.anchors.logo[3]).toBeGreaterThan(0);
      const beams = lightsOf(m, LIGHT_BEAM);
      expect(beams.length).toBeGreaterThanOrEqual(3);
      const taxi = lightsOf(m, LIGHT_LANDING).find((p) => Math.abs(p[0]!) < 1e-6)!;
      for (const b of beams) expect(b[1]!).toBeGreaterThan(taxi[1]!); // beam points ahead
    }
    expect(lightsOf(getModelMesh('fighter'), LIGHT_LOGO)).toHaveLength(0);
  });
});
