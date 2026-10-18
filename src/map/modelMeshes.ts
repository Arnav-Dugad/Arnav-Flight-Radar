// Procedural low-poly aircraft meshes for the true-scale 3D model layer (models3d.ts).
//
// Pure geometry, no WebGL. Every ModelShape has its own recipe, written in metres for a
// representative type (A320, CRJ, 777, MD-11, A340, 747, A380, ATR 72, King Air, C-130, C-17,
// C172, PA-28, PC-12, H135, Discus, F-15, E-3) and then normalised.
//
// Model space convention (after normalisation):
//   x = right wing (starboard), y = forward (nose at +y), z = up.
//   The opaque airframe is exactly 1 unit long along y and centred on y = 0
//   (nose ≈ +0.5, tail ≈ -0.5), centred on x = 0, and z = 0 is the ground plane under the
//   landing gear (wheel bottoms touch z = 0), so an aircraft placed at airport elevation sits
//   on the apron.
//   `spanRatio` = full x extent / length (helicopters: main rotor diameter / length), so a
//   renderer honours a real span by scaling x by (spanM / lengthM) / spanRatio.
//
// Triangle soup (non-indexed): 9 floats per triangle in `positions` / `normals`, one material
// per triangle (all three vertices share it). Materials (`colorIndex`):
//   0 body (fuselage, livery body colour)   1 tail / livery colour (fin, winglets)
//   2 dark (glass, inlets, exhausts, skids) 3 engines (nacelles, light metallic grey)
//   4 rotor / propeller disc (translucent)  5 wing / stabiliser grey
// Translucent rotor/prop discs are always stored last: vertices [opaqueVertexCount, vertexCount).
// `disc` holds (u, v, blades) per vertex for rotor discs (u, v in -1..1 across the disc) and
// zeros elsewhere; the renderer draws spinning blades procedurally from it.
// `glass` / `cabin` describe where the fragment shader paints cockpit glass and cabin windows
// on body-coloured fuselage fragments (see the field docs).
//
// Moving parts are ordinary triangles flagged per vertex (`part`, `axis`):
//   PART_GEAR  retractable landing gear: rotates about `axis` through the pivot (the strut top)
//              by (1 - gear)·90° and collapses to the pivot when fully up.
//   PART_FLAP  trailing-edge flap panel: rotates about its hinge line (pivot + axis, axis points
//              outboard) by flaps·35° trailing edge down and slides aft by `slide` (Fowler).
//   PART_SLAT  leading-edge slat: droops about its upper-surface hinge and slides forward.
// Fixed gear (C172, PA-28) and helicopter skids are PART_RIGID and always visible.
// Mirrored parts carry mirrored pivots and pseudo-vector-mirrored axes, so the same signed
// angle produces the mirror-image motion on the left side.
//
// `lights` lists emissive light points (navigation, strobes, beacons, landing/taxi lights and
// their beam glows, logo lights) in model units, LIGHT_STRIDE floats each:
//   x, y, z, type (LIGHT_*), glow diameter in metres, base intensity, 0, 0.
// `anchors` repeats the main ones for the fragment shader's local light spill.

import type { ModelShape } from '@/data/sim/refTypes';

type V3 = [number, number, number];

export const MAT_BODY = 0;
export const MAT_TAIL = 1;
export const MAT_DARK = 2;
export const MAT_ENGINE = 3;
export const MAT_ROTOR = 4;
export const MAT_WING = 5;

export const PART_RIGID = 0;
export const PART_GEAR = 1;
export const PART_FLAP = 2;
export const PART_SLAT = 3;

export const LIGHT_NAV_L = 0;
export const LIGHT_NAV_R = 1;
export const LIGHT_TAIL = 2;
export const LIGHT_STROBE = 3;
export const LIGHT_BEACON = 4;
export const LIGHT_LANDING = 5;
export const LIGHT_BEAM = 6;
export const LIGHT_LOGO = 7;
export const LIGHT_STRIDE = 8;

/** Fragment-shader light spill anchors in model units; w = radius (0 = absent). */
export interface LightAnchors {
  navL: [number, number, number, number];
  navR: [number, number, number, number];
  beaconTop: [number, number, number, number];
  beaconBottom: [number, number, number, number];
  logo: [number, number, number, number];
}

export interface ModelMesh {
  shape: ModelShape;
  /** Level of detail: 0 full, 1 medium, 2 low (no gear / flap geometry; lights are identical). */
  lod: number;
  positions: Float32Array;
  normals: Float32Array;
  colorIndex: Uint8Array;
  /** (u, v, blades) per vertex for rotor discs, zeros otherwise. */
  disc: Float32Array;
  /** Per vertex: (PART_* kind, pivot x, y, z) in model units. */
  part: Float32Array;
  /** Per vertex: (axis x, y, z, slide in model units) for moving parts, zeros otherwise. */
  axis: Float32Array;
  spanRatio: number;
  vertexCount: number;
  /** Opaque vertices come first; [opaqueVertexCount, vertexCount) are translucent rotor discs. */
  opaqueVertexCount: number;
  triangleCount: number;
  gearVertexCount: number;
  flapVertexCount: number;
  slatVertexCount: number;
  /** Triangles of landing gear geometry (retractable or fixed). */
  gearTriangleCount: number;
  /** LIGHT_STRIDE floats per light point. */
  lights: Float32Array;
  lightCount: number;
  anchors: LightAnchors;
  /** Length in metres of the representative type the recipe was drawn for. */
  recipeLengthM: number;
  min: V3;
  max: V3;
  /**
   * Cockpit glass, in model units: [noseY, zRef, sMin, sMax, lo, hi, kLo, kHi].
   * With s = noseY - y and h = z - zRef a body fragment is glass when
   * sMin < s < sMax and lo + kLo·s < h < hi + kHi·s. null = none.
   */
  glass: Float32Array | null;
  /**
   * Cabin windows: [yStart, yEnd, pitch, zRow, halfHeight, zRow2, halfWidthFraction, _].
   * Windows repeat every `pitch` from yStart (front) back to yEnd; zRow2 is an upper-deck row
   * (NaN-free sentinel -99 when absent). null = none.
   */
  cabin: Float32Array | null;
}

// ------------------------------------------------------------------ vector helpers
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-15 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const rad = (deg: number) => (deg * Math.PI) / 180;
const ZERO: V3 = [0, 0, 0];

// Level of detail of the mesh being built: 0 full; 1 about half the tessellation; 2 about a
// quarter, without landing gear or separate flap / slat panels (models a few dozen px long).
let DETAIL = 0;
/** Tessellation count for the current level of detail (kept even so meshes stay symmetric). */
const q = (n: number, min = 4) => (DETAIL > 0 ? Math.max(min, 2 * Math.round(n / (DETAIL > 1 ? 8 : 4))) : n);

// ------------------------------------------------------------------ builder
/** kind, pivot xyz, axis xyz, slide (metres while building). */
type Part = [number, number, number, number, number, number, number, number];
const RIGID: Part = [0, 0, 0, 0, 0, 0, 0, 0];

class Buf {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  d: number[] = [];
  k: number[] = [];
  a: number[] = [];
  get count() {
    return this.c.length;
  }
  push(p: V3, n: V3, c: number, d: V3, part: Part = RIGID) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(c);
    this.d.push(d[0], d[1], d[2]);
    this.k.push(part[0], part[1], part[2], part[3]);
    this.a.push(part[4], part[5], part[6], part[7]);
  }
}

interface GearLeg {
  x: number; // wheel track position (≥ 0; > 0 legs are mirrored)
  d: number; // distance from the nose (m)
  top: number; // strut attach height (m, inside the airframe)
  topX?: number; // strut attach x when the leg is splayed (C172 spring legs)
  r: number; // wheel radius
  wheels?: number; // 1 or 2 side by side per axle
  axles?: number; // tandem axles (bogie)
  w?: number; // tyre width
  taxi?: boolean; // carries the taxi light (nose gear)
}

interface LightSpec {
  p: V3;
  type: number;
  size: number;
  k: number;
}

interface GlassSpec {
  /** Distances from the nose tip (metres) where the glass starts / ends. */
  s: [number, number];
  /** Lower edge height (metres, relative to the fuselage centre line z = 0) at s[0] / s[1]. */
  lo: [number, number];
  /** Upper edge height at s[0] / s[1]. */
  hi: [number, number];
}

interface CabinSpec {
  from: number; // distance from nose (m) of the first window
  to: number;
  pitch: number;
  z: number;
  halfH: number;
  z2?: number;
  halfW?: number; // fraction of pitch
}

interface Mark {
  s: number;
  c: number;
}

class Builder {
  solid = new Buf();
  clear = new Buf();
  glass: GlassSpec | null = null;
  cabin: CabinSpec | null = null;
  /** Current moving-part flag applied to every triangle added (RIGID by default). */
  part: Part = RIGID;
  gear: GearLeg[] = [];
  retract = true;
  gearTriangles = 0;
  lights: LightSpec[] = [];
  anchors: { navL?: V3; navR?: V3; beaconTop?: V3; beaconBottom?: V3; logo?: [V3, number] } = {};

  mark(): Mark {
    return { s: this.solid.count, c: this.clear.count };
  }

  tri(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, mat: number) {
    if (len(cross(sub(b, a), sub(c, a))) < 1e-9) return; // degenerate (e.g. at a lathe tip)
    this.solid.push(a, na, mat, ZERO, this.part);
    this.solid.push(b, nb, mat, ZERO, this.part);
    this.solid.push(c, nc, mat, ZERO, this.part);
  }

  light(p: V3, type: number, size: number, k = 1) {
    this.lights.push({ p, type, size, k });
  }

  /** Landing / taxi light: a bright core plus a soft beam of glows ahead of it, angled down. */
  landing(p: V3, size: number, beam = 1) {
    this.light(p, LIGHT_LANDING, size, 1);
    if (beam <= 0) return;
    const dir: V3 = [0, Math.cos(rad(5)), -Math.sin(rad(5))];
    // distance ahead (m), glow diameter (m), intensity: overlapping spots read as one cone
    const steps: [number, number, number][] = [
      [3.5, 4.5, 0.45],
      [8, 7.5, 0.34],
      [14, 11, 0.25],
      [22, 15, 0.17],
      [32, 20, 0.1],
    ];
    for (const [dist, sz, k] of steps) this.light(add(p, scl(dir, dist * beam)), LIGHT_BEAM, sz * beam, k);
  }

  /** Mirror everything added since `m` across the x = 0 plane. */
  mirror(m: Mark) {
    for (const [buf, from] of [
      [this.solid, m.s],
      [this.clear, m.c],
    ] as const) {
      const end = buf.count;
      for (let v = from; v < end; v++) {
        const p: V3 = [-buf.p[v * 3]!, buf.p[v * 3 + 1]!, buf.p[v * 3 + 2]!];
        const n: V3 = [-buf.n[v * 3]!, buf.n[v * 3 + 1]!, buf.n[v * 3 + 2]!];
        const d: V3 = [buf.d[v * 3]!, buf.d[v * 3 + 1]!, buf.d[v * 3 + 2]!];
        const k = buf.k;
        const a = buf.a;
        // pivot is a point (x flips); the rotation axis is a pseudo-vector: (x, -y, -z)
        const part: Part = [k[v * 4]!, -k[v * 4 + 1]!, k[v * 4 + 2]!, k[v * 4 + 3]!, a[v * 4]!, -a[v * 4 + 1]!, -a[v * 4 + 2]!, a[v * 4 + 3]!];
        buf.push(p, n, buf.c[v]!, d, part);
      }
    }
  }

