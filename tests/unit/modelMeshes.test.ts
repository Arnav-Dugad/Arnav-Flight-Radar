import { describe, expect, it } from 'vitest';
import { MAT_ROTOR, MODEL_SHAPES, buildModelMesh, getModelMesh } from '@/map/modelMeshes';

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

describe('procedural aircraft meshes', () => {
  it('has a recipe for every ModelShape', () => {
    expect([...MODEL_SHAPES].sort()).toEqual([...EXPECTED_SHAPES].sort());
  });

  for (const shape of EXPECTED_SHAPES) {
    it(`builds a sane mesh for ${shape}`, () => {
      const m = buildModelMesh(shape as (typeof MODEL_SHAPES)[number]);
      expect(m.positions.length).toBe(m.normals.length);
      expect(m.positions.length % 9).toBe(0);
      expect(m.colorIndex.length * 3).toBe(m.positions.length);
      expect(m.disc.length).toBe(m.positions.length);
      expect(m.vertexCount * 3).toBe(m.positions.length);
      expect(m.opaqueVertexCount % 3).toBe(0);
      expect(m.triangleCount).toBeLessThanOrEqual(3500);
      expect(m.triangleCount).toBeGreaterThan(300);

      for (let v = 0; v < m.vertexCount; v++) {
        const l = Math.hypot(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!);
        expect(Math.abs(l - 1)).toBeLessThan(1e-4);
        expect(Number.isFinite(m.positions[v * 3]! + m.positions[v * 3 + 1]! + m.positions[v * 3 + 2]!)).toBe(true);
        // translucent discs strictly after the opaque airframe
        expect(m.colorIndex[v] === MAT_ROTOR).toBe(v >= m.opaqueVertexCount);
      }

      // opaque airframe is 1 unit long along +y, centred, sitting on z = 0
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

  it('caches meshes per shape', () => {
    expect(getModelMesh('narrow')).toBe(getModelMesh('narrow'));
  });

  it('has spinning discs exactly where expected', () => {
    for (const shape of ['heli', 'high-turboprop', 'low-turboprop', 'high-quad-turboprop', 'single-high', 'single-low', 'single-turboprop']) {
      expect(getModelMesh(shape as (typeof MODEL_SHAPES)[number]).opaqueVertexCount).toBeLessThan(getModelMesh(shape as (typeof MODEL_SHAPES)[number]).vertexCount);
    }
    for (const shape of ['narrow', 'a380', 'glider', 'fighter', 'awacs']) {
      const m = getModelMesh(shape as (typeof MODEL_SHAPES)[number]);
      expect(m.opaqueVertexCount).toBe(m.vertexCount);
    }
  });
});
