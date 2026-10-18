// Airport buildings up close, part 2 (loaded on demand by airport3d.ts once a buildings file is
// on screen): shaped roofs, parapets, glazing and rooftop details, sitting on the 3D terrain.
//
//   • Roof shapes from OpenStreetMap when mapped (roof:shape / roof:height / roof:orientation /
//     roof:direction), otherwise by building type: hangars get barrel vaults spanning their
//     short side, many terminals and piers gently arched roofs, cargo sheds low-pitched gables,
//     small service buildings gabled or hipped roofs; the rest flat roofs behind a parapet.
//   • Curved and pitched roofs are true meshes drawn by a small custom WebGL layer
//     ('apt3d-roofs') right after the building extrusions, shaded with MapLibre's own
//     fill-extrusion lighting formula so roof and walls match; the extruded body stops at the
//     eaves and gable walls close the ends. The mesh comes from the footprint itself (ear-clipped,
//     then cut along the roof's creases inside its oriented bounding box), so L-shaped or
//     irregular hangars still get a continuous vault.
//   • Flat roofs: a recessed roof deck inside a parapet ring; big ones carry rooftop plant.
//     Terminals and piers get a glazed curtain-wall band (lit warm at night), offices and
//     hotels window bands per storey; multi-storey car parks open decks (slab edges over a dark
//     recessed core), a rooftop parapet, lamp posts and stair cores; control towers a glazed
//     cab, a roof cap and an antenna mast.
//   • Terrain: MapLibre seats each extrusion on the terrain at its centroid; the roof meshes do
//     the same (queryTerrainElevation at the footprint's centroid, re-checked as terrain tiles
//     load) so roofs never float above or sink into their walls.

import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { buildingColours, localProjection, mixColour, parseColour, type BuildingProps, type BuildingsFile, type Palette } from './airport3d';

type XY = [number, number];
type Ring = XY[];
type Feature = GeoJSON.Feature<GeoJSON.Polygon, BuildingProps>;

// ---------------------------------------------------------------- planar geometry (unit-tested)

/** Signed area (m², counter-clockwise positive) of an open or closed ring. */
export function ringAreaXY(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The ring without its closing duplicate and without repeated / collinear points, counter-clockwise. */
export function cleanRing(ring: Ring): Ring {
  let r = ring.slice();
  if (r.length > 1) {
    const f = r[0]!;
    const l = r[r.length - 1]!;
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) r.pop();
  }
  const out: Ring = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) <= 0.05) out.pop();
  // drop (near-)collinear vertices
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 0.02 * Math.hypot(c[0] - a[0], c[1] - a[1])) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  r = out;
  return ringAreaXY(r) < 0 ? r.reverse() : r;
}

/** Convex hull (counter-clockwise, monotone chain). */
export function convexHull(pts: Ring): Ring {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Ring = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Ring = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Oriented bounding box: centre, long-axis unit u, v = u turned 90° left, half length / width, footprint fill ratio. */
export interface Obb {
  c: XY;
  u: XY;
  v: XY;
  hl: number;
  hw: number;
  fill: number;
}

/** Minimum-area oriented bounding box of a ring (its long axis is u). */
export function orientedBox(ring: Ring): Obb {
  const pts = cleanRing(ring);
  const hull = convexHull(pts);
  let best: Obb = { c: [0, 0], u: [1, 0], v: [0, 1], hl: 0, hw: 0, fill: 0 };
  let bestA = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const d: XY = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const n: XY = [-d[1], d[0]];
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const p of hull) {
      const s = p[0] * d[0] + p[1] * d[1];
      const t = p[0] * n[0] + p[1] * n[1];
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const A = (s1 - s0) * (t1 - t0);
    if (A < bestA - 1e-9) {
      bestA = A;
      const sm = (s0 + s1) / 2;
      const tm = (t0 + t1) / 2;
      best = { c: [d[0] * sm + n[0] * tm, d[1] * sm + n[1] * tm], u: d, v: n, hl: (s1 - s0) / 2, hw: (t1 - t0) / 2, fill: 0 };
    }
  }
  if (best.hl < best.hw) {
    const u = best.v;
    best = { ...best, u, v: [-u[1], u[0]], hl: best.hw, hw: best.hl };
  }
  best.fill = bestA > 0 && Number.isFinite(bestA) ? Math.abs(ringAreaXY(pts)) / bestA : 0;
  return best;
}

/** The ring shrunk inwards by d metres (mitred), or null when it would collapse or turn inside out. */
export function insetRing(ring: Ring, d: number): Ring | null {
  const r = cleanRing(ring);
  const n = r.length;
  if (n < 3) return null;
  const dir = r.map((p, i) => {
    const q = r[(i + 1) % n]!;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l] as XY;
  });
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const d0 = dir[(i + n - 1) % n]!;
    const d1 = dir[i]!;
    const p = r[i]!;
    const n0: XY = [-d0[1], d0[0]];
    const n1: XY = [-d1[1], d1[0]];
    // intersection of the two offset edges through p + n·d
    const a: XY = [p[0] + n0[0] * d, p[1] + n0[1] * d];
    const b: XY = [p[0] + n1[0] * d, p[1] + n1[1] * d];
    const den = d0[0] * d1[1] - d0[1] * d1[0];
    let q: XY;
    if (Math.abs(den) < 1e-6) q = b;
    else {
      const t = ((b[0] - a[0]) * d1[1] - (b[1] - a[1]) * d1[0]) / den;
      q = [a[0] + d0[0] * t, a[1] + d0[1] * t];
    }
    const m = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (m > 3 * d) q = [p[0] + ((q[0] - p[0]) / m) * 3 * d, p[1] + ((q[1] - p[1]) / m) * 3 * d];
    out.push(q);
  }
  for (let i = 0; i < n; i++) {
    const p = out[i]!;
    const q = out[(i + 1) % n]!;
    if ((q[0] - p[0]) * dir[i]![0] + (q[1] - p[1]) * dir[i]![1] <= 0) return null;
  }
  const a0 = ringAreaXY(r);
  const a1 = ringAreaXY(out);
  return a1 > 0.15 * a0 && a1 < a0 ? out : null;
}