  /**
   * A smooth surface from a grid of points: rows[i][j], j runs around a closed ring (closedU)
   * or along an open strip. Normals come from central differences and are oriented outwards
   * (away from each row's centroid) as a whole.
   */
  grid(rows: V3[][], closedU: boolean, mat: number | ((i: number, j: number, centroid: V3) => number)) {
    const nv = rows.length;
    const nu = rows[0]!.length;
    const P = (i: number, j: number): V3 => {
      const jj = closedU ? (j + nu) % nu : clamp(j, 0, nu - 1);
      return rows[clamp(i, 0, nv - 1)]![jj]!;
    };
    const N: V3[][] = [];
    for (let i = 0; i < nv; i++) {
      const row: V3[] = [];
      for (let j = 0; j < nu; j++) {
        const du = sub(P(i, j + 1), P(i, j - 1));
        const dv = sub(P(i + 1, j), P(i - 1, j));
        row.push(cross(du, dv));
      }
      N.push(row);
    }
    // degenerate normals (a ring collapsed to a point): average of the neighbouring ring
    for (let i = 0; i < nv; i++) {
      for (let j = 0; j < nu; j++) {
        if (len(N[i]![j]!) > 1e-10) continue;
        const k = i < nv - 1 ? i + 1 : i - 1;
        let acc: V3 = [0, 0, 0];
        for (let q = 0; q < nu; q++) if (len(N[k]![q]!) > 1e-10) acc = add(acc, norm(N[k]![q]!));
        N[i]![j] = acc;
      }
    }
    let orient = 0;
    for (let i = 0; i < nv; i++) {
      const row = rows[i]!;
      let c: V3 = [0, 0, 0];
      for (const p of row) c = add(c, p);
      c = scl(c, 1 / nu);
      for (let j = 0; j < nu; j++) orient += dot(norm(N[i]![j]!), sub(row[j]!, c));
    }
    const sign = orient < 0 ? -1 : 1;
    const NN = N.map((r) => r.map((n) => scl(norm(n), sign)));
    const ju = closedU ? nu : nu - 1;
    for (let i = 0; i < nv - 1; i++) {
      for (let j = 0; j < ju; j++) {
        const j1 = (j + 1) % nu;
        const a = rows[i]![j]!;
        const b = rows[i]![j1]!;
        const c = rows[i + 1]![j1]!;
        const d = rows[i + 1]![j]!;
        const m = typeof mat === 'number' ? mat : mat(i, j, scl(add(add(a, b), add(c, d)), 0.25));
        this.tri(a, b, c, NN[i]![j]!, NN[i]![j1]!, NN[i + 1]![j1]!, m);
        this.tri(a, c, d, NN[i]![j]!, NN[i + 1]![j1]!, NN[i + 1]![j]!, m);
      }
    }
  }

  /** Flat fan cap over a closed ring, normal oriented along `hint`. */
  cap(ring: V3[], hint: V3, mat: number) {
    let c: V3 = [0, 0, 0];
    for (const p of ring) c = add(c, p);
    c = scl(c, 1 / ring.length);
    // Newell normal
    let n: V3 = [0, 0, 0];
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j]!;
      const b = ring[(j + 1) % ring.length]!;
      n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    n = len(n) < 1e-12 ? norm(hint) : norm(n);
    if (dot(n, hint) < 0) n = scl(n, -1);
    for (let j = 0; j < ring.length; j++) this.tri(c, ring[j]!, ring[(j + 1) % ring.length]!, n, n, n, mat);
  }

  /** Translucent rotor / propeller disc: centre, two in-plane unit axes, radius. */
  disc(center: V3, u: V3, v: V3, r: number, blades: number, segsHi = 28) {
    const segs = q(segsHi, 10);
    const n = norm(cross(u, v));
    const ring: V3[] = [];
    const uv: [number, number][] = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const cu = Math.cos(a);
      const sv = Math.sin(a);
      ring.push(add(center, add(scl(u, cu * r), scl(v, sv * r))));
      uv.push([cu, sv]);
    }
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      this.clear.push(center, n, MAT_ROTOR, [0, 0, blades]);
      this.clear.push(ring[k]!, n, MAT_ROTOR, [uv[k]![0], uv[k]![1], blades]);
      this.clear.push(ring[k1]!, n, MAT_ROTOR, [uv[k1]![0], uv[k1]![1], blades]);
    }
  }
}

// ------------------------------------------------------------------ primitives
interface Station {
  y: number;
  w: number; // half width
  zm: number; // section centre height
  hh: number; // half height
}

function ringY(s: Station, cx: number, segs: number, exp: number): V3[] {
  const out: V3[] = [];
  const e = 2 / exp;
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2;
    out.push([cx + s.w * spow(Math.cos(a), e), s.y, s.zm + s.hh * spow(Math.sin(a), e)]);
  }
  return out;
}

/** Lathe along -y (stations ordered front to back). Returns the rings. */
function latheY(
  b: Builder,
  st: Station[],
  opts: { cx?: number; segs?: number; exp?: number; mat: number | ((i: number) => number); capFront?: number; capBack?: number },
): V3[][] {
  const segs = q(opts.segs ?? 12);
  const rows = st.map((s) => ringY(s, opts.cx ?? 0, segs, opts.exp ?? 2));
  const mat = opts.mat;
  b.grid(rows, true, typeof mat === 'number' ? mat : (i) => mat(i));
  if (opts.capFront !== undefined && st[0]!.w > 1e-6) b.cap(rows[0]!, [0, 1, 0], opts.capFront);
  if (opts.capBack !== undefined && st[st.length - 1]!.w > 1e-6) b.cap(rows[rows.length - 1]!, [0, -1, 0], opts.capBack);
  return rows;
}

/** Lathe around a vertical axis through (cx, cy): profile of [radius, z] from bottom to top. */
function latheZ(b: Builder, cx: number, cy: number, prof: [number, number][], segsHi: number, mat: (zMid: number) => number) {
  const segs = q(segsHi);
  const rows: V3[][] = prof.map(([r, z]) => {
    const ring: V3[] = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
    }
    return ring;
  });
  b.grid(rows, true, (_i, _j, c) => mat(c[2]));
}

/** Ellipsoid-ish pod along y: centre (cx, -dMid, zc), half length, half width/height. */
function pod(b: Builder, cx: number, d0: number, d1: number, zc: number, w: number, hh: number, mat: number, nHi = 9, exp = 2, segs = 12) {
  const n = DETAIL > 0 ? Math.max(4, Math.round(nHi / (DETAIL + 1))) : nHi;
  const st: Station[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.2)), 0.5);
    st.push({ y: -lerp(d0, d1, (t + 1) / 2), w: w * f, zm: zc, hh: hh * f });
  }
  latheY(b, st, { cx, segs, exp, mat });
}

interface PSec {
  le: V3;
  chord: number;
  t: number;
  tdir?: V3;
}

const AIRFOIL_M = 12;

/** NACA 4-digit half thickness at chord fraction c (0 = leading edge, 1 = trailing edge). */
const halfThick = (t: number, c: number) => 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);

/** Thickness direction of a section whose leading edge runs along `span`. */
function foilNormal(s: PSec, span: V3): V3 {
  let T = s.tdir ?? norm(cross([0, -1, 0], span));
  if (!s.tdir && (T[2] < -1e-6 || (Math.abs(T[2]) < 1e-6 && T[0] < 0))) T = scl(T, -1);
  return T;
}

/** Point on the aerofoil surface: side +1 upper, -1 lower. */
function foilPt(s: PSec, T: V3, c: number, side: number, camber: number): V3 {
  const off = (side * halfThick(s.t, c) + camber * 4 * c * (1 - c)) * s.chord;
  return add(add(s.le, [0, -c * s.chord, 0]), scl(T, off));
}

/**
 * Lofted aerofoil panel (wing, stabiliser, fin, pylon, strut) through its sections.
 * `cr` = [c0, c1] builds only that chordwise slice (a closed ring: upper c1→c0, lower c0→c1),
 * used to split a wing into slat / main box / flap.
 */
function panel(
  b: Builder,
  secs: PSec[],
  mat: number,
  opts: { camber?: number; capTip?: boolean; capRoot?: boolean; cr?: [number, number]; cm?: number } = {},
) {
  const n = secs.length;
  const camber = opts.camber ?? 0;
  const spanAt = (i: number) => norm(sub(secs[Math.min(i + 1, n - 1)]!.le, secs[Math.max(i - 1, 0)]!.le));
  const rows = secs.map((s, i) => {
    const T = foilNormal(s, spanAt(i));
    const ring: V3[] = [];
    if (opts.cr) {
      const [c0, c1] = opts.cr;
      const m = DETAIL > 0 ? Math.max(3, Math.round((opts.cm ?? 5) * 0.6)) : (opts.cm ?? 5);
      const cAt = (u: number) => lerp(c0, c1, (1 - Math.cos(Math.PI * u)) / 2);
      for (let k = 0; k < m; k++) ring.push(foilPt(s, T, cAt(1 - k / (m - 1)), 1, camber));
      for (let k = 0; k < m; k++) ring.push(foilPt(s, T, cAt(k / (m - 1)), -1, camber));
      return ring;
    }
    const M = DETAIL > 1 ? 6 : DETAIL > 0 ? 8 : AIRFOIL_M;
    for (let k = 0; k < M; k++) {
      const a = (k / M) * Math.PI * 2;
      const c = (1 + Math.cos(a)) / 2; // 1 at the trailing edge, 0 at the leading edge
      ring.push(foilPt(s, T, c, Math.sin(a) >= 0 ? 1 : -1, camber));
    }
    return ring;
  });
  b.grid(rows, true, mat);
  if (opts.capTip) b.cap(rows[n - 1]!, spanAt(n - 1), mat);
  if (opts.capRoot) b.cap(rows[0]!, scl(spanAt(0), -1), mat);
}

interface Device {
  from: number; // spanwise x range (m)
  to: number;
  c: number; // chord fraction of the hinge (flap: start of the flap; slat: end of the slat)
}

/**
 * A wing (right half) lofted through `sec(x)` at the given span stations, split into a fixed
 * box plus flagged trailing-edge flap and leading-edge slat panels where requested.
 */
function wingPanels(
  b: Builder,
  sec: (x: number) => PSec,
  stations: number[],
  mat: number,
  opts: { camber: number; capTip: boolean; flap?: Device | undefined; slat?: Device | undefined },
) {
  const x0 = stations[0]!;
  const x1 = stations[stations.length - 1]!;
  if (DETAIL > 1) opts = { camber: opts.camber, capTip: opts.capTip }; // no moving surfaces
  const cuts = new Set<number>(stations);
  for (const dv of [opts.flap, opts.slat]) {
    if (!dv) continue;
    cuts.add(clamp(dv.from, x0, x1));
    cuts.add(clamp(dv.to, x0, x1));
  }
  const xs = [...cuts].sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1]! > 1e-6);
  const inside = (dv: Device | undefined, xa: number, xb: number) => !!dv && xa >= dv.from - 1e-6 && xb <= dv.to + 1e-6;
  const camber = opts.camber;
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i]!;
    const xb = xs[i + 1]!;
    const last = i === xs.length - 2;
    const sa0 = sec(xa);
    const sb0 = sec(xb);
    const T = foilNormal(sa0, norm(sub(sb0.le, sa0.le)));
    const sa: PSec = { ...sa0, tdir: T };
    const sb: PSec = { ...sb0, tdir: T };
    const flap = inside(opts.flap, xa, xb) ? opts.flap! : null;
    const slat = inside(opts.slat, xa, xb) ? opts.slat! : null;
    const c0 = slat ? slat.c : 0;
    const c1 = flap ? flap.c : 1;
    if (c0 === 0 && c1 === 1) panel(b, [sa, sb], mat, { camber, capTip: last && opts.capTip });
    else panel(b, [sa, sb], mat, { camber, capTip: last && opts.capTip, cr: [c0, c1], cm: 6 });
    if (flap) {
      const ha = foilPt(sa, T, flap.c, -1, camber);
      const ax = norm(sub(foilPt(sb, T, flap.c, -1, camber), ha));
      b.part = [PART_FLAP, ha[0], ha[1], ha[2], ax[0], ax[1], ax[2], 0.1 * sa.chord];
      panel(b, [sa, sb], mat, { camber, capTip: true, capRoot: true, cr: [flap.c, 1], cm: 4 });
      b.part = RIGID;
    }
    if (slat) {
      const ha = foilPt(sa, T, slat.c, 1, camber);
      const ax = norm(sub(foilPt(sb, T, slat.c, 1, camber), ha));
      b.part = [PART_SLAT, ha[0], ha[1], ha[2], ax[0], ax[1], ax[2], 0.05 * sa.chord];
      panel(b, [sa, sb], mat, { camber, capTip: true, capRoot: true, cr: [0, slat.c], cm: 4 });
      b.part = RIGID;
    }
  }
}

