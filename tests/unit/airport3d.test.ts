import { describe, expect, it } from 'vitest';
import { airportAt, basemapIds, LIGHT, localProjection, mixColour, nightFactor, parseColour, placeAlong, polylineLength, runwayLights, taxiPolylines } from '@/map/airport3d';

type Ring = [number, number][];
interface BuildHelpers {
  parseLength(v: unknown): number | undefined;
  buildingHeights(tags: Record<string, string>, kind: string): { height: number; min: number };
  classify(tags: Record<string, string>, parentKind?: string): string;
  ringArea(ring: Ring): number;
  offsetRing(ring: Ring, d: number): Ring;
  simplifyRing(ring: Ring, max?: number): Ring;
  bufferLine(line: Ring, width: number): Ring;
  circle(center: [number, number], r: number, sides?: number): Ring;
  finishPolygon(rings: Ring[], grow?: number): Ring[];
  buildFeatures(elements: unknown[]): { properties: Record<string, unknown>; geometry: { coordinates: Ring[] } }[];
}
// The build script is plain Node ESM; load it at run time (its main() only runs when executed).
const buildUrl = new URL('../../scripts/build-buildings.mjs', import.meta.url).href;
const B = (await import(/* @vite-ignore */ buildUrl)) as BuildHelpers;

/** A w × h metre rectangle (counter-clockwise) at 51° N as [lon, lat]. */
function rect(w: number, h: number, lat = 51, lon = 0): Ring {
  const k = Math.cos((lat * Math.PI) / 180) * 111_320;
  const dx = w / k;
  const dy = h / 111_320;
  return [
    [lon, lat],
    [lon + dx, lat],
    [lon + dx, lat + dy],
    [lon, lat + dy],
    [lon, lat],
  ];
}

describe('height parsing (OSM lengths)', () => {
  it('reads metres, feet and feet-inches', () => {
    expect(B.parseLength('12')).toBe(12);
    expect(B.parseLength('12 m')).toBe(12);
    expect(B.parseLength('12.5m')).toBe(12.5);
    expect(B.parseLength('12,5')).toBe(12.5);
    expect(B.parseLength("40'")).toBeCloseTo(12.2, 1);
    expect(B.parseLength('40 ft')).toBeCloseTo(12.2, 1);
    expect(B.parseLength(`12'6"`)).toBeCloseTo(3.8, 1);
    expect(B.parseLength('tall')).toBeUndefined();
    expect(B.parseLength('')).toBeUndefined();
  });
  it('follows the Simple 3D Buildings rules with sensible defaults', () => {
    expect(B.buildingHeights({ height: '40' }, 'terminal')).toEqual({ height: 40, min: 0 });
    expect(B.buildingHeights({ 'building:levels': '3' }, 'office')).toEqual({ height: 10.8, min: 0 });
    expect(B.buildingHeights({ 'building:levels': '3', 'roof:height': '2 m' }, 'office').height).toBeCloseTo(12.8, 5);
    expect(B.buildingHeights({ height: '104', min_height: '82' }, 'control_tower')).toEqual({ height: 104, min: 82 });
    expect(B.buildingHeights({ 'building:min_level': '2', height: '20' }, 'other').min).toBeCloseTo(7.2, 5);
    expect(B.buildingHeights({}, 'terminal').height).toBe(18);
    expect(B.buildingHeights({}, 'pier').height).toBe(12);
    expect(B.buildingHeights({}, 'hangar').height).toBe(22);
    expect(B.buildingHeights({}, 'hotel').height).toBe(30);
    expect(B.buildingHeights({}, 'other').height).toBe(7);
    // A base at or above the top is pulled below it.
    expect(B.buildingHeights({ height: '10', min_height: '12' }, 'other').min).toBeLessThan(10);
  });
  it('classifies airport building types', () => {
    expect(B.classify({ aeroway: 'terminal', building: 'yes' })).toBe('terminal');
    expect(B.classify({ building: 'hangar' })).toBe('hangar');
    expect(B.classify({ aeroway: 'control_tower' })).toBe('control_tower');
    expect(B.classify({ man_made: 'tower', service: 'aircraft_control' })).toBe('control_tower');
    expect(B.classify({ man_made: 'tower', 'tower:type': 'communication' })).toBe('other');
    expect(B.classify({ building: 'yes', name: 'Pier 6' })).toBe('pier');
    expect(B.classify({ building: 'parking', parking: 'multi-storey' })).toBe('parking');
    expect(B.classify({ building: 'warehouse', name: 'World Cargo Centre' })).toBe('cargo');
    expect(B.classify({ 'building:part': 'yes' }, 'terminal')).toBe('terminal');
  });
});