export function pointInRing(p: XY, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Ear-clipping triangulation of a simple ring (counter-clockwise triangles), or null if it fails. */
export function triangulate(ring: Ring): [XY, XY, XY][] | null {
  const pts = cleanRing(ring);
  const idx = pts.map((_, i) => i);
  const out: [XY, XY, XY][] = [];
  const cross = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3) {
    if (guard++ > 4 * pts.length + 10) return null;
    let found = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!;
      const b = pts[ib]!;
      const c = pts[ic]!;
      if (cross(a, b, c) <= 1e-9) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j]!;
        if (cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      found = true;
      break;
    }
    if (!found) return null;
  }
  if (idx.length === 3) out.push([pts[idx[0]!]!, pts[idx[1]!]!, pts[idx[2]!]!]);
  return out;
}

/** Sutherland–Hodgman: polygon clipped by a convex counter-clockwise polygon. */
function clipConvex(poly: Ring, clip: Ring): Ring {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const side = (p: XY) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k]!;
      const q = inp[(k + 1) % inp.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- roof shapes

export type RoofShape = 'flat' | 'gable' | 'hipped' | 'pyramid' | 'barrel' | 'skillion' | 'dome';
export interface RoofSpec {
  shape: RoofShape;
  /** Height from the eaves to the top (m). */
  rise: number;
  /** Ridge across the long axis (OSM roof:orientation=across). */
  across: boolean;
  /** Skillion: compass direction the roof slopes down towards (degrees). */
  dir?: number;
}

const TAGGED: Record<string, RoofShape> = {
  flat: 'flat',
  gabled: 'gable',
  'half-hipped': 'hipped',
  hipped: 'hipped',
  side_hipped: 'hipped',
  mansard: 'hipped',
  gambrel: 'gable',
  saltbox: 'gable',
  pyramidal: 'pyramid',
  dome: 'dome',
  onion: 'dome',
  round: 'barrel',
  barrel: 'barrel',
  arched: 'barrel',
  skillion: 'skillion',
  lean_to: 'skillion',
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The roof for a building: OSM tags when present, otherwise plausible by type and footprint
 * (o = its oriented box, area in m²).
 */
export function roofFor(p: BuildingProps, o: Obb, area: number, seed = p.osm ?? ''): RoofSpec {
  const span = p.height_m - p.min_height_m;
  const across = p.roof_orientation === 'across';
  const short = 2 * o.hw;
  const rect = o.fill >= 0.82;
  const h = hashStr(seed);
  let shape: RoofShape = 'flat';
  let rise = 0;
  const tagged = p.roof_shape ? TAGGED[p.roof_shape.toLowerCase()] : undefined;
  if (tagged) {
    shape = tagged;
    const hw = across ? o.hl : o.hw;
    rise =
      p.roof_height_m ??
      (shape === 'barrel' ? 0.22 * 2 * hw : shape === 'dome' ? 0.6 * Math.min(o.hl, o.hw) : shape === 'skillion' ? 0.27 * 2 * hw : shape === 'flat' ? 0 : 0.58 * hw);
  } else if (!p.part && p.kind !== 'jet_bridge') {
    switch (p.kind) {
      case 'hangar':
        if (o.fill >= 0.7 && short >= 15) {
          shape = 'barrel';
          rise = clamp(0.13 * short, 2.5, 14);
        }
        break;
      case 'terminal':
        if (rect && short >= 30 && h < 0.5) {
          shape = 'barrel';
          rise = clamp(0.05 * short, 2, 8);
        }
        break;
      case 'pier':
        if (rect && short >= 14 && short <= 60 && h < 0.6) {
          shape = 'barrel';
          rise = clamp(0.08 * short, 1.2, 4);
        }
        break;
      case 'cargo':
        if (o.fill >= 0.75 && short >= 20) {
          shape = 'gable';
          rise = clamp(0.05 * short, 0.8, 4);
        }
        break;
      case 'other':
        if (rect && area < 600 && span <= 12) {
          shape = h < 0.65 ? 'gable' : 'hipped';
          rise = clamp(0.36 * o.hw, 1, 4);
        } else if (rect && area < 5000 && span <= 16 && h < 0.3) {
          shape = 'gable';
          rise = clamp(0.1 * o.hw, 0.8, 3);
        }
        break;
      default:
        break;
    }
  }
  if (shape !== 'flat') {
    rise = Math.min(rise, 0.45 * span, span - 2.5);
    if (!(rise >= 0.6)) shape = 'flat';
  }
  const spec: RoofSpec = { shape, rise: shape === 'flat' ? 0 : rise, across };
  if (p.roof_direction !== undefined && Number.isFinite(p.roof_direction)) spec.dir = p.roof_direction;
  return spec;
}

/** Roof triangles and gable walls in local metres (z from the eaves); `wall` = 1 per wall vertex. */
export interface RoofMesh {
  pos: number[];
  nrm: number[];
  wall: number[];
}

/**
 * The roof surface over a footprint (local metres): the footprint is ear-clipped and each
 * triangle cut along the roof's creases (ridge, hips, vault strips) in the oriented box frame,
 * so faces stay planar (or smoothly curved); vertical walls close the roof along the footprint
 * wherever the roof stands above the eaves. Returns null when the footprint can't be meshed.
 */
export function roofMesh(ring: Ring, spec: RoofSpec, obb: Obb): RoofMesh | null {
  if (spec.shape === 'flat' || spec.rise <= 0) return null;
  const tris = triangulate(ring);
  if (!tris?.length) return null;
  let { u, v, hl, hw } = obb;
  // the ridge runs along the long axis unless tagged across (hips, pyramids and domes follow the footprint)
  if (spec.across && (spec.shape === 'gable' || spec.shape === 'barrel' || spec.shape === 'skillion')) {
    u = obb.v;
    v = [-obb.u[0], -obb.u[1]];
    hl = obb.hw;
    hw = obb.hl;
  }
  const { c } = obb;
  const R = spec.rise;
  const m = 0.5; // cell margin beyond the box
  const toST = (p: XY): XY => [(p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]];
  const toXY = (s: number, t: number): XY => [c[0] + u[0] * s + v[0] * t, c[1] + u[1] * s + v[1] * t];
  // skillion slope direction in the (s, t) frame
  let sd: XY = [0, -1];
  if (spec.dir !== undefined) {
    const a = (spec.dir * Math.PI) / 180;
    const down: XY = [Math.sin(a), Math.cos(a)];
    sd = [down[0] * u[0] + down[1] * u[1], down[0] * v[0] + down[1] * v[1]];
  }
  const ext = Math.max(1e-6, hl * Math.abs(sd[0]) + hw * Math.abs(sd[1]));
  const Ra = (hw * hw + R * R) / (2 * R); // vault radius
  const height = (s: number, t: number): number => {
    switch (spec.shape) {
      case 'gable':
        return R * (1 - Math.abs(t) / hw);
      case 'hipped':
        return R * Math.min(1 - Math.abs(t) / hw, (hl - Math.abs(s)) / hw);
      case 'pyramid':
        return R * Math.min(1 - Math.abs(t) / hw, 1 - Math.abs(s) / hl);
      case 'skillion':
        return R / 2 - ((R / 2) * (sd[0] * s + sd[1] * t)) / ext;
      case 'barrel':
        return Math.abs(t) >= hw ? 0 : Math.sqrt(Math.max(0, Ra * Ra - t * t)) - (Ra - R);
      case 'dome':
        return R * Math.sqrt(Math.max(0, 1 - (s / hl) ** 2 - (t / hw) ** 2));
      default:
        return 0;
    }
  };
  const H = (s: number, t: number) => Math.max(0, Math.min(R, height(s, t)));
  // creases → convex cells covering the box (slightly beyond it)
  const HL = hl + m;
  const HW = hw + m;
  const rect = (s0: number, t0: number, s1: number, t1: number): Ring => [
    [s0, t0],
    [s1, t0],
    [s1, t1],
    [s0, t1],
  ];
  let cells: Ring[];
  const smooth = spec.shape === 'barrel' || spec.shape === 'dome';
  switch (spec.shape) {
    case 'gable':
      cells = [rect(-HL, -HW, HL, 0), rect(-HL, 0, HL, HW)];
      break;
    case 'hipped': {
      const r = Math.max(0, hl - hw);
      cells = [
        [
          [-r, 0],
          [r, 0],
          [r + HW, HW],
          [-r - HW, HW],
        ],
        [
          [-r - HW, -HW],
          [r + HW, -HW],
          [r, 0],
          [-r, 0],
        ],
        [
          [r, 0],
          [r + HW, -HW],
          [r + HW, HW],
        ],
        [
          [-r, 0],
          [-r - HW, HW],
          [-r - HW, -HW],
        ],
      ];
      break;
    }
    case 'pyramid': {
      const k = 1 + m / Math.min(hl, hw);
      const A: XY = [hl * k, hw * k];
      cells = [
        [
          [0, 0],
          [A[0], A[1]],
          [-A[0], A[1]],
        ],
        [
          [0, 0],
          [-A[0], -A[1]],
          [A[0], -A[1]],
        ],
        [
          [0, 0],
          [A[0], -A[1]],
          [A[0], A[1]],
        ],
        [
          [0, 0],
          [-A[0], A[1]],
          [-A[0], -A[1]],
        ],
      ];
      break;
    }
    case 'barrel': {
      const n = clamp(Math.round((2 * hw) / 2.5), 8, 18);
      cells = [];
      for (let i = 0; i < n; i++) {
        const t0 = i === 0 ? -HW : -hw + (2 * hw * i) / n;
        const t1 = i === n - 1 ? HW : -hw + (2 * hw * (i + 1)) / n;
        cells.push(rect(-HL, t0, HL, t1));
      }
      break;
    }
    case 'dome': {
      const n = 8;
      cells = [];
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) cells.push(rect(-HL + (2 * HL * i) / n, -HW + (2 * HW * j) / n, -HL + (2 * HL * (i + 1)) / n, -HW + (2 * HW * (j + 1)) / n));
      break;
    }
    default:
      cells = [rect(-HL, -HW, HL, HW)];
  }
  const out: RoofMesh = { pos: [], nrm: [], wall: [] };
  const e = 0.05;
  const normalAt = (s: number, t: number): [number, number, number] => {
    const fs = (H(s + e, t) - H(s - e, t)) / (2 * e);
    const ft = (H(s, t + e) - H(s, t - e)) / (2 * e);
    const nx = -fs * u[0] - ft * v[0];
    const ny = -fs * u[1] - ft * v[1];
    const l = Math.hypot(nx, ny, 1);
    return [nx / l, ny / l, 1 / l];
  };
  const vert = (s: number, t: number, n: [number, number, number]) => {
    const p = toXY(s, t);
    out.pos.push(p[0], p[1], H(s, t));
    out.nrm.push(n[0], n[1], n[2]);
    out.wall.push(0);
  };
  for (const tri of tris) {
    const st = tri.map(toST);
    const bs0 = Math.min(st[0]![0], st[1]![0], st[2]![0]);
    const bs1 = Math.max(st[0]![0], st[1]![0], st[2]![0]);
    const bt0 = Math.min(st[0]![1], st[1]![1], st[2]![1]);
    const bt1 = Math.max(st[0]![1], st[1]![1], st[2]![1]);
    for (const cell of cells) {
      let cs0 = Infinity;
      let cs1 = -Infinity;
      let ct0 = Infinity;
      let ct1 = -Infinity;
      for (const [s, t] of cell) {
        cs0 = Math.min(cs0, s);
        cs1 = Math.max(cs1, s);
        ct0 = Math.min(ct0, t);
        ct1 = Math.max(ct1, t);
      }
      if (cs0 > bs1 || cs1 < bs0 || ct0 > bt1 || ct1 < bt0) continue;
      const poly = clipConvex(st, cell);
      if (poly.length < 3 || Math.abs(ringAreaXY(poly)) < 1e-4) continue;
      // planar faces: one normal from the cell's centre; curved: per vertex
      let cn: [number, number, number] | null = null;
      if (!smooth) {
        let sc = 0;
        let tc = 0;
        for (const [s, t] of poly) {
          sc += s;
          tc += t;
        }
        cn = normalAt(sc / poly.length, tc / poly.length);
      }
      for (let k = 1; k < poly.length - 1; k++)
        for (const q of [poly[0]!, poly[k]!, poly[k + 1]!]) vert(q[0], q[1], cn ?? normalAt(q[0], q[1]));
    }
  }
  // walls under the roof along the footprint (gable ends, vault ends …)
  const r = cleanRing(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const n: [number, number, number] = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0];
    const steps = Math.max(1, Math.ceil(l / 0.75));
    let pPrev = a;
    let hPrev = H(...toST(a));
    for (let k = 1; k <= steps; k++) {
      const p: XY = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
      const hp = H(...toST(p));
      if (hPrev + hp > 0.03) {
        const quad: [XY, number][] = [
          [pPrev, -0.3],
          [p, -0.3],
          [p, hp],
          [pPrev, hPrev],
        ];
        for (const j of [0, 1, 2, 0, 2, 3]) {
          const [q, z] = quad[j]!;
          out.pos.push(q[0], q[1], z);
          out.nrm.push(n[0], n[1], n[2]);
          out.wall.push(1);
        }
      }
      pPrev = p;
      hPrev = hp;
    }
  }
  return out;
}