/** Linear interpolation of lofting sections by their leading-edge x. */
function secLerp(secs: PSec[]): (x: number) => PSec {
  return (x) => {
    let i = 0;
    while (i < secs.length - 2 && x > secs[i + 1]!.le[0]) i++;
    const a = secs[i]!;
    const c = secs[i + 1]!;
    const t = clamp((x - a.le[0]) / (c.le[0] - a.le[0]), 0, 1);
    return { le: add(a.le, scl(sub(c.le, a.le), t)), chord: lerp(a.chord, c.chord, t), t: lerp(a.t, c.t, t) };
  };
}

/** Round tube between two points (gear struts, bogie beams). */
function tube(b: Builder, p0: V3, p1: V3, r: number, segsHi: number, mat: number) {
  const segs = q(segsHi);
  const ax = norm(sub(p1, p0));
  const ref: V3 = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = norm(cross(ax, ref));
  const v = cross(ax, u);
  const ring = (c: V3) => {
    const out: V3[] = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      out.push(add(c, add(scl(u, Math.cos(a) * r), scl(v, Math.sin(a) * r))));
    }
    return out;
  };
  b.grid([ring(p0), ring(p1)], true, mat);
}

const WHEEL_SEGS = () => q(8);

/** Tyre with flat hubs: axle along x, centre c, radius r, width w. */
function wheel(b: Builder, c: V3, r: number, w: number) {
  const segs = WHEEL_SEGS();
  const prof: [number, number][] = [
    [-w / 2, 0.74 * r],
    [0, r],
    [w / 2, 0.74 * r],
  ];
  const rows = prof.map(([dx, rr]) => {
    const ring: V3[] = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + Math.PI / segs;
      ring.push([c[0] + dx, c[1] + rr * Math.cos(a), c[2] + rr * Math.sin(a)]);
    }
    return ring;
  });
  b.grid(rows, true, MAT_DARK);
  b.cap(rows[0]!, [-1, 0, 0], MAT_ENGINE);
  b.cap(rows[2]!, [1, 0, 0], MAT_ENGINE);
}

// ------------------------------------------------------------------ profiles
type Profile = (d: number) => { w: number; zt: number; zb: number };

/** Monotone cubic (Fritsch–Carlson) interpolation through keys [x, y]. */
function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h: number[] = [];
  const del: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    del.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = del[0]!;
  m[n - 1] = del[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = del[i - 1]!;
    const c = del[i]!;
    if (a * c <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / a + w2 / c);
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / h[i]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!
    );
  };
}

function keyed(keys: [number, number, number, number][]): Profile {
  const xs = keys.map((k) => k[0]);
  const fw = pchip(xs, keys.map((k) => k[1]));
  const ft = pchip(xs, keys.map((k) => k[2]));
  const fb = pchip(xs, keys.map((k) => k[3]));
  return (d) => ({ w: Math.max(0, fw(d)), zt: ft(d), zb: fb(d) });
}

function fuselage(b: Builder, prof: Profile, ds: number[], opts: { segs?: number; exp?: number; capFront?: boolean } = {}) {
  const st: Station[] = ds.map((d) => {
    const p = prof(d);
    return { y: -d, w: p.w, zm: (p.zt + p.zb) / 2, hh: Math.max(0, (p.zt - p.zb) / 2) };
  });
  latheY(b, st, {
    segs: opts.segs ?? 16,
    exp: opts.exp ?? 2,
    mat: MAT_BODY,
    capBack: MAT_BODY,
    ...(opts.capFront ? { capFront: MAT_BODY } : {}),
  });
}

function samples(d0: number, d1: number, nHi: number, pow = 1): number[] {
  const n = DETAIL > 0 ? Math.max(3, Math.round(nHi * (DETAIL > 1 ? 0.3 : 0.45))) : nHi;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lerp(d0, d1, Math.pow(i / (n - 1), pow)));
  return out;
}

// ------------------------------------------------------------------ the parametric airliner
interface WingSpec {
  rootLE: number;
  rootChord: number;
  semi: number;
  sweep: number;
  tip: number;
  dihedral: number;
  z: number;
  t?: [number, number];
  kink?: number;
  winglet?: number;
}
interface TailSpec {
  rootLE: number;
  rootChord: number;
  semi: number;
  sweep: number;
  tip: number;
  dihedral?: number;
  dz?: number;
  tee?: boolean;
}
interface FinSpec {
  rootLE: number;
  rootChord: number;
  height: number;
  sweep: number;
  tip: number;
}
interface EngSpec {
  x: number;
  len: number;
  r: number;
  kind: 'jet' | 'prop';
  mount: 'under' | 'over' | 'rear' | 'fin';
  fwd?: number; // fraction of nacelle length ahead of the wing leading edge
  d?: number; // explicit front station (rear / fin mounts)
  prop?: { r: number; blades: number };
}
interface JetSpec {
  L: number;
  R: number;
  hTop?: number;
  hBot?: number;
  nose: number;
  tail: number;
  tailEndR?: number;
  tailTop?: number;
  noseDrop?: number;
  noseP?: number;
  hump?: [number, number, number, number, number]; // from, plateau start, plateau end, to, height (m)
  wing: WingSpec;
  htail: TailSpec;
  fin: FinSpec;
  engines: EngSpec[];
  fairing?: boolean;
  wingMat?: number;
  sponson?: { x: number; d0: number; d1: number; z: number; w: number; hh: number };
  glass?: GlassSpec | 'default';
  cabin?: CabinSpec;
  /** Tricycle gear: nose leg and right-hand / centre main legs (mount gives the strut top). */
  gear: {
    nose: { d: number; r: number; wheels?: number };
    mains: { x: number; d: number; r: number; wheels?: number; axles?: number; mount: 'wing' | 'body' | 'sponson' }[];
  };
  /** Trailing-edge flaps from the fuselage side to `flapTo` × semi-span (0 = none). */
  flapTo?: number;
  flapChord?: number;
  slats?: boolean;
  /** Tail-fin logo lights (airliners). */
  logo?: boolean;
}

function airlinerProfile(s: JetSpec): Profile {
  const R = s.R;
  const hT = (s.hTop ?? 1) * R;
  const hB = (s.hBot ?? 1) * R;
  const N = s.nose;
  const T = s.tail;
  const L = s.L;
  const z0 = -(s.noseDrop ?? 0.3) * R;
  const tEnd = s.tailEndR ?? 0.12;
  const tTop = (s.tailTop ?? 0.55) * R;
  const p = s.noseP ?? 0.5;
  const g = (u: number) => Math.pow(1 - Math.pow(1 - clamp(u, 0, 1), 2), p);
  const hump = (d: number) => (s.hump ? s.hump[4] * smooth(s.hump[0], s.hump[1], d) * (1 - smooth(s.hump[2], s.hump[3], d)) : 0);
  return (d) => {
    let w: number;
    let zt: number;
    let zb: number;
    if (d < N) {
      w = R * g(d / N);
      zt = z0 + (hT - z0) * g(d / N);
      zb = z0 - (hB + z0) * g(d / (N * 0.72));
    } else if (d > L - T) {
      const v = (d - (L - T)) / T;
      w = R * (1 - (1 - tEnd) * Math.pow(v, 1.5));
      zt = hT - (hT - tTop) * v * v;
      zb = -hB + (hB + (tTop - 2 * tEnd * R)) * Math.pow(v, 1.3);
    } else {
      w = R;
      zt = hT;
      zb = -hB;
    }
    return { w, zt: zt + hump(d), zb };
  };
}

function jetNacelle(b: Builder, cx: number, zc: number, front: number, l: number, r: number) {
  const k: [number, number][] = [
    [0, 0.84],
    [0.03, 0.95],
    [0.12, 1.0],
    [0.4, 0.99],
    [0.7, 0.88],
    [0.92, 0.72],
    [1.0, 0.66],
    [1.0, 0.5],
    [1.1, 0.32],
    [1.2, 0.05],
  ];
  const st = k.map(([d, f]) => ({ y: -(front + d * l), w: f * r, zm: zc, hh: f * r }));
  latheY(b, st, { cx, segs: 12, mat: (i) => (i >= 7 ? MAT_DARK : MAT_ENGINE), capFront: MAT_DARK });
}

function propNacelle(b: Builder, cx: number, zc: number, front: number, l: number, r: number, prop: { r: number; blades: number }, hScale = 1.15) {
  const k: [number, number][] = [
    [0, 0.0],
    [0.025, 0.3],
    [0.07, 0.48],
    [0.09, 0.62],
    [0.2, 0.92],
    [0.32, 1.0],
    [0.62, 0.95],
    [0.85, 0.62],
    [1.0, 0.22],
  ];
  const st = k.map(([d, f]) => ({ y: -(front + d * l), w: f * r, zm: zc, hh: f * r * (d > 0.08 ? hScale : 1) }));
  latheY(b, st, { cx, segs: 12, mat: (i) => (i < 3 ? MAT_DARK : MAT_ENGINE), capBack: MAT_ENGINE });
  b.disc([cx, -(front + 0.06 * l), zc], [1, 0, 0], [0, 0, 1], prop.r, prop.blades);
}

