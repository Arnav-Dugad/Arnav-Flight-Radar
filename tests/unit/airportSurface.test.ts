import { describe, expect, it } from 'vitest';
import type * as GeoJSON from 'geojson';
import {
  bearingOf,
  bezier,
  buildAirportSurface,
  ccw,
  centrelineDashes,
  clipOutside,
  directionSignSpec,
  endMarkings,
  holdMarking,
  localFrame,
  namedChains,
  pointAlong,
  pxPerMetreZ0,
  ringArea,
  runwaySignText,
  runwaysFromDetail,
  signArrow,
  thresholdStripes,
  turnAngle,
  type GroundFile,
  type XY,
} from '@/map/airportSurface';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('threshold stripes (ICAO Annex 14)', () => {
  it.each([
    [18, 4],
    [23, 6],
    [30, 8],
    [45, 12],
    [60, 16],
  ])('a %i m runway has %i stripes', (w, n) => {
    expect(thresholdStripes(w).offsets).toHaveLength(n);
  });

  it('keeps 3 m clear of the edges and a double space at the centre line', () => {
    for (const W of [23, 30, 45, 60]) {
      const { offsets, w } = thresholdStripes(W);
      const outer = Math.max(...offsets) + w / 2;
      expect(close(outer, Math.min(W / 2 - 3, 27), 1e-9)).toBe(true);
      const inner = Math.min(...offsets.filter((o) => o > 0)) - w / 2;
      expect(close(inner * 2, 2 * w, 1e-9)).toBe(true); // double spacing across the centre line
      // symmetric
      expect(offsets.map((o) => -o).sort((a, b) => a - b)).toEqual(offsets);
    }
  });
});

describe('runway end markings', () => {
  it('places piano keys 6–36 m in and the designator after them', () => {
    const m = endMarkings(3900, 45, 0, true);
    const keys = m.boxes.filter((b) => b[0] === 6 && b[1] === 36);
    expect(keys).toHaveLength(12);
    expect(m.desig).toBeGreaterThan(48);
    expect(m.clStart).toBeGreaterThan(m.desig);
    expect(m.arrows).toHaveLength(0);
  });

  it('adds aiming point and six touchdown-zone pairs on long runways', () => {
    const m = endMarkings(3900, 45, 0, false);
    const aim = m.boxes.filter((b) => b[0] === 400 && b[1] === 460);
    expect(aim).toHaveLength(2);
    const tdzStations = new Set(m.boxes.filter((b) => b[1] - b[0] === 22.5).map((b) => b[0]));
    expect(tdzStations.size).toBe(6);
    // nothing overlaps the aiming point
    for (const s of tdzStations) expect(s + 22.5 <= 390 || s >= 470).toBe(true);
  });

  it('shifts everything past a displaced threshold and draws arrows before it', () => {
    const m = endMarkings(3900, 45, 300, true);
    expect(m.boxes.some((b) => b[0] === 306 && b[1] === 336)).toBe(true);
    expect(m.arrows.length).toBeGreaterThan(0);
    for (const a of m.arrows) for (const [s] of a) expect(s).toBeLessThan(300);
  });

  it('skips touchdown-zone markings on short runways', () => {
    const m = endMarkings(1000, 30, 0, false);
    expect(m.boxes.filter((b) => b[1] - b[0] === 22.5)).toHaveLength(0);
  });

  it('dashes the centre line 30 m on, 20 m off', () => {
    const d = centrelineDashes(100, 300);
    expect(d.map((b) => b[0])).toEqual([100, 150, 200, 250]);
    expect(d[0]![1] - d[0]![0]).toBe(30);
  });
});