describe('polygon expansion and simplification', () => {
  it('grows a counter-clockwise outline outward by d metres on every side', () => {
    const r = rect(100, 60);
    expect(B.ringArea(r)).toBeCloseTo(6000, -1);
    const g = B.offsetRing(r, 0.5);
    // (100 + 1) × (60 + 1) for a mitred rectangle.
    expect(B.ringArea(g)).toBeCloseTo(101 * 61, -1);
    expect(g[0]).toEqual(g[g.length - 1]);
  });
  it('shrinks a clockwise ring (a hole) so the polygon grows', () => {
    const hole = [...rect(40, 40)].reverse();
    expect(B.ringArea(hole)).toBeLessThan(0);
    expect(Math.abs(B.ringArea(B.offsetRing(hole, 0.5)))).toBeCloseTo(39 * 39, -1);
  });
  it('orients, grows and rounds polygons in finishPolygon', () => {
    const [outer] = B.finishPolygon([[...rect(50, 50)].reverse()], 0.5);
    expect(B.ringArea(outer!)).toBeGreaterThan(2500);
    for (const [x, y] of outer!) {
      expect(Math.round(x * 1e5)).toBeCloseTo(x * 1e5, 6);
      expect(Math.round(y * 1e5)).toBeCloseTo(y * 1e5, 6);
    }
  });
  it('keeps rings to at most 64 vertices', () => {
    const c = B.circle([0, 51], 300, 400);
    expect(c.length).toBe(401);
    const s = B.simplifyRing(c, 64);
    expect(s.length).toBeLessThanOrEqual(65);
    expect(Math.abs(B.ringArea(s))).toBeGreaterThan(Math.abs(B.ringArea(c)) * 0.95);
  });
  it('buffers a jet bridge line into a 3 m wide polygon', () => {
    const k = Math.cos((51 * Math.PI) / 180) * 111_320;
    const poly = B.bufferLine(
      [
        [0, 51],
        [30 / k, 51],
      ],
      3,
    );
    expect(B.ringArea(poly)).toBeCloseTo(90, 0);
  });
});

describe('OSM → extrusion features', () => {
  const way = (id: number, ring: Ring, tags: Record<string, string>) => ({ type: 'way', id, tags, geometry: ring.map(([lon, lat]) => ({ lat, lon })) });
  it('lets building parts replace the outline they cover', () => {
    const outline = rect(100, 100);
    const part = rect(99, 99, 51.000001, 0.0000005);
    const f = B.buildFeatures([way(1, outline, { aeroway: 'terminal', building: 'yes' }), way(2, part, { 'building:part': 'yes', height: '25' })]);
    expect(f).toHaveLength(1);
    expect(f[0]!.properties).toMatchObject({ kind: 'terminal', height_m: 25, osm: 'w2' });
  });
  it('drops tiny sheds but keeps towers, and models a tower node as shaft, cab and cap', () => {
    const f = B.buildFeatures([way(3, rect(4, 4), { building: 'yes' }), { type: 'node', id: 9, lat: 51, lon: 0, tags: { aeroway: 'control_tower', height: '60' } }]);
    expect(f.map((x) => x.properties.part)).toEqual(['shaft', 'cab', 'cap']);
    expect(f[1]!.properties).toMatchObject({ height_m: 60, min_height_m: 53 });
    expect(f[2]!.properties).toMatchObject({ height_m: 61.5, min_height_m: 60 });
  });
  it('lifts jet bridges off the ground', () => {
    const k = Math.cos((51 * Math.PI) / 180) * 111_320;
    const f = B.buildFeatures([{ type: 'way', id: 5, tags: { aeroway: 'jet_bridge' }, geometry: [{ lat: 51, lon: 0 }, { lat: 51, lon: 25 / k }] }]);
    expect(f[0]!.properties).toMatchObject({ kind: 'jet_bridge', height_m: 6.5, min_height_m: 3.5 });
  });
});