function jet(b: Builder, s: JetSpec) {
  const R = s.R;
  const prof = airlinerProfile(s);
  const WM = s.wingMat ?? MAT_WING;
  const zt = (d: number) => prof(d).zt;
  const zm = (d: number) => {
    const p = prof(d);
    return (p.zt + p.zb) / 2;
  };
  // ---- fuselage
  const nose = samples(0, s.nose, 12, 1.35);
  const cabin = samples(s.nose, s.L - s.tail, s.hump ? 12 : 5).slice(1, -1);
  const tail = samples(s.L - s.tail, s.L, 12, 0.9);
  fuselage(b, prof, [...nose, ...cabin, ...tail]);

  const w = s.wing;
  const tanS = Math.tan(rad(w.sweep));
  const tanD = Math.tan(rad(w.dihedral));
  const leD = (x: number) => w.rootLE + x * tanS;
  const wz = (x: number) => w.z + x * tanD;
  const kinkChord = w.kink !== undefined ? w.rootChord - w.kink * tanS : w.rootChord;
  const chordAt = (x: number) => {
    if (w.kink !== undefined && x <= w.kink) return w.rootChord - x * tanS;
    const x0 = w.kink ?? 0;
    return lerp(kinkChord, w.tip, (x - x0) / (w.semi - x0));
  };
  const t = w.t ?? [0.15, 0.105];

  // ---- right-hand side, mirrored afterwards
  const m = b.mark();
  const xs = w.kink !== undefined ? [0, w.kink, w.semi] : [0, w.semi];
  const side = 0.92 * R; // flaps start at the fuselage side
  const flapTo = (s.flapTo ?? 0.7) * w.semi;
  wingPanels(b, (x) => ({ le: [x, -leD(x), wz(x)] as V3, chord: chordAt(x), t: lerp(t[0], t[1], x / w.semi) }), xs, WM, {
    camber: 0.02,
    capTip: !w.winglet,
    flap: flapTo > side ? { from: side, to: flapTo, c: 1 - (s.flapChord ?? 0.27) } : undefined,
    slat: s.slats ? { from: side + 0.3 * R, to: w.semi * 0.97, c: 0.13 } : undefined,
  });
  if (w.winglet) {
    const h = w.winglet;
    const x = w.semi;
    const anhedral = w.dihedral < 0;
    panel(
      b,
      [
        { le: [x - 0.03, -leD(x) - 0.05 * w.tip, wz(x)], chord: w.tip * 0.95, t: 0.1 },
        { le: [x + h * 0.22, -(leD(x) + 0.35 * w.tip + h * 0.75), wz(x) + h * (anhedral ? 0.95 : 1)], chord: w.tip * 0.42, t: 0.09 },
      ],
      MAT_TAIL,
      { capTip: true },
    );
  }
  // horizontal tail (non T-tail here; T-tail after the fin)
  const ht = s.htail;
  const fin = s.fin;
  const finTanS = Math.tan(rad(fin.sweep));
  let finZ0 = Infinity;
  for (let k = 0; k <= 8; k++) finZ0 = Math.min(finZ0, zt(Math.min(s.L, fin.rootLE + (fin.rootChord * k) / 8)));
  finZ0 -= 0.06 * R;
  const centreEng = s.engines.find((e) => e.mount === 'fin');
  if (centreEng) finZ0 = zt(centreEng.d! + centreEng.len * 0.5) + 1.55 * centreEng.r;
  const htSecs = (z: number, le0: number): PSec[] => {
    const tS = Math.tan(rad(ht.sweep));
    const tD = Math.tan(rad(ht.dihedral ?? 0));
    return [
      { le: [0, -le0, z], chord: ht.rootChord, t: 0.11 },
      { le: [ht.semi, -(le0 + ht.semi * tS), z + ht.semi * tD], chord: ht.tip, t: 0.09 },
    ];
  };
  if (ht.tee) {
    const tipLE = fin.rootLE + fin.height * finTanS;
    panel(b, htSecs(finZ0 + fin.height - 0.04 * fin.tip, tipLE + Math.max(0, fin.tip - ht.rootChord) * 0.6), WM, { capTip: true });
  } else {
    panel(b, htSecs(zm(ht.rootLE + ht.rootChord * 0.4) + (ht.dz ?? 0), ht.rootLE), WM, { capTip: true });
  }

  // engines on the wing / rear fuselage
  for (const e of s.engines) {
    if (e.mount === 'fin') continue;
    if (e.mount === 'rear') {
      const front = e.d!;
      const cx = prof(front + e.len * 0.5).w + e.r + 0.3 * e.r;
      const zc = zm(front + e.len * 0.5) + 0.3 * R;
      jetNacelle(b, cx, zc, front, e.len, e.r);
      panel(
        b,
        [
          { le: [0.5 * R, -(front + 0.3 * e.len), zc], chord: 0.5 * e.len, t: 0.18 },
          { le: [cx - 0.6 * e.r, -(front + 0.3 * e.len), zc], chord: 0.5 * e.len, t: 0.18 },
        ],
        MAT_BODY,
      );
      continue;
    }
    const x = e.x;
    const cw = chordAt(x);
    const front = leD(x) - (e.fwd ?? 0.55) * e.len;
    if (e.kind === 'jet') {
      const zc = wz(x) - 0.05 * cw - 0.9 * e.r;
      jetNacelle(b, x, zc, front, e.len, e.r);
      panel(
        b,
        [
          { le: [x, -(front + 0.3 * e.len), zc + 0.6 * e.r], chord: 0.62 * e.len, t: 0.2 },
          { le: [x, -(leD(x) - 0.2 * e.len), wz(x)], chord: 0.2 * e.len + 0.7 * cw, t: 0.16 },
        ],
        WM,
      );
    } else {
      const zc = e.mount === 'under' ? wz(x) - 0.05 * cw - 0.3 * e.r : wz(x) + 0.35 * e.r;
      propNacelle(b, x, zc, front, e.len, e.r, e.prop ?? { r: e.r * 3, blades: 4 });
    }
  }
  if (s.sponson) {
    const sp = s.sponson;
    pod(b, sp.x, sp.d0, sp.d1, sp.z, sp.w, sp.hh, MAT_BODY, 9, 2.4);
  }
  b.mirror(m);

  // ---- centre parts
  panel(
    b,
    [
      { le: [0, -fin.rootLE, finZ0], chord: fin.rootChord, t: 0.12 },
      { le: [0, -(fin.rootLE + fin.height * finTanS), finZ0 + fin.height], chord: fin.tip, t: 0.1 },
    ],
    MAT_TAIL,
    { capTip: true },
  );
  if (centreEng) {
    const front = centreEng.d!;
    jetNacelle(b, 0, zt(front + centreEng.len * 0.5) + 0.75 * centreEng.r, front, centreEng.len, centreEng.r);
  }
  if (s.fairing) {
    pod(b, 0, w.rootLE - 0.15 * w.rootChord, w.rootLE + 1.2 * w.rootChord, w.z - 0.05 * R, 0.86 * R, 0.5 * R, MAT_BODY, 10, 2.2);
  }

  // ---- paint
  if (s.glass === 'default' || s.glass === undefined) {
    const N = s.nose;
    b.glass = { s: [0.11 * N, 0.6 * N], lo: [0.13 * R, 0.32 * R], hi: [0.5 * R, 0.62 * R] };
  } else b.glass = s.glass;
  if (s.cabin) b.cabin = s.cabin;

  // ---- landing gear (built once the ground height is known, see buildModelMesh)
  const g = s.gear;
  b.gear.push({ x: 0, d: g.nose.d, top: prof(g.nose.d).zb + 0.3 * R, r: g.nose.r, wheels: g.nose.wheels ?? 2, taxi: true });
  for (const mg of g.mains) {
    const top = mg.mount === 'wing' ? wz(mg.x) : mg.mount === 'sponson' ? (s.sponson?.z ?? prof(mg.d).zb + 0.3 * R) : prof(mg.d).zb + 0.3 * R;
    b.gear.push({ x: mg.x, d: mg.d, top, r: mg.r, wheels: mg.wheels ?? 2, axles: mg.axles ?? 1 });
  }

  // ---- lights
  const tipLE = leD(w.semi);
  const tipZ = wz(w.semi);
  const navR: V3 = [w.semi + 0.15, -(tipLE + 0.3 * w.tip), tipZ];
  const strR: V3 = [w.semi + 0.12, -(tipLE + 0.85 * w.tip), tipZ];
  b.light(navR, LIGHT_NAV_R, 2.6);
  b.light([-navR[0], navR[1], navR[2]], LIGHT_NAV_L, 2.6);
  b.light(strR, LIGHT_STROBE, 3.6);
  b.light([-strR[0], strR[1], strR[2]], LIGHT_STROBE, 3.6);
  b.anchors.navR = navR;
  b.anchors.navL = [-navR[0], navR[1], navR[2]];
  const tailP: V3 = [0, -(s.L + 0.12), zm(s.L - 0.05)];
  b.light(tailP, LIGHT_TAIL, 2.2);
  b.light(add(tailP, [0, -0.05, 0.12]), LIGHT_STROBE, 2.4, 0.7);
  const dTop = (w.rootLE + w.rootChord + fin.rootLE) / 2;
  const dBot = Math.max(s.nose * 1.2, w.rootLE - 0.45 * w.rootChord);
  const bTop: V3 = [0, -dTop, zt(dTop) + 0.18];
  const bBot: V3 = [0, -dBot, prof(dBot).zb - 0.18];
  b.light(bTop, LIGHT_BEACON, 2.8);
  b.light(bBot, LIGHT_BEACON, 2.8);
  b.anchors.beaconTop = bTop;
  b.anchors.beaconBottom = bBot;
  const lx = Math.min(1.3 * R, 0.3 * w.semi);
  const land: V3 = [lx, -leD(lx) + 0.12, wz(lx) - 0.1];
  b.landing(land, 2.4, 0);
  b.landing([-land[0], land[1], land[2]], 2.4, 0);
  if (s.logo) {
    const hf = 0.3;
    const zL = finZ0 + hf * fin.height;
    const chord = lerp(fin.rootChord, fin.tip, hf);
    const dL = fin.rootLE + hf * fin.height * finTanS + 0.45 * chord;
    const off = 0.06 * chord + 0.35;
    b.light([off, -dL, zL], LIGHT_LOGO, 0.55 * fin.height, 1);
    b.light([-off, -dL, zL], LIGHT_LOGO, 0.55 * fin.height, 1);
    b.anchors.logo = [[0, -(dL - 0.05 * chord), finZ0 + 0.12 * fin.height], 0.85 * fin.height];
  }
}

// ------------------------------------------------------------------ recipes
function narrow(b: Builder) {
  const R = 1.98;
  jet(b, {
    gear: { nose: { d: 5.1, r: 0.38 }, mains: [{ x: 3.8, d: 17.4, r: 0.58, mount: 'wing' }] },
    slats: true,
    logo: true,
    L: 37.6,
    R,
    hTop: 1.04,
    nose: 5.2,
    tail: 11.5,
    tailTop: 0.55,
    wing: { rootLE: 13.0, rootChord: 7.3, semi: 16.7, sweep: 27.5, tip: 1.55, dihedral: 5.1, z: -0.55 * R, kink: 6.3, winglet: 2.4 },
    htail: { rootLE: 31.0, rootChord: 3.9, semi: 6.2, sweep: 32, tip: 1.4, dihedral: 6 },
    fin: { rootLE: 27.6, rootChord: 6.0, height: 5.9, sweep: 36, tip: 1.9 },
    engines: [{ x: 5.75, len: 4.4, r: 1.02, kind: 'jet', mount: 'under', fwd: 0.6 }],
    fairing: true,
    cabin: { from: 6.5, to: 31.0, pitch: 0.53, z: 0.26 * R, halfH: 0.18 },
  });
}

function rearJet(b: Builder) {
  const R = 1.35;
  jet(b, {
    gear: { nose: { d: 2.7, r: 0.3 }, mains: [{ x: 2.0, d: 12.6, r: 0.45, mount: 'wing' }] },
    slats: true,
    logo: true,
    L: 26.8,
    R,
    nose: 3.9,
    noseP: 0.58,
    tail: 8.6,
    tailTop: 0.62,
    wing: { rootLE: 10.0, rootChord: 4.8, semi: 10.0, sweep: 26, tip: 1.25, dihedral: 3.5, z: -0.6 * R, kink: 3.0, winglet: 1.3 },
    htail: { rootLE: 0, rootChord: 2.3, semi: 4.2, sweep: 30, tip: 1.2, tee: true },
    fin: { rootLE: 20.4, rootChord: 4.9, height: 3.9, sweep: 42, tip: 2.8 },
    engines: [{ x: 0, len: 3.9, r: 0.68, kind: 'jet', mount: 'rear', d: 18.4 }],
    fairing: true,
    cabin: { from: 4.6, to: 18.0, pitch: 0.5, z: 0.2 * R, halfH: 0.15 },
  });
}