describe('geometry helpers', () => {
  it('local frame round-trips', () => {
    const P = localFrame(51.47, -0.45);
    const [x, y] = P.fwd(51.48, -0.44);
    const [lon, lat] = P.inv(x, y);
    expect(close(lat, 51.48, 1e-6)).toBe(true);
    expect(close(lon, -0.44, 1e-6)).toBe(true);
  });

  it('pixels per metre doubles per zoom level (512 px tiles)', () => {
    const m0 = pxPerMetreZ0(0);
    expect(close(1 / (m0 * 2 ** 16), 1.1943, 1e-3)).toBe(true); // ≈ 1.19 m/px at z16 on the equator
    expect(pxPerMetreZ0(60)).toBeCloseTo(m0 * 2, 6);
  });

  it('bearings and turn angles', () => {
    expect(bearingOf([1, 0])).toBeCloseTo(90);
    expect(bearingOf([0, -1])).toBeCloseTo(180);
    expect(turnAngle([0, 1], [1, 0])).toBeCloseTo(90); // north → east is a right turn
    expect(turnAngle([0, 1], [-1, 0])).toBeCloseTo(-90);
    expect(signArrow(80)).toBe(90);
    expect(signArrow(-30)).toBe(-45);
    expect(signArrow(170)).toBeUndefined();
  });

  it('orients rings counter-clockwise', () => {
    const cw: XY[] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(ringArea(cw)).toBeLessThan(0);
    expect(ringArea(ccw(cw))).toBeGreaterThan(0);
  });

  it('clips a crossing segment out of a runway rectangle', () => {
    const rwy = { o: [0, 0] as XY, u: [1, 0] as XY, s0: 0, s1: 1000, t0: -25, t1: 25 };
    const parts = clipOutside([500, -100], [500, 100], [rwy]);
    expect(parts).toHaveLength(2);
    expect(parts[0]![1][1]).toBeCloseTo(-25);
    expect(parts[1]![0][1]).toBeCloseTo(25);
    // outside entirely: unchanged
    expect(clipOutside([1200, -100], [1200, 100], [rwy])).toHaveLength(1);
    // fully inside: removed
    expect(clipOutside([100, -10], [100, 10], [rwy])).toHaveLength(0);
  });

  it('point along a polyline and Bézier ends', () => {
    const line: XY[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const a = pointAlong(line, 15);
    expect(a.p[0]).toBeCloseTo(10);
    expect(a.p[1]).toBeCloseTo(5);
    expect(a.dir).toEqual([0, 1]);
    const b = bezier([0, 0], [1, 0], [2, 0], [3, 0], 6);
    expect(b).toHaveLength(7);
    expect(b[6]).toEqual([3, 0]);
  });
});

describe('holding positions and signs', () => {
  it('puts the dashed lines on the runway side', () => {
    const m = holdMarking([0, 0], [0, 1], 11.5, true);
    const solid = m.yellow.filter((r) => Math.abs(Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0])) - 23) < 1e-6);
    const dashes = m.yellow.filter((r) => !solid.includes(r));
    expect(solid).toHaveLength(2);
    expect(dashes.length).toBeGreaterThan(8);
    const ys = (rs: XY[][]) => rs.flatMap((r) => r.map((p) => p[1]));
    expect(Math.max(...ys(solid))).toBeLessThan(Math.min(...ys(dashes))); // runway is +y
    for (const r of m.yellow) expect(ringArea(r)).toBeGreaterThan(0);
  });

  it('names the runway end on the left first', () => {
    // East–west runway 09/27 north of a hold, approaching it northbound: 09 threshold (west) is on the left.
    const a: XY = [0, 100];
    const b: XY = [3000, 100];
    expect(runwaySignText([1500, 0], [0, 1], a, b, '09', '27')).toBe('09-27');
    // Southbound from the north side: 27's threshold (east) is on the left.
    expect(runwaySignText([1500, 200], [0, -1], a, b, '09', '27')).toBe('27-09');
    // At the very end: only that end.
    expect(runwaySignText([10, 0], [0, 1], a, b, '09', '27')).toBe('09');
  });

  it('builds direction-sign arrays left to right around the location sign', () => {
    const spec = directionSignSpec('A', [
      { name: 'B', angle: -88 },
      { name: 'C', angle: 47 },
      { name: 'A', angle: 0 },
      { name: 'B', angle: -130 },
      { name: '', angle: 90 },
    ]);
    expect(spec).toBe('D~B~-90|L~A|D~C~45');
    expect(directionSignSpec('A', [{ name: 'A', angle: 10 }])).toBeUndefined();
  });

  it('splits taxiway chains at junctions and name changes', () => {
    const edges: [number, number, number?][] = [
      [0, 1, 0],
      [1, 2, 0],
      [2, 3, 1],
      [2, 4, 0],
    ];
    const chains = namedChains(edges, ['A', 'B']);
    // Direction does not matter: normalise each chain to start at its lower end.
    const norm = (p: number[]) => (p[0]! > p[p.length - 1]! ? [...p].reverse() : p);
    const byName = chains.map((c) => `${c.name}:${norm(c.pts).join('-')}`).sort();
    expect(byName).toEqual(['A:0-1-2', 'A:2-4', 'B:2-3']);
  });
});