// ---------------------------------------------------------------- extrusion features + roof batch

interface Geom {
  ring: Ring; // local metres, clean, counter-clockwise
  area: number;
  obb: Obb;
  spec: RoofSpec;
  eave: number;
  mesh: RoofMesh | null;
  parapet: Ring | null; // inset ring (local metres)
  centroid: [number, number]; // lon, lat (vertex average, like MapLibre's extrusion centroid)
}

const geomCache = new WeakMap<Feature, Geom>();
const MAX_ROOF_VERTICES = 160;

function geomOf(f: Feature, P: ReturnType<typeof localProjection>): Geom {
  let g = geomCache.get(f);
  if (g) return g;
  const outer = f.geometry.coordinates[0] ?? [];
  const ring = cleanRing(outer.map(([lon, lat]) => P.fwd(lat!, lon!)));
  const area = Math.abs(ringAreaXY(ring));
  const obb = orientedBox(ring);
  const p = f.properties;
  let spec: RoofSpec = ring.length >= 3 ? roofFor(p, obb, area) : { shape: 'flat', rise: 0, across: false };
  let mesh: RoofMesh | null = null;
  if (spec.shape !== 'flat' && (ring.length > MAX_ROOF_VERTICES || f.geometry.coordinates.length > 1)) spec = { ...spec, shape: 'flat', rise: 0 };
  if (spec.shape !== 'flat') {
    mesh = roofMesh(ring, spec, obb);
    if (!mesh) spec = { ...spec, shape: 'flat', rise: 0 };
  }
  let sx = 0;
  let sy = 0;
  const n = Math.max(1, outer.length - 1);
  for (let i = 0; i < n; i++) {
    sx += outer[i]![0]!;
    sy += outer[i]![1]!;
  }
  g = {
    ring,
    area,
    obb,
    spec,
    eave: p.height_m - spec.rise,
    mesh,
    parapet: spec.shape === 'flat' && area > 60 ? insetRing(ring, Math.min(0.6, 0.08 * obb.hw)) : null,
    centroid: [sx / n, sy / n],
  };
  geomCache.set(f, g);
  return g;
}