function wideTwin(b: Builder) {
  const R = 3.1;
  jet(b, {
    gear: { nose: { d: 7.0, r: 0.6 }, mains: [{ x: 5.6, d: 33.5, r: 0.62, axles: 3, mount: 'wing' }] },
    slats: true,
    logo: true,
    L: 63.7,
    R,
    hTop: 1.03,
    nose: 8.0,
    tail: 17.5,
    tailTop: 0.55,
    tailEndR: 0.1,
    wing: { rootLE: 22.5, rootChord: 13.2, semi: 30.4, sweep: 32, tip: 2.5, dihedral: 6, z: -0.55 * R, kink: 10.0, t: [0.14, 0.1] },
    htail: { rootLE: 54.5, rootChord: 7.2, semi: 10.7, sweep: 35, tip: 2.4, dihedral: 7 },
    fin: { rootLE: 50.0, rootChord: 11.0, height: 9.2, sweep: 42, tip: 3.5 },
    engines: [{ x: 9.7, len: 7.2, r: 1.92, kind: 'jet', mount: 'under', fwd: 0.55 }],
    fairing: true,
    cabin: { from: 9.0, to: 53.0, pitch: 0.53, z: 0.3 * R, halfH: 0.22 },
  });
}

function triJet(b: Builder) {
  const R = 3.0;
  jet(b, {
    gear: {
      nose: { d: 6.0, r: 0.55 },
      mains: [
        { x: 5.3, d: 31.0, r: 0.6, axles: 2, mount: 'wing' },
        { x: 0, d: 32.5, r: 0.55, mount: 'body' },
      ],
    },
    slats: true,
    logo: true,
    L: 61.6,
    R,
    nose: 7.2,
    tail: 15.5,
    tailTop: 0.62,
    tailEndR: 0.11,
    wing: { rootLE: 22.5, rootChord: 11.8, semi: 24.6, sweep: 37, tip: 2.6, dihedral: 6, z: -0.55 * R, kink: 8.5, winglet: 2.1 },
    htail: { rootLE: 53.6, rootChord: 6.6, semi: 9.1, sweep: 35, tip: 2.0, dihedral: 4 },
    fin: { rootLE: 51.8, rootChord: 8.4, height: 7.0, sweep: 42, tip: 3.6 },
    engines: [
      { x: 8.6, len: 6.8, r: 1.35, kind: 'jet', mount: 'under', fwd: 0.62 },
      { x: 0, len: 9.0, r: 1.35, kind: 'jet', mount: 'fin', d: 49.6 },
    ],
    fairing: true,
    cabin: { from: 8.5, to: 48.0, pitch: 0.53, z: 0.3 * R, halfH: 0.21 },
  });
}

function quad(b: Builder) {
  const R = 2.82;
  jet(b, {
    gear: {
      nose: { d: 6.5, r: 0.55 },
      mains: [
        { x: 5.4, d: 32.5, r: 0.62, axles: 2, mount: 'wing' },
        { x: 0, d: 33.5, r: 0.62, mount: 'body' },
      ],
    },
    slats: true,
    logo: true,
    L: 63.7,
    R,
    hTop: 1.03,
    nose: 7.6,
    tail: 16.5,
    tailTop: 0.58,
    tailEndR: 0.1,
    wing: { rootLE: 22.5, rootChord: 11.6, semi: 28.9, sweep: 32, tip: 2.4, dihedral: 6, z: -0.55 * R, kink: 9.0, winglet: 2.7, t: [0.14, 0.1] },
    htail: { rootLE: 54.8, rootChord: 6.6, semi: 9.6, sweep: 32, tip: 2.2, dihedral: 6 },
    fin: { rootLE: 50.6, rootChord: 10.0, height: 8.8, sweep: 42, tip: 3.4 },
    engines: [
      { x: 10.0, len: 5.0, r: 1.2, kind: 'jet', mount: 'under', fwd: 0.6 },
      { x: 19.4, len: 4.8, r: 1.15, kind: 'jet', mount: 'under', fwd: 0.6 },
    ],
    fairing: true,
    cabin: { from: 9.0, to: 53.0, pitch: 0.53, z: 0.3 * R, halfH: 0.2 },
  });
}

function b747(b: Builder) {
  const R = 3.25;
  jet(b, {
    gear: {
      nose: { d: 5.2, r: 0.6 },
      mains: [
        { x: 5.5, d: 34.0, r: 0.62, axles: 2, mount: 'wing' },
        { x: 1.9, d: 37.5, r: 0.62, axles: 2, mount: 'body' },
      ],
    },
    slats: true,
    logo: true,
    L: 70.7,
    R,
    hTop: 1.05,
    nose: 7.6,
    noseDrop: 0.34,
    tail: 18.5,
    tailTop: 0.55,
    tailEndR: 0.1,
    hump: [1.2, 10.5, 21.0, 33.0, 0.62 * R],
    wing: { rootLE: 24.0, rootChord: 15.5, semi: 30.4, sweep: 40, tip: 4.0, dihedral: 7, z: -0.55 * R, kink: 11.0, winglet: 1.9, t: [0.14, 0.1] },
    htail: { rootLE: 61.2, rootChord: 8.5, semi: 11.0, sweep: 38, tip: 2.6, dihedral: 7 },
    fin: { rootLE: 56.6, rootChord: 12.0, height: 10.0, sweep: 45, tip: 4.0 },
    engines: [
      { x: 11.9, len: 6.0, r: 1.36, kind: 'jet', mount: 'under', fwd: 0.66 },
      { x: 21.2, len: 6.0, r: 1.36, kind: 'jet', mount: 'under', fwd: 0.62 },
    ],
    fairing: true,
    glass: { s: [3.9, 6.3], lo: [0.62 * R, 0.86 * R], hi: [1.12 * R, 1.24 * R] },
    cabin: { from: 9.0, to: 57.0, pitch: 0.5, z: 0.3 * R, halfH: 0.21 },
  });
}

function a380(b: Builder) {
  const R = 3.57;
  jet(b, {
    gear: {
      nose: { d: 6.0, r: 0.63 },
      mains: [
        { x: 6.1, d: 35.5, r: 0.7, axles: 2, mount: 'wing' },
        { x: 2.1, d: 38.5, r: 0.7, axles: 3, mount: 'body' },
      ],
    },
    slats: true,
    logo: true,
    L: 72.7,
    R,
    hTop: 1.18,
    hBot: 1.18,
    nose: 8.6,
    noseDrop: 0.3,
    tail: 19.5,
    tailTop: 0.7,
    tailEndR: 0.1,
    wing: { rootLE: 23.0, rootChord: 17.8, semi: 38.4, sweep: 34, tip: 4.0, dihedral: 5.6, z: -0.72 * R, kink: 14.0, winglet: 1.6, t: [0.14, 0.1] },
    htail: { rootLE: 61.4, rootChord: 10.5, semi: 15.3, sweep: 36, tip: 3.0, dihedral: 6 },
    fin: { rootLE: 56.6, rootChord: 14.2, height: 11.0, sweep: 42, tip: 4.5 },
    engines: [
      { x: 15.4, len: 5.9, r: 1.5, kind: 'jet', mount: 'under', fwd: 0.6 },
      { x: 25.7, len: 5.9, r: 1.5, kind: 'jet', mount: 'under', fwd: 0.58 },
    ],
    fairing: true,
    glass: { s: [0.45, 5.3], lo: [-0.04 * R, 0.14 * R], hi: [0.3 * R, 0.42 * R] },
    cabin: { from: 9.5, to: 58.0, pitch: 0.53, z: -0.32 * R, halfH: 0.22, z2: 0.66 * R },
  });
}

function highTurboprop(b: Builder) {
  const R = 1.43;
  const prop = { r: 1.96, blades: 6 };
  jet(b, {
    gear: { nose: { d: 2.3, r: 0.33 }, mains: [{ x: 1.35, d: 13.0, r: 0.42, mount: 'sponson' }] },
    flapTo: 0.62,
    L: 27.2,
    R,
    nose: 3.4,
    noseP: 0.55,
    noseDrop: 0.28,
    tail: 9.6,
    tailTop: 0.78,
    tailEndR: 0.14,
    wing: { rootLE: 11.3, rootChord: 2.6, semi: 13.5, sweep: 2.5, tip: 1.45, dihedral: 1, z: 0.98 * R, t: [0.18, 0.13] },
    htail: { rootLE: 0, rootChord: 2.1, semi: 3.7, sweep: 8, tip: 1.4, tee: true },
    fin: { rootLE: 20.2, rootChord: 5.2, height: 4.3, sweep: 38, tip: 2.6 },
    engines: [{ x: 4.1, len: 5.6, r: 0.52, kind: 'prop', mount: 'under', fwd: 0.42, prop }],
    sponson: { x: 1.2, d0: 10.6, d1: 15.6, z: -0.95, w: 0.48, hh: 0.5 },
    cabin: { from: 5.5, to: 21.0, pitch: 0.76, z: 0.22 * R, halfH: 0.17 },
  });
}

function lowTurboprop(b: Builder) {
  const R = 0.78;
  const prop = { r: 1.32, blades: 4 };
  jet(b, {
    gear: { nose: { d: 1.7, r: 0.28, wheels: 1 }, mains: [{ x: 2.65, d: 6.6, r: 0.33, mount: 'wing' }] },
    flapTo: 0.62,
    L: 14.2,
    R,
    hTop: 1.06,
    nose: 2.9,
    noseP: 0.65,
    noseDrop: 0.22,
    tail: 5.2,
    tailTop: 0.62,
    tailEndR: 0.15,
    wing: { rootLE: 5.4, rootChord: 2.4, semi: 8.3, sweep: 3, tip: 1.0, dihedral: 6, z: -0.55 * R, winglet: 0.6, t: [0.16, 0.12] },
    htail: { rootLE: 0, rootChord: 1.35, semi: 2.75, sweep: 16, tip: 0.8, tee: true },
    fin: { rootLE: 10.3, rootChord: 2.7, height: 2.3, sweep: 42, tip: 1.5 },
    engines: [{ x: 2.65, len: 3.9, r: 0.42, kind: 'prop', mount: 'over', fwd: 0.55, prop }],
    glass: { s: [1.55, 3.35], lo: [0.1 * R, 0.35 * R], hi: [0.68 * R, 0.78 * R] },
    cabin: { from: 4.4, to: 8.6, pitch: 0.75, z: 0.2 * R, halfH: 0.15, halfW: 0.28 },
  });
}

function highQuadTurboprop(b: Builder) {
  const R = 2.2;
  const prop = { r: 2.05, blades: 6 };
  jet(b, {
    gear: { nose: { d: 2.6, r: 0.42 }, mains: [{ x: 1.85, d: 13.5, r: 0.6, wheels: 1, axles: 2, mount: 'sponson' }] },
    flapTo: 0.62,
    wingMat: MAT_BODY,
    L: 29.8,
    R,
    nose: 4.2,
    noseP: 0.42,
    noseDrop: 0.25,
    tail: 11.0,
    tailTop: 0.95,
    tailEndR: 0.2,
    wing: { rootLE: 11.2, rootChord: 4.9, semi: 20.2, sweep: 2, tip: 2.5, dihedral: 2, z: 1.0 * R, t: [0.18, 0.12] },
    htail: { rootLE: 25.0, rootChord: 3.9, semi: 6.6, sweep: 8, tip: 2.2, dz: 0.5 },
    fin: { rootLE: 21.2, rootChord: 6.6, height: 6.6, sweep: 30, tip: 3.0 },
    engines: [
      { x: 4.95, len: 6.0, r: 0.6, kind: 'prop', mount: 'under', fwd: 0.45, prop },
      { x: 9.95, len: 6.0, r: 0.6, kind: 'prop', mount: 'under', fwd: 0.45, prop },
    ],
    sponson: { x: 1.85, d0: 9.6, d1: 17.4, z: -1.55, w: 0.62, hh: 0.68 },
  });
}