describe('airport assembly', () => {
  const lat = 51.47;
  const lon = -0.45;
  const k = Math.cos((lat * Math.PI) / 180) * 111_320;
  const at = (x: number, y: number): [number, number] => [lat + y / 111_320, lon + x / k];

  it('builds runway, markings, designators, taxiways, holds, signs and stands', () => {
    const [aLat, aLon] = at(-1500, 0);
    const [bLat, bLon] = at(1500, 0);
    const ground: GroundFile = {
      // A taxiway parallel to the runway 200 m south, with a stub north to a hold and across the runway.
      nodes: [at(-1000, -200), at(0, -200), at(1000, -200), at(0, -110), at(0, 110), at(0, -400)],
      edges: [
        [0, 1, 0],
        [1, 2, 0],
        [1, 3, 1],
        [3, 4, 1],
        [1, 5, 2],
      ],
      names: ['A', 'B1', 'C'],
      holds: [[...at(0, -100), 'B1'] as [number, number, string]],
      stands: [[...at(400, -300), '12', 0, 1, 1] as [number, number, string, number, number, number]],
    };
    const runways = runwaysFromDetail({
      type: 'large_airport',
      runways: [{ lighted: true, closed: false, leIdent: '09L', heIdent: '27R', lengthFt: 9843, widthFt: 148, surface: 'ASP', leLat: aLat, leLon: aLon, heLat: bLat, heLon: bLon }],
    });
    expect(runways[0]!.width).toBeCloseTo(45.1, 1);
    const s = buildAirportSurface({ lat, lon }, runways, ground);
    const kinds = (fs: { properties: unknown }[]) => fs.map((f) => (f.properties as { k: string }).k);
    expect(kinds(s.polys)).toEqual(expect.arrayContaining(['shoulder', 'rwy', 'white', 'hold', 'holdbg']));
    const desig = s.pts.filter((f) => f.properties?.k === 'desig');
    expect(desig.map((f) => f.properties?.text).sort()).toEqual(['09\nL', '27\nR']);
    const d09 = desig.find((f) => f.properties?.text === '09\nL')!;
    expect(d09.properties?.rot).toBeCloseTo(90, 0);
    // Centre lines never cross the runway: the B1 stub is cut at the runway edge.
    const tcl = s.lines.filter((f) => f.properties?.k === 'tcl');
    for (const f of tcl)
      for (const [x, y] of (f.geometry as GeoJSON.LineString).coordinates as [number, number][]) {
        const yy = (y - lat) * 111_320;
        const xx = (x - lon) * k;
        if (Math.abs(xx) < 1400) expect(Math.abs(yy) > 23 || Math.abs(yy) < 1e-9).toBe(true);
      }
    const signs = s.pts.filter((f) => f.properties?.k === 'sign').map((f) => f.properties?.img as string);
    expect(signs).toContain('sgn:M~09L-27R|L~B1');
    expect(signs.some((x) => x.startsWith('sgn:') && x.includes('L~A'))).toBe(true);
    expect(s.lines.filter((f) => f.properties?.k === 'lead').length).toBe(2); // lead-in + stop bar
    expect(s.pts.find((f) => f.properties?.k === 'standno')?.properties?.text).toBe('12');
    for (const f of s.polys)
      for (const poly of (f.geometry as GeoJSON.MultiPolygon).coordinates as [number, number][][][]) expect(ringArea(poly[0]!)).toBeGreaterThan(0);
  });

  it('skips unpaved, closed and helipad runways and defaults the width', () => {
    const base = { lighted: false, leLat: 1, leLon: 1, heLat: 1.01, heLon: 1 };
    const r = runwaysFromDetail({
      type: 'large_airport',
      runways: [
        { ...base, closed: false, surface: 'GRS', leIdent: '01', heIdent: '19' },
        { ...base, closed: true, surface: 'ASP', leIdent: '02', heIdent: '20' },
        { ...base, closed: false, surface: 'ASP', leIdent: 'H1', heIdent: 'H2' },
        { ...base, closed: false, surface: 'ASPH', leIdent: '03', heIdent: '21', lengthFt: 12000 },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.width).toBe(60);
  });
});