/** Custom-layer roof geometry: interleaved x, y, z (origin metres, mercator-aligned), normal, colour. */
export interface RoofBatch {
  origin: { x: number; y: number; k0: number };
  verts: Float32Array;
  ranges: { start: number; count: number; lon: number; lat: number }[];
  vertexCount: number;
}
export const ROOF_STRIDE = 9;

const toRgb = (hex: string): [number, number, number] => {
  const c = parseColour(hex) ?? [200, 200, 200];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
};

/**
 * Extrusion features (walls, parapets, glazing, rooftop details) and roof meshes for a
 * buildings file in the style's palette at a night factor.
 */
export function roofedBuildings(file: BuildingsFile, pal: Palette, night: number): { extrusion: GeoJSON.FeatureCollection; roofs: RoofBatch } {
  const P = localProjection(file.center[0], file.center[1]);
  const out: GeoJSON.Feature[] = [];
  const ringLL = (r: Ring): number[][] => {
    const c = r.map(([x, y]) => {
      const [lon, lat] = P.inv(x, y);
      return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
    });
    c.push(c[0]!);
    return c;
  };
  const add = (rings: number[][][], color: string, base: number, top: number, kind: string) => {
    if (top - base < 0.02) return;
    out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: { color, base, top, kind } });
  };
  const square = (x: number, y: number, a: number): Ring => [
    [x - a, y - a],
    [x + a, y - a],
    [x + a, y + a],
    [x - a, y + a],
  ];
  const obbRect = (o: Obb, s: number, t: number, a: number, b: number): Ring => {
    const pt = (ds: number, dt: number): XY => [o.c[0] + o.u[0] * (s + ds) + o.v[0] * (t + dt), o.c[1] + o.u[1] * (s + ds) + o.v[1] * (t + dt)];
    return [pt(-a, -b), pt(a, -b), pt(a, b), pt(-a, b)];
  };
  const inside = (r: Ring, ring: Ring) => r.every((q) => pointInRing(q, ring));
  const glassOf = (wall: string, warm: number) => {
    const g = mixColour(wall, pal.cab.wall, pal.dark ? 0.55 : 0.45);
    return night > 0 ? mixColour(g, pal.glow, warm * night) : g;
  };
  const antenna = (g: Geom, top: number, h: number) => {
    const c = g.obb.c;
    add([ringLL(square(c[0], c[1], 0.25))], pal.cap.wall, top, top + h, 'control_tower');
    add([ringLL(square(c[0] + 1.6, c[1], 0.12))], pal.cap.wall, top, top + h * 0.55, 'control_tower');
  };

  // the top of each mapper-modelled control tower (a stack of plain control_tower features)
  const towerTop = new Set<Feature>();
  const towers = file.features.filter((f) => f.properties.kind === 'control_tower' && !f.properties.part);
  for (const f of towers) {
    const g = geomOf(f, P);
    if (g.area > 1500 || f.properties.height_m < 18) continue;
    const taller = towers.some((o) => o !== f && o.properties.height_m > f.properties.height_m && Math.hypot(geomOf(o, P).obb.c[0] - g.obb.c[0], geomOf(o, P).obb.c[1] - g.obb.c[1]) < 40);
    if (!taller) towerTop.add(f);
  }

  const items: { g: Geom; roof: [number, number, number]; wall: [number, number, number] }[] = [];
  for (const f of file.features) {
    const p = f.properties;
    const h = p.height_m;
    const base = p.min_height_m;
    const span = h - base;
    const { wall, roof } = buildingColours(p, pal, night);
    const rings = f.geometry.coordinates as number[][][];
    if (p.part || p.kind === 'jet_bridge' || span < 3) {
      add(rings, wall, base, h, p.kind);
      if (p.part === 'cap') antenna(geomOf(f, P), h, clamp(0.12 * h, 4, 12));
      continue;
    }
    const g = geomOf(f, P);
    if (p.kind === 'control_tower' && towerTop.has(f)) {
      add(rings, wall, base, h - 5.5, p.kind);
      add(rings, pal.cab.wall, h - 5.5, h - 0.8, p.kind);
      add(rings, pal.cap.wall, h - 0.8, h, p.kind);
      antenna(g, h, clamp(0.12 * h, 4, 10));
      continue;
    }
    if (p.kind === 'parking' && g.spec.shape === 'flat') {
      carPark(f, g, wall, roof);
      continue;
    }
    const top = g.spec.shape === 'flat' ? h - 0.9 : g.eave;
    // the walls: glazing bands on terminals / piers, window rows on offices / hotels
    if ((p.kind === 'terminal' || p.kind === 'pier') && top - base >= 7) {
      const g0 = base + Math.max(1.0, 0.18 * (top - base));
      const g1 = top - Math.max(1.2, 0.12 * (top - base));
      add(rings, wall, base, g0, p.kind);
      add(rings, glassOf(wall, 0.3), g0, g1, p.kind);
      add(rings, wall, g1, top, p.kind);
    } else if ((p.kind === 'office' || p.kind === 'hotel') && top - base >= 7 && top - base <= 90 && g.area >= 150) {
      const n = Math.max(2, Math.round((top - base) / 3.6));
      const lvl = (top - base) / n;
      const glass = glassOf(wall, 0.25);
      for (let i = 0; i < n; i++) {
        const z = base + i * lvl;
        add(rings, wall, z, z + lvl * 0.38, p.kind);
        add(rings, glass, z + lvl * 0.38, z + lvl, p.kind);
      }
    } else add(rings, wall, base, top, p.kind);
    if (g.spec.shape === 'flat') {
      // roof deck inside a parapet
      if (g.parapet) {
        add(rings, roof, h - 0.9, h - 0.75, p.kind);
        add([ringLL(g.ring), ringLL([...g.parapet].reverse())], mixColour(wall, '#ffffff', pal.dark ? 0.12 : 0.05), h - 0.9, h, p.kind);
        // rooftop plant on big roofs
        if (g.area >= 1500 && p.kind !== 'pier') {
          const n = g.area >= 8000 ? 3 : g.area >= 3500 ? 2 : 1;
          const plant = mixColour(roof, pal.dark ? '#8a94a3' : '#ffffff', 0.25);
          for (let i = 0; i < n; i++) {
            const s = n === 1 ? 0.2 * g.obb.hl : (-0.5 + i / (n - 1)) * 0.6 * g.obb.hl;
            const r = obbRect(g.obb, s, (hashStr(`${p.osm ?? ''}${i}`) - 0.5) * 0.4 * g.obb.hw, Math.min(5, 0.12 * g.obb.hl), Math.min(4, 0.25 * g.obb.hw));
            if (inside(r, g.parapet)) add([ringLL(r)], plant, h - 0.75, h + 1.4 + hashStr(`${i}${p.osm ?? ''}`) * 1.2, p.kind);
          }
        }
      } else add(rings, roof, h - 0.9, h, p.kind);
    } else if (g.mesh) items.push({ g, roof: toRgb(roof), wall: toRgb(wall) });
  }

  function carPark(f: Feature, g: Geom, wall: string, roof: string) {
    const p = f.properties;
    const h = p.height_m;
    const base = p.min_height_m;
    const core = insetRing(g.ring, 1.2) ?? insetRing(g.ring, 0.6);
    const rings = f.geometry.coordinates as number[][][];
    if (!core) {
      add(rings, wall, base, h, p.kind);
      return;
    }
    const n = clamp(Math.round((h - base) / 3), 1, 12);
    const lvl = (h - base) / n;
    // dark recessed core (warm-lit at night) between the deck slabs
    const coreCol = mixColour(mixColour(wall, '#05070a', 0.55), pal.glow, 0.3 * night);
    add([ringLL(core)], coreCol, base, h - 0.1, p.kind);
    const slab = mixColour(wall, '#ffffff', pal.dark ? 0.1 : 0.04);
    for (let i = 1; i <= n; i++) add(rings, i === n ? roof : slab, base + i * lvl - 0.5, base + i * lvl, p.kind);
    const rim = insetRing(g.ring, 0.3);
    if (rim) add([ringLL(g.ring), ringLL([...rim].reverse())], slab, h, h + 1.0, p.kind);
    // lamp posts on the top deck, stair / lift cores at its ends
    const o = g.obb;
    const lamps: Ring[] = [];
    for (let s = -o.hl + 10; s <= o.hl - 10 && lamps.length < 16; s += 24)
      for (let t = -o.hw + 8; t <= o.hw - 8 && lamps.length < 16; t += 24) {
        const r = obbRect(o, s, t, 0.15, 0.15);
        if (inside(r, core)) lamps.push(r);
      }
    for (const r of lamps) add([ringLL(r)], pal.cap.wall, h, h + 5, p.kind);
    for (const s of [-1, 1]) {
      const r = obbRect(o, s * (o.hl - 4), 0, 2.6, 2.6);
      if (inside(r, g.ring)) add([ringLL(r)], wall, base, h + 3.2, p.kind);
    }
  }

  return { extrusion: { type: 'FeatureCollection', features: out }, roofs: roofBatch(file, P, items) };
}