function highJetQuad(b: Builder) {
  const R = 3.43;
  jet(b, {
    gear: { nose: { d: 4.6, r: 0.5 }, mains: [{ x: 2.9, d: 24.5, r: 0.6, axles: 3, mount: 'sponson' }] },
    slats: true,
    wingMat: MAT_BODY,
    L: 53.0,
    R,
    nose: 6.6,
    noseP: 0.48,
    noseDrop: 0.28,
    tail: 16.5,
    tailTop: 0.95,
    tailEndR: 0.16,
    wing: { rootLE: 19.5, rootChord: 10.5, semi: 25.6, sweep: 28, tip: 2.7, dihedral: -3, z: 1.0 * R, winglet: 2.8, t: [0.14, 0.11] },
    htail: { rootLE: 0, rootChord: 5.2, semi: 9.8, sweep: 30, tip: 2.4, tee: true },
    fin: { rootLE: 41.0, rootChord: 9.2, height: 8.4, sweep: 40, tip: 5.4 },
    engines: [
      { x: 7.8, len: 5.6, r: 1.15, kind: 'jet', mount: 'under', fwd: 0.6 },
      { x: 15.5, len: 5.6, r: 1.15, kind: 'jet', mount: 'under', fwd: 0.6 },
    ],
    sponson: { x: 2.9, d0: 18.5, d1: 31.0, z: -2.4, w: 1.05, hh: 1.15 },
  });
}

function awacs(b: Builder) {
  const R = 1.88;
  jet(b, {
    gear: { nose: { d: 4.8, r: 0.45 }, mains: [{ x: 3.4, d: 20.0, r: 0.55, axles: 2, mount: 'wing' }] },
    slats: true,
    wingMat: MAT_BODY,
    L: 46.6,
    R,
    hTop: 1.04,
    nose: 5.6,
    noseDrop: 0.32,
    tail: 13.0,
    tailTop: 0.58,
    tailEndR: 0.1,
    wing: { rootLE: 15.0, rootChord: 9.0, semi: 22.2, sweep: 37, tip: 2.3, dihedral: 7, z: -0.55 * R, kink: 7.0 },
    htail: { rootLE: 41.0, rootChord: 4.6, semi: 6.7, sweep: 36, tip: 1.6, dihedral: 7 },
    fin: { rootLE: 37.4, rootChord: 7.4, height: 6.0, sweep: 35, tip: 2.6 },
    engines: [
      { x: 7.9, len: 4.6, r: 0.72, kind: 'jet', mount: 'under', fwd: 0.8 },
      { x: 13.4, len: 4.6, r: 0.72, kind: 'jet', mount: 'under', fwd: 0.8 },
    ],
    fairing: true,
  });
  // rotodome on two struts above the rear fuselage
  const dc = 31.0;
  const zc = R + 3.3;
  const rd = 4.57;
  const hh = 0.92;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 10;
    prof.push([Math.max(0, rd * spow(Math.cos(a), 0.75)), zc + hh * spow(Math.sin(a), 0.75)]);
  }
  latheZ(b, 0, -dc, prof, 20, (z) => (Math.abs(z - zc) < 0.3 * hh ? MAT_DARK : MAT_BODY));
  const m = b.mark();
  panel(
    b,
    [
      { le: [0.3, -(dc - 1.2), 0.85 * R], chord: 2.4, t: 0.18 },
      { le: [0.9, -(dc - 1.0), zc - hh * 0.8], chord: 2.0, t: 0.18 },
    ],
    MAT_BODY,
  );
  b.mirror(m);
}

// ---- light aircraft
function gaCommon(
  b: Builder,
  o: {
    keys: [number, number, number, number][];
    L: number;
    wingSecs: PSec[];
    wingMat?: number;
    winglet?: number;
    htail: { le: number; chord: number; semi: number; sweep: number; tip: number; z?: number };
    fin: FinSpec;
    tee?: boolean;
    prop: { d: number; r: number; blades: number };
    spinner: [number, number];
    strut?: [V3, V3];
    /** Nose leg (strut top just inside the fuselage bottom) and right main leg (explicit top). */
    nose: { d: number; r: number };
    mains: { x: number; d: number; r: number; top: number; topX?: number };
    retract: boolean;
    flapTo: number;
  },
) {
  const prof = keyed(o.keys);
  const d0 = o.keys[0]![0];
  fuselage(b, prof, samples(d0, o.L, 30, 1.15), { exp: 2.6, capFront: true });
  const zm = (d: number) => {
    const p = prof(d);
    return (p.zt + p.zb) / 2;
  };
  // spinner
  const sp: Station[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    const r = o.spinner[1] * Math.pow(Math.sin((u * Math.PI) / 2), 0.8);
    sp.push({ y: -lerp(0, o.spinner[0], u), w: r, zm: zm(d0), hh: r });
  }
  latheY(b, sp, { segs: 10, mat: MAT_ENGINE });
  b.disc([0, -o.prop.d, zm(d0)], [1, 0, 0], [0, 0, 1], o.prop.r, o.prop.blades);

  const m = b.mark();
  const wingD = -o.wingSecs[0]!.le[1] + 0.5 * o.wingSecs[0]!.chord;
  const side = prof(wingD).w + 0.02;
  wingPanels(
    b,
    secLerp(o.wingSecs),
    o.wingSecs.map((s) => s.le[0]),
    o.wingMat ?? MAT_BODY,
    { camber: 0.025, capTip: !o.winglet, flap: o.flapTo > side ? { from: side, to: o.flapTo, c: 0.74 } : undefined },
  );
  if (o.winglet) {
    const tip = o.wingSecs[o.wingSecs.length - 1]!;
    panel(
      b,
      [
        { le: add(tip.le, [-0.02, 0, 0]), chord: tip.chord * 0.95, t: 0.1 },
        { le: add(tip.le, [o.winglet * 0.2, -(tip.chord * 0.4 + o.winglet * 0.6), o.winglet]), chord: tip.chord * 0.45, t: 0.09 },
      ],
      MAT_TAIL,
      { capTip: true },
    );
  }
  if (o.strut) panel(b, [{ le: o.strut[0], chord: 0.24, t: 0.3 }, { le: o.strut[1], chord: 0.24, t: 0.3 }], MAT_BODY);
  const h = o.htail;
  const ftS = Math.tan(rad(o.fin.sweep));
  const finZ0 = prof(o.fin.rootLE + o.fin.rootChord * 0.5).zt - 0.05;
  const hz = o.tee ? finZ0 + o.fin.height - 0.04 : (h.z ?? zm(h.le + h.chord * 0.4));
  const hle = o.tee ? o.fin.rootLE + o.fin.height * ftS + Math.max(0, o.fin.tip - h.chord) * 0.5 : h.le;
  panel(
    b,
    [
      { le: [0, -hle, hz], chord: h.chord, t: 0.1 },
      { le: [h.semi, -(hle + h.semi * Math.tan(rad(h.sweep))), hz], chord: h.tip, t: 0.09 },
    ],
    o.wingMat ?? MAT_BODY,
    { capTip: true },
  );
  b.mirror(m);
  panel(
    b,
    [
      { le: [0, -o.fin.rootLE, finZ0], chord: o.fin.rootChord, t: 0.11 },
      { le: [0, -(o.fin.rootLE + o.fin.height * ftS), finZ0 + o.fin.height], chord: o.fin.tip, t: 0.1 },
    ],
    MAT_TAIL,
    { capTip: true },
  );

  // gear: tricycle, fixed (rigid, always shown) or retractable
  b.retract = o.retract;
  b.gear.push({ x: 0, d: o.nose.d, top: prof(o.nose.d).zb + 0.15, r: o.nose.r, wheels: 1, w: 0.55 * o.nose.r, taxi: o.retract });
  b.gear.push({ x: o.mains.x, d: o.mains.d, top: o.mains.top, ...(o.mains.topX !== undefined ? { topX: o.mains.topX } : {}), r: o.mains.r, wheels: 1, w: 0.6 * o.mains.r });

  // lights: wingtip nav + strobes, white tail light, beacon on the fin tip, landing light in the cowl
  const tip = o.wingSecs[o.wingSecs.length - 1]!;
  const navR: V3 = [tip.le[0] + 0.08, tip.le[1] - 0.3 * tip.chord, tip.le[2]];
  const strR: V3 = [tip.le[0] + 0.06, tip.le[1] - 0.6 * tip.chord, tip.le[2]];
  b.light(navR, LIGHT_NAV_R, 1.7);
  b.light([-navR[0], navR[1], navR[2]], LIGHT_NAV_L, 1.7);
  b.light(strR, LIGHT_STROBE, 2.4);
  b.light([-strR[0], strR[1], strR[2]], LIGHT_STROBE, 2.4);
  b.anchors.navR = navR;
  b.anchors.navL = [-navR[0], navR[1], navR[2]];
  b.light([0, -(o.fin.rootLE + o.fin.rootChord + 0.06), finZ0 + 0.25], LIGHT_TAIL, 1.5);
  const bTop: V3 = [0, -(o.fin.rootLE + o.fin.height * ftS + 0.45 * o.fin.tip), finZ0 + o.fin.height + 0.1];
  b.light(bTop, LIGHT_BEACON, 1.9);
  b.anchors.beaconTop = bTop;
  if (!o.retract) b.landing([0, -(d0 + 0.15), zm(d0) - 0.32], 1.5, 0.6);
}

function singleHigh(b: Builder) {
  const dih = Math.tan(rad(1.7));
  const z = 0.97;
  gaCommon(b, {
    nose: { d: 1.0, r: 0.2 },
    mains: { x: 1.22, d: 3.55, r: 0.22, top: -0.38, topX: 0.42 },
    retract: false,
    flapTo: 2.6,
    L: 8.0,
    keys: [
      [0.4, 0.34, 0.3, -0.34],
      [0.9, 0.46, 0.42, -0.45],
      [1.6, 0.52, 0.56, -0.5],
      [2.1, 0.55, 0.86, -0.52],
      [2.6, 0.56, 0.98, -0.52],
      [3.5, 0.55, 0.98, -0.48],
      [4.3, 0.44, 0.82, -0.3],
      [5.5, 0.27, 0.6, -0.02],
      [7.0, 0.13, 0.48, 0.18],
      [8.0, 0.06, 0.45, 0.28],
    ],
    wingSecs: [
      { le: [0, -2.4, z], chord: 1.63, t: 0.15 },
      { le: [2.6, -2.4, z + 2.6 * dih], chord: 1.63, t: 0.15 },
      { le: [5.5, -2.55, z + 5.5 * dih], chord: 1.12, t: 0.12 },
    ],
    strut: [
      [0.5, -3.05, -0.36],
      [2.9, -2.85, z + 2.9 * dih - 0.06],
    ],
    htail: { le: 6.85, chord: 1.05, semi: 1.7, sweep: 6, tip: 0.75 },
    fin: { rootLE: 5.75, rootChord: 1.9, height: 1.45, sweep: 38, tip: 0.75 },
    prop: { d: 0.22, r: 0.95, blades: 2 },
    spinner: [0.42, 0.2],
  });
  b.glass = { s: [1.85, 4.05], lo: [0.3, 0.32], hi: [0.9, 0.9] };
}

function singleLow(b: Builder) {
  const dih = Math.tan(rad(6.5));
  const z = -0.32;
  gaCommon(b, {
    nose: { d: 0.95, r: 0.2 },
    mains: { x: 1.55, d: 2.95, r: 0.22, top: -0.2 },
    retract: false,
    flapTo: 2.7,
    L: 7.3,
    keys: [
      [0.4, 0.33, 0.25, -0.3],
      [1.0, 0.47, 0.35, -0.38],
      [1.6, 0.53, 0.46, -0.4],
      [2.15, 0.56, 0.75, -0.4],
      [2.7, 0.56, 0.86, -0.4],
      [3.5, 0.53, 0.82, -0.36],
      [4.3, 0.42, 0.65, -0.22],
      [5.6, 0.22, 0.45, 0.0],
      [7.3, 0.07, 0.32, 0.12],
    ],
    wingSecs: [
      { le: [0, -2.2, z], chord: 1.6, t: 0.15 },
      { le: [2.7, -2.2, z + 2.7 * dih], chord: 1.6, t: 0.15 },
      { le: [5.35, -2.4, z + 5.35 * dih], chord: 1.12, t: 0.12 },
    ],
    htail: { le: 6.25, chord: 0.8, semi: 1.8, sweep: 0, tip: 0.8 },
    fin: { rootLE: 5.4, rootChord: 1.45, height: 1.25, sweep: 42, tip: 0.6 },
    prop: { d: 0.2, r: 0.94, blades: 2 },
    spinner: [0.42, 0.19],
  });
  b.glass = { s: [1.7, 3.85], lo: [0.28, 0.3], hi: [0.78, 0.76] };
}

