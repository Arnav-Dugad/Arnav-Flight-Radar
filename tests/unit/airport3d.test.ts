import { describe, expect, it } from 'vitest';
import { airportAt, basemapIds, displacedThresholds, LIGHT, localProjection, mixColour, nightFactor, paletteFor, parseColour, placeAlong, polylineLength, runwayLights, taxiPolylines, type BuildingProps, type BuildingsFile, type RunwayRow } from '@/map/airport3d';
import { cleanRing, insetRing, orientedBox, ringAreaXY, roofedBuildings, roofFor, roofMesh, triangulate, type Obb } from '@/map/airportRoofs';
import { holdBars, litBars } from '@/map/airportLvp';

type Ring = [number, number][];
interface BuildHelpers {
  roofTags(t: Record<string, string>, pt?: Record<string, string>): Record<string, unknown>;
  deicingPads(elements: unknown[]): Ring[];
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

// ---------------------------------------------------------------- roofs (airportRoofs.ts)

/** A w × h rectangle (local metres) centred on (cx, cy), rotated by `deg` counter-clockwise. */
function box(w: number, h: number, deg = 0, cx = 0, cy = 0): [number, number][] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x! * c - y! * s, cy + x! * s + y! * c] as [number, number]);
}
const props = (kind: BuildingProps['kind'], h: number, extra: Partial<BuildingProps> = {}): BuildingProps => ({ kind, height_m: h, min_height_m: 0, osm: 'w1', ...extra });
/** Horizontal (plan) area covered by a mesh's roof triangles. */
function planArea(m: { pos: number[]; wall: number[] }): number {
  let a = 0;
  for (let i = 0; i < m.wall.length; i += 3) {
    if (m.wall[i]) continue;
    const [x0, y0, x1, y1, x2, y2] = [m.pos[i * 3]!, m.pos[i * 3 + 1]!, m.pos[i * 3 + 3]!, m.pos[i * 3 + 4]!, m.pos[i * 3 + 6]!, m.pos[i * 3 + 7]!];
    a += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
  }
  return a;
}