function roofBatch(file: BuildingsFile, P: ReturnType<typeof localProjection>, items: { g: Geom; roof: [number, number, number]; wall: [number, number, number] }[]): RoofBatch {
  const o = MercatorCoordinate.fromLngLat([file.center[1], file.center[0]]);
  const k0 = o.meterInMercatorCoordinateUnits();
  let n = 0;
  for (const it of items) n += it.g.mesh!.wall.length;
  const verts = new Float32Array(n * ROOF_STRIDE);
  const ranges: RoofBatch['ranges'] = [];
  let v = 0;
  for (const { g, roof, wall } of items) {
    const m = g.mesh!;
    const start = v;
    for (let i = 0; i < m.wall.length; i++, v++) {
      const [lon, lat] = P.inv(m.pos[i * 3]!, m.pos[i * 3 + 1]!);
      const mc = MercatorCoordinate.fromLngLat([lon, lat]);
      const c = m.wall[i] ? wall : roof;
      verts.set([(mc.x - o.x) / k0, (mc.y - o.y) / k0, g.eave + m.pos[i * 3 + 2]!, m.nrm[i * 3]!, m.nrm[i * 3 + 1]!, m.nrm[i * 3 + 2]!, c[0], c[1], c[2]], v * ROOF_STRIDE);
    }
    ranges.push({ start, count: v - start, lon: g.centroid[0], lat: g.centroid[1] });
  }
  return { origin: { x: o.x, y: o.y, k0 }, verts, ranges, vertexCount: v };
}