function singleTurboprop(b: Builder) {
  const dih = Math.tan(rad(6));
  const z = -0.42;
  gaCommon(b, {
    nose: { d: 1.9, r: 0.25 },
    mains: { x: 2.0, d: 6.4, r: 0.3, top: -0.22 },
    retract: true,
    flapTo: 4.7,
    L: 14.0,
    keys: [
      [0.6, 0.3, 0.22, -0.3],
      [1.5, 0.48, 0.38, -0.5],
      [3.0, 0.62, 0.56, -0.62],
      [3.8, 0.75, 0.94, -0.7],
      [4.6, 0.78, 1.0, -0.72],
      [8.0, 0.78, 1.0, -0.72],
      [9.6, 0.62, 0.9, -0.45],
      [11.8, 0.35, 0.72, 0.0],
      [14.0, 0.14, 0.6, 0.3],
    ],
    wingSecs: [
      { le: [0, -5.4, z], chord: 2.45, t: 0.16 },
      { le: [7.9, -5.62, z + 7.9 * dih], chord: 1.1, t: 0.12 },
    ],
    winglet: 0.75,
    htail: { le: 0, chord: 1.45, semi: 2.75, sweep: 20, tip: 0.8 },
    fin: { rootLE: 10.6, rootChord: 2.9, height: 2.4, sweep: 40, tip: 1.5 },
    tee: true,
    prop: { d: 0.4, r: 1.33, blades: 4 },
    spinner: [0.62, 0.27],
  });
  b.glass = { s: [3.0, 4.55], lo: [0.3, 0.45], hi: [0.86, 0.86] };
  b.cabin = { from: 5.5, to: 8.6, pitch: 0.85, z: 0.42, halfH: 0.2, halfW: 0.27 };
}

function heli(b: Builder) {
  const prof = keyed([
    [0.0, 0.0, -0.1, -0.1],
    [0.25, 0.45, 0.45, -0.55],
    [0.8, 0.7, 0.8, -0.72],
    [1.8, 0.8, 1.0, -0.75],
    [3.2, 0.82, 1.05, -0.72],
    [4.2, 0.7, 1.0, -0.5],
    [5.0, 0.36, 0.64, 0.0],
    [5.8, 0.21, 0.5, 0.18],
    [9.2, 0.15, 0.42, 0.2],
    [10.0, 0.15, 0.42, 0.2],
  ]);
  fuselage(b, prof, samples(0, 10.0, 32, 1.25), { exp: 2.2 });
  pod(b, 0, 1.6, 5.2, 1.0, 0.56, 0.36, MAT_BODY, 9, 2.4); // engine cowling
  // mast + hub
  latheZ(
    b,
    0,
    -3.0,
    [
      [0.0, 1.2],
      [0.13, 1.2],
      [0.13, 1.62],
      [0.3, 1.66],
      [0.3, 1.78],
      [0.0, 1.8],
    ],
    10,
    () => MAT_DARK,
  );
  b.disc([0, -3.0, 1.74], [1, 0, 0], [0, 1, 0], 5.1, 4, 32);
  // tail fin (up and a small ventral), horizontal stabiliser
  panel(
    b,
    [
      { le: [0, -9.0, 0.3], chord: 1.05, t: 0.12 },
      { le: [0, -(9.0 + 1.3 * Math.tan(rad(35))), 1.65], chord: 0.6, t: 0.1 },
    ],
    MAT_TAIL,
    { capTip: true },
  );
  panel(
    b,
    [
      { le: [0, -9.2, 0.3], chord: 0.8, t: 0.12 },
      { le: [0, -9.55, -0.35], chord: 0.45, t: 0.1 },
    ],
    MAT_TAIL,
    { capTip: true },
  );
  const m = b.mark();
  panel(
    b,
    [
      { le: [0, -7.5, 0.3], chord: 0.55, t: 0.12 },
      { le: [1.0, -7.55, 0.3], chord: 0.45, t: 0.1 },
    ],
    MAT_BODY,
    { capTip: true },
  );
  // skids and cross tubes
  const skid: Station[] = [];
  const skidPts: [number, number][] = [
    [0.4, -1.12],
    [0.7, -1.4],
    [1.0, -1.47],
    [4.4, -1.47],
  ];
  for (const [d, zz] of skidPts) skid.push({ y: -d, w: 0.055, zm: zz, hh: 0.055 });
  latheY(b, skid, { cx: 1.05, segs: 6, mat: MAT_DARK, capFront: MAT_DARK, capBack: MAT_DARK });
  for (const d of [1.4, 3.5]) {
    panel(
      b,
      [
        { le: [0.45, -d, -0.62], chord: 0.12, t: 0.6 },
        { le: [1.05, -d, -1.47], chord: 0.12, t: 0.6 },
      ],
      MAT_DARK,
    );
  }
  b.mirror(m);
  // tail rotor on the left side of the fin
  b.disc([-0.22, -9.75, 1.0], [0, 1, 0], [0, 0, 1], 0.95, 2, 20);
  b.glass = { s: [0.02, 2.5], lo: [-0.56, 0.02], hi: [0.95, 0.9] };
  // lights: nav + strobes on the stabiliser tips, tail light, beacons, landing light under the nose
  const navR: V3 = [1.08, -7.75, 0.3];
  b.light(navR, LIGHT_NAV_R, 1.6);
  b.light([-navR[0], navR[1], navR[2]], LIGHT_NAV_L, 1.6);
  b.light([1.08, -7.98, 0.3], LIGHT_STROBE, 2.2);
  b.light([-1.08, -7.98, 0.3], LIGHT_STROBE, 2.2);
  b.anchors.navR = navR;
  b.anchors.navL = [-navR[0], navR[1], navR[2]];
  b.light([0, -10.06, 0.42], LIGHT_TAIL, 1.4);
  const bTop: V3 = [0, -4.9, 1.42];
  const bBot: V3 = [0, -2.6, -0.86];
  b.light(bTop, LIGHT_BEACON, 1.9);
  b.light(bBot, LIGHT_BEACON, 1.9);
  b.anchors.beaconTop = bTop;
  b.anchors.beaconBottom = bBot;
  b.landing([0, -0.7, -0.62], 1.6, 0.6);
}

function glider(b: Builder) {
  const prof = keyed([
    [0.0, 0.0, -0.02, -0.02],
    [0.25, 0.17, 0.12, -0.2],
    [0.8, 0.29, 0.28, -0.34],
    [1.6, 0.31, 0.33, -0.36],
    [2.4, 0.28, 0.32, -0.3],
    [3.2, 0.15, 0.24, -0.1],
    [4.4, 0.08, 0.18, 0.0],
    [6.4, 0.055, 0.16, 0.05],
    [6.6, 0.03, 0.15, 0.08],
  ]);
  fuselage(b, prof, samples(0, 6.6, 30, 1.2), { segs: 14 });
  pod(b, 0, 0.42, 2.05, 0.21, 0.255, 0.26, MAT_DARK, 10, 2); // canopy
  const dih = Math.tan(rad(2.5));
  const z = 0.24;
  const m = b.mark();
  panel(
    b,
    [
      { le: [0, -1.85, z], chord: 0.95, t: 0.15 },
      { le: [3.0, -1.86, z + 3.0 * dih], chord: 0.82, t: 0.14 },
      { le: [6.2, -1.9, z + 6.2 * dih], chord: 0.55, t: 0.13 },
      { le: [7.5, -1.98, z + 7.5 * dih + 0.05], chord: 0.33, t: 0.12 },
    ],
    MAT_BODY,
    { camber: 0.03, capTip: true },
  );
  const finTop = 0.14 + 1.2;
  const finTipLE = 5.65 + 1.2 * Math.tan(rad(28));
  panel(
    b,
    [
      { le: [0, -(finTipLE + 0.02), finTop - 0.02], chord: 0.5, t: 0.1 },
      { le: [1.35, -(finTipLE + 0.1), finTop - 0.02], chord: 0.34, t: 0.09 },
    ],
    MAT_BODY,
    { capTip: true },
  );
  b.mirror(m);
  panel(
    b,
    [
      { le: [0, -5.65, 0.1], chord: 0.95, t: 0.11 },
      { le: [0, -finTipLE, finTop], chord: 0.55, t: 0.1 },
    ],
    MAT_TAIL,
    { capTip: true },
  );
  // single retractable main wheel, semi-recessed under the cockpit (no lights)
  b.gear.push({ x: 0, d: 2.15, top: prof(2.15).zb + 0.1, r: 0.19, wheels: 1, w: 0.12 });
}

function fighter(b: Builder) {
  const prof = keyed([
    [0.0, 0.0, -0.05, -0.05],
    [0.8, 0.2, 0.12, -0.2],
    [2.5, 0.42, 0.36, -0.42],
    [4.5, 0.58, 0.62, -0.58],
    [6.5, 0.85, 0.66, -0.6],
    [8.5, 1.3, 0.6, -0.62],
    [12.0, 1.4, 0.55, -0.6],
    [16.0, 1.3, 0.5, -0.55],
    [18.2, 1.12, 0.42, -0.45],
    [18.8, 1.08, 0.4, -0.42],
  ]);
  fuselage(b, prof, samples(0, 18.8, 32, 1.1), { exp: 2.5 });
  pod(b, 0, 3.2, 7.4, 0.48, 0.44, 0.52, MAT_DARK, 10, 2); // canopy
  const m = b.mark();
  // intakes and nozzles
  latheY(
    b,
    [
      { y: -5.6, w: 0.5, zm: -0.15, hh: 0.55 },
      { y: -6.0, w: 0.56, zm: -0.15, hh: 0.6 },
      { y: -8.5, w: 0.58, zm: -0.15, hh: 0.6 },
      { y: -11.5, w: 0.4, zm: -0.12, hh: 0.45 },
    ],
    { cx: 1.05, segs: 12, exp: 3, mat: MAT_BODY, capFront: MAT_DARK },
  );
  latheY(
    b,
    [
      { y: -17.6, w: 0.6, zm: -0.02, hh: 0.6 },
      { y: -18.9, w: 0.56, zm: -0.02, hh: 0.56 },
      { y: -19.7, w: 0.48, zm: -0.02, hh: 0.48 },
    ],
    { cx: 0.62, segs: 12, mat: MAT_ENGINE, capBack: MAT_DARK },
  );
  const tanS = Math.tan(rad(45));
  const dih = Math.tan(rad(-1.5));
  panel(
    b,
    [
      { le: [0, -7.6, 0], chord: 7.2, t: 0.05 },
      { le: [6.5, -(7.6 + 6.5 * tanS), 6.5 * dih], chord: 1.6, t: 0.04 },
    ],
    MAT_BODY,
    { capTip: true },
  );
  const hs = Math.tan(rad(48));
  panel(
    b,
    [
      { le: [0.6, -15.4, -0.05], chord: 3.6, t: 0.045 },
      { le: [4.3, -(15.4 + 3.7 * hs), -0.05], chord: 1.2, t: 0.04 },
    ],
    MAT_BODY,
    { capTip: true },
  );
  const cant = rad(14);
  const fh = 3.2;
  panel(
    b,
    [
      { le: [1.1, -14.0, 0.42], chord: 4.1, t: 0.05 },
      { le: [1.1 + fh * Math.sin(cant), -(14.0 + fh * Math.tan(rad(40))), 0.42 + fh * Math.cos(cant)], chord: 1.4, t: 0.045 },
    ],
    MAT_TAIL,
    { capTip: true },
  );
  b.mirror(m);
  b.glass = null;
  // tricycle gear: nose leg with the taxi light, mains under the intakes
  b.gear.push({ x: 0, d: 4.3, top: prof(4.3).zb + 0.25, r: 0.33, wheels: 1, w: 0.22, taxi: true });
  b.gear.push({ x: 1.35, d: 11.6, top: -0.55, r: 0.45, wheels: 1, w: 0.3 });
  const tipX = 6.5;
  const navR: V3 = [tipX + 0.1, -(7.6 + tipX * tanS + 0.6), tipX * dih];
  b.light(navR, LIGHT_NAV_R, 1.8);
  b.light([-navR[0], navR[1], navR[2]], LIGHT_NAV_L, 1.8);
  b.anchors.navR = navR;
  b.anchors.navL = [-navR[0], navR[1], navR[2]];
  b.light([0, -19.2, 0.62], LIGHT_TAIL, 1.5);
}