describe('light placement', () => {
  it('places points at a fixed spacing along a polyline, across vertices', () => {
    const pts = placeAlong(
      [
        [0, 0],
        [45, 0],
        [45, 45],
      ],
      30,
    );
    expect(pts.map((p) => p.s)).toEqual([0, 30, 60, 90]);
    expect(pts[2]!.p[0]).toBeCloseTo(45);
    expect(pts[2]!.p[1]).toBeCloseTo(15);
    expect(polylineLength([[0, 0], [3, 4]])).toBe(5);
  });
  it('lays out a 3 km runway: edges every ~60 m, centreline every 15 m, colour-coded ends', () => {
    const { steady, flashers } = runwayLights([0, 0], [3000, 0], 45, true);
    const edge = steady.filter((l) => Math.abs(Math.abs(l.y) - 24) < 0.01);
    const left = edge.filter((l) => l.y > 0).sort((a, b) => a.x - b.x);
    expect(left).toHaveLength(51);
    expect(left[1]!.x - left[0]!.x).toBeCloseTo(60, 5);
    // Caution zone: the last 600 m of edge lights are yellow.
    expect(left.filter((l) => l.c === LIGHT.yellow).every((l) => l.x >= 2400)).toBe(true);
    expect(left.filter((l) => l.x >= 2400).every((l) => l.c === LIGHT.yellow)).toBe(true);
    const cl = steady.filter((l) => l.y === 0 && l.x >= 0 && l.x <= 3000).sort((a, b) => a.x - b.x);
    expect(cl[1]!.x - cl[0]!.x).toBeCloseTo(15, 5);
    expect(cl.filter((l) => l.x > 2700).every((l) => l.c === LIGHT.red)).toBe(true);
    const mid = cl.filter((l) => l.x > 2100 && l.x < 2700);
    expect(new Set(mid.map((l) => l.c))).toEqual(new Set([LIGHT.red, LIGHT.white]));
    expect(cl.filter((l) => l.x < 2100).every((l) => l.c === LIGHT.white)).toBe(true);
    // Green threshold before the start, red end bar past the far end.
    expect(steady.filter((l) => l.c === LIGHT.green).every((l) => l.x < 0)).toBe(true);
    expect(steady.filter((l) => l.c === LIGHT.red && l.x > 3000).length).toBeGreaterThan(10);
    // Approach lights run 900 m out; the rabbit's five groups sweep toward the threshold.
    expect(Math.min(...steady.map((l) => l.x))).toBeCloseTo(-900, 5);
    expect(flashers.length).toBe(20);
    const order = [...flashers].sort((a, b) => a.x - b.x).map((l) => l.g);
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(4);
    expect(order).toEqual([...order].sort());
  });
  it('omits the approach lights on short runways', () => {
    const { steady, flashers } = runwayLights([0, 0], [1200, 0], 30, true);
    expect(flashers).toHaveLength(0);
    expect(steady.every((l) => l.x > -5)).toBe(true);
  });
  it('chains taxiway edges through degree-two nodes', () => {
    const nodes: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
    ];
    const lines = taxiPolylines(nodes, [
      [0, 1, 0],
      [1, 2, 0],
      [2, 3, 0],
      [1, 4, -1],
    ]);
    // Node 1 is a junction: 0-1, 1-2-3 and 1-4.
    expect(lines.map((l) => l.pts.length).sort()).toEqual([2, 2, 3]);
    expect(lines.find((l) => l.pts.includes(4))!.named).toBe(false);
  });
});

describe('helpers', () => {
  it('fades lights in through civil dusk', () => {
    expect(nightFactor(10)).toBe(0);
    expect(nightFactor(0)).toBe(0);
    expect(nightFactor(-2)).toBeCloseTo(0.5);
    expect(nightFactor(-12)).toBe(1);
  });
  it('mixes OSM colours into the palette', () => {
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
    expect(parseColour('white')).toEqual([255, 255, 255]);
    expect(parseColour('nonsense')).toBeUndefined();
    expect(mixColour('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColour('#123456', undefined, 0.5)).toBe('#123456');
  });
  it('maps OSM ids to base-map feature ids', () => {
    expect(basemapIds('w133146402')).toEqual([1331464022]);
    expect(basemapIds('r54608')).toContain(546080);
    expect(basemapIds('x1')).toEqual([]);
  });
  it('finds the airport whose box contains a point', () => {
    const index = { EGLL: [51.47, -0.46, 51.457, -0.492, 51.477, -0.419, 200], EGKK: [51.15, -0.18, 51.14, -0.2, 51.16, -0.16, 50] } as Record<string, [number, number, number, number, number, number, number]>;
    expect(airportAt(index, 51.47, -0.45)).toBe('EGLL');
    expect(airportAt(index, 51.3, -0.3)).toBeUndefined();
    const P = localProjection(51, 0);
    const [lon, lat] = P.inv(...P.fwd(51.01, 0.02));
    expect(lat).toBeCloseTo(51.01, 9);
    expect(lon).toBeCloseTo(0.02, 9);
  });
});