// ---------------------------------------------------------------- the roof layer

const LAYER_ID = 'apt3d-roofs';
const MIN_ZOOM = 13.5;

const VS = `
attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute vec3 a_col;
uniform mat4 u_matrix;
uniform vec3 u_light;
uniform vec3 u_lightcol;
uniform float u_intensity;
uniform float u_alpha;
varying vec3 v_col;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  // MapLibre's fill-extrusion lighting (tile space: y points south)
  vec3 n = vec3(a_nrm.x, -a_nrm.y, a_nrm.z);
  float lum = dot(a_col, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = a_col + vec3(0.03);
  float d = clamp(dot(n, u_light), 0.0, 1.0);
  d = mix(1.0 - u_intensity, max(1.0 - lum + u_intensity, 1.0), d);
  if (abs(n.z) < 0.01) d *= 0.84;
  v_col = clamp(col * d * u_lightcol, 0.0, 1.0) * u_alpha;
}`;
const FS = `
varying vec3 v_col;
uniform float u_alpha;
void main() { outColor = vec4(v_col, u_alpha); }`;

interface Gpu {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  prog: WebGLProgram;
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject | null;
  u: Record<string, WebGLUniformLocation | null>;
  count: number;
}

const st = {
  map: null as MlMap | null,
  batch: null as RoofBatch | null,
  visible: false,
  dirty: true,
  elev: [] as number[],
  elevAt: 0,
  gpu: null as Gpu | null,
  broken: false,
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`apt3d-roofs shader: ${gl.getShaderInfoLog(s) ?? ''}`);
  return s;
}

function createGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): Gpu {
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const vs = webgl2 ? `#version 300 es\n#define attribute in\n#define varying out\n${VS}` : `precision highp float;\n${VS}`;
  const fs = webgl2 ? `#version 300 es\nprecision highp float;\n#define varying in\nout vec4 outColor;\n${FS}` : `precision highp float;\n#define outColor gl_FragColor\n${FS}`;
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  ['a_pos', 'a_nrm', 'a_col'].forEach((n, i) => gl.bindAttribLocation(prog, i, n));
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`apt3d-roofs link: ${gl.getProgramInfoLog(prog) ?? ''}`);
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('createBuffer failed');
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ['u_matrix', 'u_light', 'u_lightcol', 'u_intensity', 'u_alpha']) u[n] = gl.getUniformLocation(prog, n);
  let vao: WebGLVertexArrayObject | null = null;
  if (webgl2) {
    const g2 = gl as WebGL2RenderingContext;
    const prev = g2.getParameter(g2.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    vao = g2.createVertexArray();
    g2.bindVertexArray(vao);
    pointers(gl, vbo);
    g2.bindVertexArray(prev);
  }
  return { gl, prog, vbo, vao, u, count: 0 };
}

function pointers(gl: WebGLRenderingContext, vbo: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const S = ROOF_STRIDE * 4;
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, S, i * 12);
  }
}

/** Terrain elevation (m, as drawn) at each roof's footprint centroid; zeros without terrain. */
function elevations(map: MlMap, b: RoofBatch): number[] {
  if (!map.getTerrain()) return b.ranges.map(() => 0);
  return b.ranges.map((r) => {
    try {
      return map.queryTerrainElevation([r.lon, r.lat]) ?? 0;
    } catch {
      return 0;
    }
  });
}

function upload(g: Gpu, b: RoofBatch, elev: number[]) {
  const data = new Float32Array(b.verts);
  b.ranges.forEach((r, i) => {
    const e = elev[i] ?? 0;
    if (!e) return;
    for (let v = r.start; v < r.start + r.count; v++) data[v * ROOF_STRIDE + 2] = data[v * ROOF_STRIDE + 2]! + e;
  });
  g.gl.bindBuffer(g.gl.ARRAY_BUFFER, g.vbo);
  g.gl.bufferData(g.gl.ARRAY_BUFFER, data, g.gl.STATIC_DRAW);
  g.count = b.vertexCount;
}

function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}