describe('roof geometry', () => {
  it('fits an oriented box to a rotated footprint', () => {
    const o = orientedBox(box(80, 30, 25, 10, -5));
    expect(o.hl).toBeCloseTo(40, 3);
    expect(o.hw).toBeCloseTo(15, 3);
    expect(o.fill).toBeCloseTo(1, 3);
    expect(Math.abs(o.u[0] * Math.cos((25 * Math.PI) / 180) + o.u[1] * Math.sin((25 * Math.PI) / 180))).toBeCloseTo(1, 5);
    expect(o.c[0]).toBeCloseTo(10, 3);
    const l: [number, number][] = [
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 50],
      [0, 50],
    ];
    expect(orientedBox(l).fill).toBeLessThan(0.7);
  });

  it('cleans, insets and triangulates footprints', () => {
    const r = cleanRing([...box(40, 20), box(40, 20)[0]!].reverse());
    expect(r.length).toBe(4);
    expect(ringAreaXY(r)).toBeCloseTo(800, 6);
    expect(ringAreaXY(insetRing(r, 1)!)).toBeCloseTo(38 * 18, 3);
    expect(insetRing(box(3, 3), 2)).toBeNull();
    const l: [number, number][] = [
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 50],
      [0, 50],
    ];
    const tris = triangulate(l)!;
    expect(tris.length).toBe(4);
    expect(tris.reduce((s, t) => s + ringAreaXY(t), 0)).toBeCloseTo(60 * 20 + 20 * 30, 6);
  });

  it('picks roofs by type, or from OSM tags', () => {
    const big = orientedBox(box(90, 60));
    expect(roofFor(props('hangar', 25), big, 5400).shape).toBe('barrel');
    expect(roofFor(props('office', 30), big, 5400).shape).toBe('flat');
    expect(roofFor(props('parking', 15), big, 5400).shape).toBe('flat');
    const shed = orientedBox(box(14, 9));
    expect(['gable', 'hipped']).toContain(roofFor(props('other', 7), shed, 126).shape);
    const tagged = roofFor(props('other', 12, { roof_shape: 'gabled', roof_height_m: 3 }), big, 5400);
    expect(tagged).toMatchObject({ shape: 'gable', rise: 3 });
    // the roof never eats the walls
    const low = roofFor(props('hangar', 6), big, 5400);
    expect(low.shape === 'flat' || 6 - low.rise >= 2.5).toBe(true);
  });

  it('vaults a hangar across its short side, covering the footprint, with closed ends', () => {
    const ring = box(80, 40, 30);
    const o: Obb = orientedBox(ring);
    const m = roofMesh(ring, { shape: 'barrel', rise: 6, across: false }, o)!;
    expect(planArea(m)).toBeCloseTo(3200, 0);
    let top = 0;
    let topT = Infinity;
    for (let i = 0; i < m.wall.length; i++) {
      const z = m.pos[i * 3 + 2]!;
      if (m.wall[i]) continue;
      expect(z).toBeGreaterThanOrEqual(-1e-6);
      expect(z).toBeLessThanOrEqual(6 + 1e-6);
      if (z > top - 1e-6) {
        top = z;
        topT = Math.abs((m.pos[i * 3]! - o.c[0]) * o.v[0] + (m.pos[i * 3 + 1]! - o.c[1]) * o.v[1]);
      }
    }
    expect(top).toBeCloseTo(6, 1);
    expect(topT).toBeLessThan(2); // the crown runs along the long axis
    expect(m.wall.some((w) => w === 1)).toBe(true);
    // normals point up on the roof
    for (let i = 0; i < m.wall.length; i++) if (!m.wall[i]) expect(m.nrm[i * 3 + 2]!).toBeGreaterThan(0.3);
  });

  it('meshes gables and hips over an L-shaped footprint', () => {
    const l: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    for (const shape of ['gable', 'hipped', 'pyramid', 'skillion', 'dome'] as const) {
      const m = roofMesh(l, { shape, rise: 3, across: false }, orientedBox(l))!;
      expect(planArea(m)).toBeCloseTo(400, 0);
    }
  });

  it('builds parapets, glazing and roof meshes for a buildings file', () => {
    const P = localProjection(51, 0);
    const ll = (r: [number, number][]) => [...r, r[0]!].map(([x, y]) => {
      const [lon, lat] = P.inv(x, y);
      return [lon, lat];
    });
    const file: BuildingsFile = {
      type: 'FeatureCollection',
      icao: 'TEST',
      center: [51, 0],
      bbox: [50.99, -0.01, 51.01, 0.01],
      features: [
        { type: 'Feature', properties: props('hangar', 24, { osm: 'w2' }), geometry: { type: 'Polygon', coordinates: [ll(box(90, 50, 0, -200, 0))] } },
        { type: 'Feature', properties: props('office', 20, { osm: 'w3' }), geometry: { type: 'Polygon', coordinates: [ll(box(60, 40, 0, 200, 0))] } },
        { type: 'Feature', properties: props('parking', 15, { osm: 'w4' }), geometry: { type: 'Polygon', coordinates: [ll(box(80, 50, 0, 0, 200))] } },
      ],
    };
    const r = roofedBuildings(file, paletteFor('dark' as never), 0);
    expect(r.roofs.ranges.length).toBe(1); // the hangar's vault
    expect(r.roofs.vertexCount).toBeGreaterThan(30);
    const feats = r.extrusion.features.map((f) => f.properties as { base: number; top: number; kind: string });
    // the hangar's walls stop at the eaves under its vault
    const hangar = feats.filter((f) => f.kind === 'hangar');
    expect(Math.max(...hangar.map((f) => f.top))).toBeLessThan(24);
    // offices: window bands and a parapet; car park: decks over a recessed core, lamp posts
    expect(feats.filter((f) => f.kind === 'office').length).toBeGreaterThan(6);
    expect(r.extrusion.features.some((f) => f.properties!.kind === 'office' && (f.geometry as { coordinates: unknown[] }).coordinates.length === 2)).toBe(true);
    expect(feats.filter((f) => f.kind === 'parking' && f.top > 15).length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------- stop bars (airportLvp.ts)

describe('stop bars', () => {
  // a north-south taxiway meeting an east-west runway 100 m north of the hold
  const P = localProjection(51, 0);
  const at = (x: number, y: number): [number, number] => {
    const [lon, lat] = P.inv(x, y);
    return [lat, lon];
  };
  const rows: RunwayRow[] = [['09', ...at(-1500, 100), 90, '27', ...at(1500, 100), 270, 3000] as unknown as RunwayRow];
  const [hl, ho] = at(0, 0);
  const ground = {
    nodes: [at(0, -300), at(0, 100), at(-400, -300), at(-400, 300)],
    edges: [
      [0, 1, -1],
      [2, 3, -1],
    ] as [number, number, number][],
    holds: [
      [hl, ho, 'A1'],
      [...at(-400, 250), 'B1'],
    ] as [number, number, string][],
  };
  const bars = holdBars(ground, rows, P);

  it('lays a bar of red lights across the taxiway at each holding position', () => {
    expect(bars.length).toBe(2);
    const a = bars.find((b) => b.ref === 'A1')!;
    expect(Math.abs(a.dir[1])).toBeCloseTo(1, 3); // the taxiway runs north-south
    expect(a.lights.length).toBe(8);
    const xs = a.lights.map((p) => p[0]);
    const ys = a.lights.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(21, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0, 3);
    expect(a.toRunway[1]).toBeCloseTo(1, 3);
    expect(a.runways).toEqual(['09', '27']);
    expect(a.guards[0][1]).toBeCloseTo(0, 3);
  });

  it('serves a runway only within ~120 m of its centreline', () => {
    const b = bars.find((x) => x.ref === 'B1')!;
    expect(b.runways).toEqual([]);
  });

  it('lights every bar in LVP, and at night those of the runways in use', () => {
    expect(litBars(bars, { lvp: true, night: 0, inUse: [] }).length).toBe(2);
    expect(litBars(bars, { lvp: false, night: 0, inUse: ['27'] }).length).toBe(0);
    expect(litBars(bars, { lvp: false, night: 1, inUse: ['27'] }).map((b) => b.ref)).toEqual(['A1']);
    expect(litBars(bars, { lvp: false, night: 1, inUse: ['18'] }).length).toBe(0);
  });
});

describe('build script: roof tags and de-icing pads', () => {
  it('keeps roof shape, height, orientation, direction and levels', () => {
    expect(B.roofTags({ 'roof:shape': 'Gabled', 'roof:height': '3 m', 'roof:orientation': 'across', 'roof:direction': 'NE', 'building:levels': '4' })).toEqual({
      roof_shape: 'gabled',
      roof_height_m: 3,
      roof_orientation: 'across',
      roof_direction: 45,
      levels: 4,
    });
    expect(B.roofTags({ 'roof:direction': '370' }).roof_direction).toBe(10);
    expect(B.roofTags({}, { 'roof:shape': 'round' })).toEqual({ roof_shape: 'round' });
  });
  it('collects de-icing pads but never extrudes them', () => {
    const geometry = rect(80, 60).map(([lon, lat]) => ({ lon, lat }));
    const el = { type: 'way', id: 7, tags: { aeroway: 'deicing_pad' }, geometry };
    expect(B.deicingPads([el]).length).toBe(1);
    expect(B.buildFeatures([el]).length).toBe(0);
  });
});

describe('displaced thresholds', () => {
  it('moves the threshold bar, touchdown zone and approach lights in from the pavement end', () => {
    const plain = runwayLights([0, 0], [3000, 0], 45, true);
    const disp = runwayLights([0, 0], [3000, 0], 45, true, 309);
    const greens = (l: typeof plain) => l.steady.filter((x) => x.c === LIGHT.green).map((x) => x.x);
    expect(Math.max(...greens(plain))).toBeCloseTo(-1, 6);
    expect(Math.min(...greens(disp))).toBeCloseTo(308, 6);
    expect(Math.max(...greens(disp))).toBeCloseTo(308, 6);
    // edge lights before the displaced threshold show red; the far end is unchanged
    expect(disp.steady.some((x) => x.c === LIGHT.red && x.x > 50 && x.x < 300 && Math.abs(x.y) > 20)).toBe(true);
    expect(disp.steady.filter((x) => x.c === LIGHT.red && x.x > 3000).length).toBe(plain.steady.filter((x) => x.c === LIGHT.red && x.x > 3000).length);
    // the approach lights (and their flashers) start at the threshold, partly inset in the pavement
    expect(Math.max(...disp.flashers.map((f) => f.x))).toBeCloseTo(309 - 330, 6);
    expect(Math.min(...disp.flashers.map((f) => f.x))).toBeCloseTo(309 - 900, 6);
  });
  it('reads displaced thresholds from the airport record', () => {
    const m = displacedThresholds([{ leIdent: '09R', heIdent: '27L', leDisplacedThresholdFt: 1014 }]);
    expect(m.get('09R')).toBeCloseTo(309.07, 1);
    expect(m.has('27L')).toBe(false);
  });
});