const RECIPES: Record<ModelShape, { build: (b: Builder) => void; clearance: number }> = {
  narrow: { build: narrow, clearance: 0.55 },
  'rear-jet': { build: rearJet, clearance: 0.75 },
  'wide-twin': { build: wideTwin, clearance: 0.75 },
  'tri-jet': { build: triJet, clearance: 0.8 },
  quad: { build: quad, clearance: 0.75 },
  b747: { build: b747, clearance: 0.8 },
  a380: { build: a380, clearance: 0.9 },
  'high-turboprop': { build: highTurboprop, clearance: 0.75 },
  'low-turboprop': { build: lowTurboprop, clearance: 0.62 },
  'high-quad-turboprop': { build: highQuadTurboprop, clearance: 0.6 },
  'high-jet-quad': { build: highJetQuad, clearance: 0.9 },
  'single-high': { build: singleHigh, clearance: 0.65 },
  'single-low': { build: singleLow, clearance: 0.68 },
  'single-turboprop': { build: singleTurboprop, clearance: 0.7 },
  heli: { build: heli, clearance: 0 },
  glider: { build: glider, clearance: 0.12 },
  fighter: { build: fighter, clearance: 1.5 },
  awacs: { build: awacs, clearance: 0.6 },
};

/** Every supported shape (one recipe per ModelShape). */
export const MODEL_SHAPES = Object.keys(RECIPES) as ModelShape[];

// ------------------------------------------------------------------ landing gear
/**
 * Struts, bogies and wheels for every leg, reaching down to `groundZ`. Legs with x > 0 are
 * mirrored. Main legs retract inwards (about the fore-aft axis), centre legs forwards.
 */
function buildGear(b: Builder, groundZ: number) {
  if (DETAIL > 1) return; // a pixel or two at that size
  const right = b.gear.filter((g) => g.x > 1e-6);
  const centre = b.gear.filter((g) => g.x <= 1e-6);
  const m = b.mark();
  for (const g of right) gearLeg(b, g, groundZ, false);
  b.mirror(m);
  for (const g of centre) gearLeg(b, g, groundZ, true);
  b.part = RIGID;
}

function gearLeg(b: Builder, g: GearLeg, groundZ: number, centre: boolean) {
  const r = g.r;
  const axles = g.axles ?? 1;
  const wheels = g.wheels ?? 1;
  const w = g.w ?? 0.72 * r;
  const axleZ = groundZ + r * Math.cos(Math.PI / WHEEL_SEGS()); // the tyre's flat bottom facet sits on the ground
  const sr = Math.max(0.045, 0.19 * r);
  const top: V3 = [g.topX ?? g.x, -g.d, Math.max(g.top, axleZ + 0.1)];
  const axis: V3 = centre ? [1, 0, 0] : [0, 1, 0];
  b.part = b.retract ? [PART_GEAR, top[0], top[1], top[2], axis[0], axis[1], axis[2], 0] : RIGID;
  const spacing = 2.3 * r;
  tube(b, top, [g.x, -g.d, axles > 1 ? axleZ + 0.2 * r : axleZ], sr, 6, MAT_ENGINE);
  if (axles > 1) {
    const half = (spacing * (axles - 1)) / 2 + 0.25 * r;
    tube(b, [g.x, -g.d + half, axleZ + 0.05 * r], [g.x, -g.d - half, axleZ + 0.05 * r], 0.17 * r, 6, MAT_ENGINE);
  }
  const off = wheels > 1 ? w * 0.5 + sr * 0.8 + 0.04 : 0;
  for (let a = 0; a < axles; a++) {
    const y = -g.d + (a - (axles - 1) / 2) * spacing;
    if (wheels > 1) {
      wheel(b, [g.x - off, y, axleZ], r, w);
      wheel(b, [g.x + off, y, axleZ], r, w);
    } else wheel(b, [g.x, y, axleZ], r, w);
  }
  if (g.taxi) {
    const p: V3 = [0, -g.d + sr + 0.1, lerp(top[2], axleZ, 0.55)];
    b.landing(p, Math.max(1.3, 3.2 * r), 1);
  }
  b.part = RIGID;
}

// ------------------------------------------------------------------ normalisation
function finish(shape: ModelShape, lod: number, b: Builder, groundZ: number): ModelMesh {
  const S = b.solid;
  const C = b.clear;
  const nS = S.count;
  const n = nS + C.count;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < nS; v++) {
    minY = Math.min(minY, S.p[v * 3 + 1]!);
    maxY = Math.max(maxY, S.p[v * 3 + 1]!);
  }
  const length = maxY - minY;
  const sc = 1 / length;
  const yMid = (maxY + minY) / 2;
  const zOff = -groundZ;
  const P = (q: V3): V3 => [q[0] * sc, (q[1] - yMid) * sc, (q[2] + zOff) * sc];
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colorIndex = new Uint8Array(n);
  const disc = new Float32Array(n * 3);
  const part = new Float32Array(n * 4);
  const axis = new Float32Array(n * 4);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  let gearV = 0;
  let flapV = 0;
  let slatV = 0;
  let o = 0;
  for (const buf of [S, C]) {
    for (let v = 0; v < buf.count; v++, o++) {
      const p = P([buf.p[v * 3]!, buf.p[v * 3 + 1]!, buf.p[v * 3 + 2]!]);
      const nn = norm([buf.n[v * 3]!, buf.n[v * 3 + 1]!, buf.n[v * 3 + 2]!]);
      for (let k = 0; k < 3; k++) {
        positions[o * 3 + k] = p[k]!;
        normals[o * 3 + k] = nn[k]!;
        disc[o * 3 + k] = buf.d[v * 3 + k]!;
        min[k] = Math.min(min[k]!, p[k]!);
        max[k] = Math.max(max[k]!, p[k]!);
      }
      colorIndex[o] = buf.c[v]!;
      const kind = buf.k[v * 4]!;
      if (kind !== PART_RIGID) {
        const pv = P([buf.k[v * 4 + 1]!, buf.k[v * 4 + 2]!, buf.k[v * 4 + 3]!]);
        part.set([kind, pv[0], pv[1], pv[2]], o * 4);
        axis.set([buf.a[v * 4]!, buf.a[v * 4 + 1]!, buf.a[v * 4 + 2]!, buf.a[v * 4 + 3]! * sc], o * 4);
        if (kind === PART_GEAR) gearV++;
        else if (kind === PART_FLAP) flapV++;
        else if (kind === PART_SLAT) slatV++;
      }
    }
  }
  const spanRatio = Math.max(Math.abs(min[0]), Math.abs(max[0])) * 2;
  const Y = (d: number) => (-d - yMid) * sc;
  const Z = (z: number) => (z + zOff) * sc;
  const lights = new Float32Array(b.lights.length * LIGHT_STRIDE);
  b.lights.forEach((l, i) => {
    const p = P(l.p);
    lights.set([p[0], p[1], p[2], l.type, l.size, l.k, 0, 0], i * LIGHT_STRIDE);
  });
  const anchor = (q: V3 | undefined, radiusM: number): [number, number, number, number] => {
    if (!q) return [0, 0, 0, 0];
    const p = P(q);
    return [p[0], p[1], p[2], radiusM * sc];
  };
  const anchors: LightAnchors = {
    navL: anchor(b.anchors.navL, 3.2),
    navR: anchor(b.anchors.navR, 3.2),
    beaconTop: anchor(b.anchors.beaconTop, 3.6),
    beaconBottom: anchor(b.anchors.beaconBottom, 3.6),
    logo: b.anchors.logo ? anchor(b.anchors.logo[0], b.anchors.logo[1]) : [0, 0, 0, 0],
  };
  let glass: Float32Array | null = null;
  if (b.glass) {
    const g = b.glass;
    const kLo = (g.lo[1] - g.lo[0]) / (g.s[1] - g.s[0]);
    const kHi = (g.hi[1] - g.hi[0]) / (g.s[1] - g.s[0]);
    glass = new Float32Array([Y(0), Z(0), g.s[0] * sc, g.s[1] * sc, (g.lo[0] - kLo * g.s[0]) * sc, (g.hi[0] - kHi * g.s[0]) * sc, kLo, kHi]);
  }
  let cabin: Float32Array | null = null;
  if (b.cabin) {
    const c = b.cabin;
    cabin = new Float32Array([Y(c.from), Y(c.to), c.pitch * sc, Z(c.z), c.halfH * sc, c.z2 !== undefined ? Z(c.z2) : -99, c.halfW ?? 0.22, 0]);
  }
  return {
    shape,
    lod,
    positions,
    normals,
    colorIndex,
    disc,
    part,
    axis,
    spanRatio,
    vertexCount: n,
    opaqueVertexCount: nS,
    triangleCount: n / 3,
    gearVertexCount: gearV,
    flapVertexCount: flapV,
    slatVertexCount: slatV,
    gearTriangleCount: b.gearTriangles,
    lights,
    lightCount: b.lights.length,
    anchors,
    recipeLengthM: length,
    min,
    max,
    glass,
    cabin,
  };
}

/** Builds (uncached) the mesh for a shape at a level of detail (0 full, 1 medium, 2 low). */
export function buildModelMesh(shape: ModelShape, lod = 0): ModelMesh {
  const level = Math.max(0, Math.min(2, Math.round(lod)));
  const r = RECIPES[shape] ?? RECIPES.narrow;
  const b = new Builder();
  DETAIL = level;
  try {
    r.build(b);
    // the ground sits `clearance` metres below the lowest point of the airframe
    let minZ = Infinity;
    for (let v = 0; v < b.solid.count; v++) minZ = Math.min(minZ, b.solid.p[v * 3 + 2]!);
    const groundZ = minZ - r.clearance;
    const before = b.solid.count;
    buildGear(b, groundZ);
    b.gearTriangles = (b.solid.count - before) / 3;
    return finish(shape, level, b, groundZ);
  } finally {
    DETAIL = 0;
  }
}

const cache = new Map<string, ModelMesh>();

/** Cached mesh for a shape and level of detail (unknown shapes fall back to 'narrow'). */
export function getModelMesh(shape: ModelShape, lod = 0): ModelMesh {
  const key = `${shape}|${Math.max(0, Math.min(2, Math.round(lod)))}`;
  let m = cache.get(key);
  if (!m) {
    m = buildModelMesh(RECIPES[shape] ? shape : 'narrow', lod);
    cache.set(key, m);
  }
  return m;
}