/** MapLibre's fill-extrusion light: position (spherical), colour, intensity, anchored to the viewport by default. */
function lightUniforms(map: MlMap): { pos: [number, number, number]; col: [number, number, number]; intensity: number } {
  const l = (map.getLight?.() ?? {}) as { position?: unknown; color?: unknown; intensity?: unknown; anchor?: unknown };
  const pos: [number, number, number] =
    Array.isArray(l.position) && l.position.length === 3 && l.position.every((x) => typeof x === 'number') ? (l.position as [number, number, number]) : [1.15, 210, 30];
  const [r, az0, polar0] = pos;
  const az = ((az0 + 90) * Math.PI) / 180;
  const polar = (polar0 * Math.PI) / 180;
  let x = r * Math.cos(az) * Math.sin(polar);
  let y = r * Math.sin(az) * Math.sin(polar);
  const z = r * Math.cos(polar);
  if (l.anchor !== 'map') {
    const b = (map.getBearing() * Math.PI) / 180;
    const c = Math.cos(b);
    const s = Math.sin(b);
    [x, y] = [c * x - s * y, s * x + c * y];
  }
  const col = typeof l.color === 'string' ? parseColour(l.color) : undefined;
  return { pos: [x, y, z], col: col ? [col[0] / 255, col[1] / 255, col[2] / 255] : [1, 1, 1], intensity: typeof l.intensity === 'number' ? l.intensity : 0.5 };
}

function render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
  const map = st.map;
  const b = st.batch;
  if (!map || !b || !st.visible || st.broken || !b.vertexCount) return;
  const z = map.getZoom();
  if (z < MIN_ZOOM) return;
  const pd = args.defaultProjectionData;
  if (typeof pd.projectionTransition === 'number' && pd.projectionTransition > 0) return;
  if (gl.isContextLost()) {
    st.gpu = null;
    return;
  }
  if (!st.gpu || st.gpu.gl !== gl) {
    st.gpu = createGpu(gl);
    st.dirty = true;
  }
  const g = st.gpu;
  const now = performance.now();
  if (now - st.elevAt > 2000) {
    st.elevAt = now;
    const e = elevations(map, b);
    if (e.length !== st.elev.length || e.some((v, i) => Math.abs(v - st.elev[i]!) > 0.25)) {
      st.elev = e;
      st.dirty = true;
    }
  }
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const saved = {
    prog: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    vao: webgl2 ? (gl.getParameter((gl as WebGL2RenderingContext).VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null) : null,
    blend: gl.isEnabled(gl.BLEND),
    depth: gl.isEnabled(gl.DEPTH_TEST),
    cull: gl.isEnabled(gl.CULL_FACE),
    depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
    depthFunc: gl.getParameter(gl.DEPTH_FUNC) as number,
    src: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    dst: gl.getParameter(gl.BLEND_DST_RGB) as number,
    srcA: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
    dstA: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
  };
  try {
    if (st.dirty) {
      upload(g, b, st.elev);
      st.dirty = false;
    }
    const o = b.origin;
    const T = [o.k0, 0, 0, 0, 0, o.k0, 0, 0, 0, 0, o.k0, 0, o.x, o.y, 0, 1];
    const M = mul4(pd.mainMatrix, T);
    const alpha = Math.max(0, Math.min(1, (z - MIN_ZOOM) / 1.1)) * 0.96;
    const L = lightUniforms(map);
    gl.useProgram(g.prog);
    gl.uniformMatrix4fv(g.u.u_matrix!, false, M);
    gl.uniform3f(g.u.u_light!, L.pos[0], L.pos[1], L.pos[2]);
    gl.uniform3f(g.u.u_lightcol!, L.col[0], L.col[1], L.col[2]);
    gl.uniform1f(g.u.u_intensity!, L.intensity);
    gl.uniform1f(g.u.u_alpha!, alpha);
    if (g.vao) (gl as WebGL2RenderingContext).bindVertexArray(g.vao);
    else pointers(gl, g.vbo);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    if (alpha < 0.999) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, g.count);
  } finally {
    if (g.vao) (gl as WebGL2RenderingContext).bindVertexArray(saved.vao);
    else for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, saved.buf);
    gl.useProgram(saved.prog);
    if (saved.blend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (saved.depth) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (saved.cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.depthMask(saved.depthMask);
    gl.depthFunc(saved.depthFunc);
    gl.blendFuncSeparate(saved.src, saved.dst, saved.srcA, saved.dstA);
  }
}

const layer: CustomLayerInterface = {
  id: LAYER_ID,
  type: 'custom',
  renderingMode: '3d',
  render: (gl, args) => {
    try {
      render(gl, args);
    } catch (e) {
      if (!st.broken) console.warn('[apt3d-roofs] disabled after an error:', e);
      st.broken = true;
    }
  },
  onRemove: () => {
    const g = st.gpu;
    if (g && !g.gl.isContextLost()) {
      g.gl.deleteBuffer(g.vbo);
      g.gl.deleteProgram(g.prog);
      if (g.vao) (g.gl as WebGL2RenderingContext).deleteVertexArray(g.vao);
    }
    st.gpu = null;
  },
};

/** Adds the roof layer (after the building extrusions: before `beforeId`). */
export function installRoofLayer(map: MlMap, beforeId?: string) {
  st.map = map;
  try {
    if (!map.getLayer(LAYER_ID)) map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
  } catch {
    /* style not ready: airport3d installs again on the next style load */
  }
}

/** Replaces the roofs on screen (null: none). */
export function setRoofs(map: MlMap, batch: RoofBatch | null) {
  st.map = map;
  st.batch = batch;
  st.elev = batch ? elevations(map, batch) : [];
  st.elevAt = performance.now();
  st.dirty = true;
  map.triggerRepaint();
}

export function setRoofsVisible(map: MlMap, on: boolean) {
  if (st.visible === on) return;
  st.visible = on;
  map.triggerRepaint();
}
