// Procedural low-poly airport ground-service vehicles for the true-scale 3D model layer
// (models3d.ts, registered as extra shapes by vehicles3d.ts). Pure geometry, no WebGL.
//
// Every recipe is written in metres for a representative vehicle (dimensions from typical
// towbarless tugs, Mallaghan / Doll catering high-loaders, 30–40 m³ refuellers, hydrant
// dispensers, TLD-style passenger stairs, belt and container loaders, Cobus-type apron buses and
// Vestergaard-type de-icers) and normalised to the ModelMesh conventions of modelMeshes.ts:
//   x = right, y = forward (front of the vehicle at +y), z = up, unit length along y centred on
//   y = 0, z = 0 the ground under the wheels. `recipeLengthM` is the true length.
// Materials: body (livery colour 1), tail (livery colour 2 — stripes, curtains, tanks), dark
// glass, light metal, rubber, chassis grey and lamp lenses (MAT_* in modelMeshes.ts).
// Moving parts (driven by the instance's gear channel, 0 stowed … 1 fully raised):
//   catering — the box rides up on a pair of scissors (PART_LIFT / PART_SCISSOR*) and its
//              front platform slides out over the cab once clear of it;
//   de-icer  — the boom swings from stowed (along the truck, over the cab) up and out to the
//              right (PART_SWING); its basket is level in the raised pose.
// Light points: rotating amber beacons, head and tail lamps, the de-icer's spray particles and
// basket floodlight (LIGHT_* in modelMeshes.ts) — the spray always streams towards +x and
// down, so the de-icer works on an aircraft to its right.

import {
  LIGHT_AMBER,
  LIGHT_HEAD,
  LIGHT_REAR,
  LIGHT_SPRAY,
  LIGHT_STRIDE,
  LIGHT_WORK,
  MAT_AMBER,
  MAT_BODY,
  MAT_CHASSIS,
  MAT_DARK,
  MAT_ENGINE,
  MAT_LAMP,
  MAT_RED,
  MAT_RUBBER,
  MAT_TAIL,
  PART_LIFT,
  PART_SCISSOR,
  PART_SCISSOR_TOP,
  PART_SWING,
  type ModelMesh,
  type VehicleShape,
} from './modelMeshes';

type V3 = [number, number, number];
type P2 = [number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};
const rad = (d: number) => (d * Math.PI) / 180;
/** Rodrigues rotation of v about unit axis k by angle a. */
const arot = (v: V3, k: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c)));
};

/** Moving-part spec while building (metres). */
interface PartSpec {
  kind: number;
  piv: V3;
  axis: V3;
  /** lift height (m) or swing angle (rad) */
  w: number;
  /** lift: forward slide (m); scissor: sin of the stowed angle */
  prm: number;
  /** scissor arm length (m) */
  lb: number;
}

class VB {
  pos: number[] = [];
  nrm: number[] = [];
  mat: number[] = [];
  pid: number[] = [];
  parts: PartSpec[] = [];
  lights: number[] = [];
  private cur = -1;
  constructor(readonly lod: number) {}

  /** Tessellation for the level of detail. */
  seg(n: number) {
    return this.lod === 0 ? n : this.lod === 1 ? Math.max(6, Math.round(n * 0.6)) : Math.max(4, Math.round(n * 0.4));
  }
  get coarse() {
    return this.lod >= 2;
  }
  get fine() {
    return this.lod === 0;
  }
  setPart(p: PartSpec | null) {
    if (!p) {
      this.cur = -1;
      return;
    }
    this.parts.push(p);
    this.cur = this.parts.length - 1;
  }
  mark() {
    return this.mat.length;
  }
  /** Transforms the vertices added since `from` (positions and normals). */
  transform(from: number, fp: (p: V3) => V3, fn: (n: V3) => V3) {
    for (let v = from; v < this.mat.length; v++) {
      const p = fp([this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!]);
      const n = fn([this.nrm[v * 3]!, this.nrm[v * 3 + 1]!, this.nrm[v * 3 + 2]!]);
      for (let k = 0; k < 3; k++) {
        this.pos[v * 3 + k] = p[k]!;
        this.nrm[v * 3 + k] = n[k]!;
      }
    }
  }
  private v(p: V3, n: V3, m: number) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.mat.push(m);
    this.pid.push(this.cur);
  }
  tri(a: V3, b: V3, c: V3, n: V3, m: number) {
    this.v(a, n, m);
    this.v(b, n, m);
    this.v(c, n, m);
  }
  tri3(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, m: number) {
    this.v(a, na, m);
    this.v(b, nb, m);
    this.v(c, nc, m);
  }
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, m: number) {
    this.tri(a, b, c, n, m);
    this.tri(a, c, d, n, m);
  }
  fan(pts: V3[], n: V3, m: number) {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0]!, pts[i]!, pts[i + 1]!, n, m);
  }
  /** Vertical prism over a convex footprint (x, y), counter-clockwise from above. */
  prismZ(fp: P2[], z0: number, z1: number, m: number, top = m, bottom: number | null = m) {
    const n = fp.length;
    for (let i = 0; i < n; i++) {
      const a = fp[i]!;
      const b = fp[(i + 1) % n]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-9) continue;
      this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [(b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0], m);
    }
    this.fan(fp.map(([x, y]) => [x, y, z1] as V3), [0, 0, 1], top);
    if (bottom !== null) this.fan(fp.map(([x, y]) => [x, y, z0] as V3).reverse(), [0, 0, -1], bottom);
  }
  /** Prism across x of a convex side profile (y, z), counter-clockwise with y right and z up. */
  prismX(prof: P2[], x0: number, x1: number, m: number, cap = m) {
    const n = prof.length;
    for (let i = 0; i < n; i++) {
      const a = prof[i]!;
      const b = prof[(i + 1) % n]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-9) continue;
      this.quad([x0, a[0], a[1]], [x0, b[0], b[1]], [x1, b[0], b[1]], [x1, a[0], a[1]], [0, (b[1] - a[1]) / l, -(b[0] - a[0]) / l], m);
    }
    this.fan(prof.map(([y, z]) => [x1, y, z] as V3), [1, 0, 0], cap);
    this.fan(prof.map(([y, z]) => [x0, y, z] as V3), [-1, 0, 0], cap);
  }
  /** Prism along y of a convex cross-section (x, z), counter-clockwise with x right and z up. */
  prismY(prof: P2[], y0: number, y1: number, m: number, cap = m) {
    const n = prof.length;
    for (let i = 0; i < n; i++) {
      const a = prof[i]!;
      const b = prof[(i + 1) % n]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-9) continue;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [(b[1] - a[1]) / l, 0, -(b[0] - a[0]) / l], m);
    }
    this.fan(prof.map(([x, z]) => [x, y1, z] as V3), [0, 1, 0], cap);
    this.fan(prof.map(([x, z]) => [x, y0, z] as V3), [0, -1, 0], cap);
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: number, top = m) {
    this.prismZ(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      z0,
      z1,
      m,
      top,
    );
  }
  /** Rectangular beam between two points: w across (horizontal-ish), h in the `up` plane. */
  beam(p0: V3, p1: V3, w: number, h: number, m: number, up: V3 = [0, 0, 1]) {
    const d = norm(sub(p1, p0));
    let s = cross(d, up);
    if (len(s) < 1e-6) s = cross(d, [1, 0, 0]);
    s = norm(s);
    const u = cross(s, d);
    const c = (p: V3, i: number, j: number) => add(p, add(scl(s, (i * w) / 2), scl(u, (j * h) / 2)));
    const faces: [number, number, number, number, V3][] = [
      [1, -1, 1, 1, s],
      [-1, 1, -1, -1, scl(s, -1)],
      [1, 1, -1, 1, u],
      [-1, -1, 1, -1, scl(u, -1)],
    ];
    for (const [i0, j0, i1, j1, n] of faces) this.quad(c(p0, i0, j0), c(p1, i0, j0), c(p1, i1, j1), c(p0, i1, j1), n, m);
    this.quad(c(p1, -1, -1), c(p1, 1, -1), c(p1, 1, 1), c(p1, -1, 1), d, m);
    this.quad(c(p0, -1, -1), c(p0, -1, 1), c(p0, 1, 1), c(p0, 1, -1), scl(d, -1), m);
  }
  /** Round tube between two points (smooth), optionally capped. */
  tube(p0: V3, p1: V3, r: number, m: number, segsHi = 6, caps = false) {
    const segs = this.seg(segsHi);
    const d = norm(sub(p1, p0));
    let s = cross(d, [0, 0, 1]);
    if (len(s) < 1e-6) s = cross(d, [1, 0, 0]);
    s = norm(s);
    const u = cross(s, d);
    const ring: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      ring.push(add(scl(s, Math.cos(a)), scl(u, Math.sin(a))));
    }
    for (let k = 0; k < segs; k++) {
      const n0 = ring[k]!;
      const n1 = ring[(k + 1) % segs]!;
      const a0 = add(p0, scl(n0, r));
      const a1 = add(p0, scl(n1, r));
      const b0 = add(p1, scl(n0, r));
      const b1 = add(p1, scl(n1, r));
      this.tri3(a0, a1, b1, n0, n1, n1, m);
      this.tri3(a0, b1, b0, n0, n1, n0, m);
    }
    if (caps) {
      this.fan(ring.map((n) => add(p1, scl(n, r))), d, m);
      this.fan(ring.map((n) => add(p0, scl(n, r))).reverse(), scl(d, -1), m);
    }
  }
  /** Wheel with its axle along x at (x, y), resting on the ground; hub cap on the outer side. */
  wheel(x: number, y: number, r: number, w: number) {
    const segs = this.seg(14);
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const ring: P2[] = [];
    // a vertex at the very bottom so the tyre touches z = 0 exactly
    for (let k = 0; k < segs; k++) {
      const a = -Math.PI / 2 + (k / segs) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const P = (xx: number, c: P2, rr = r): V3 => [xx, y + rr * c[0], r + rr * c[1]];
    for (let k = 0; k < segs; k++) {
      const c0 = ring[k]!;
      const c1 = ring[(k + 1) % segs]!;
      const n0: V3 = [0, c0[0], c0[1]];
      const n1: V3 = [0, c1[0], c1[1]];
      this.tri3(P(x0, c0), P(x1, c0), P(x1, c1), n0, n0, n1, MAT_RUBBER);
      this.tri3(P(x0, c0), P(x1, c1), P(x0, c1), n0, n1, n1, MAT_RUBBER);
    }
    this.fan(ring.map((c) => P(x1, c)), [1, 0, 0], MAT_RUBBER);
    this.fan(ring.map((c) => P(x0, c)).reverse(), [-1, 0, 0], MAT_RUBBER);
    if (!this.coarse) {
      const out = x >= 0 ? x1 + 0.008 : x0 - 0.008;
      const hub = ring.map((c) => P(out, c, r * 0.58));
      this.fan(x >= 0 ? hub : hub.reverse(), [x >= 0 ? 1 : -1, 0, 0], MAT_ENGINE);
    }
  }
  light(p: V3, type: number, size: number, k = 1, seed = 0) {
    this.lights.push(p[0], p[1], p[2], type, size, k, seed, 0);
  }
}

// ------------------------------------------------------------------ shared parts

/**
 * A cab: side profile with a raked windscreen, glazed windscreen, side and (optionally) rear
 * windows. y0 = rear, y1 = front, zw = waist (bottom of the glass), z1 = roof.
 */
function cabin(b: VB, o: { x0: number; x1: number; y0: number; y1: number; z0: number; zw: number; z1: number; slope: number; mat?: number; rear?: boolean }) {
  const { x0, x1, y0, y1, z0, zw, z1, slope } = o;
  const m = o.mat ?? MAT_BODY;
  b.prismX(
    [
      [y0, z0],
      [y1, z0],
      [y1, zw],
      [y1 - slope, z1],
      [y0, z1],
    ],
    x0,
    x1,
    m,
  );
  const e = 0.012;
  const gTop = z1 - 0.1;
  const gBot = zw + 0.06;
  // windscreen on the raked face
  const nW = norm([0, z1 - zw, slope]);
  const at = (z: number): number => y1 - (slope * (z - zw)) / (z1 - zw);
  const wq = (x: number, z: number): V3 => add([x, at(z), z], scl(nW, e));
  b.quad(wq(x0 + 0.1, gBot), wq(x1 - 0.1, gBot), wq(x1 - 0.1, gTop), wq(x0 + 0.1, gTop), nW, MAT_DARK);
  // side windows (front edge follows the windscreen pillar)
  for (const [x, s] of [
    [x0 - e, -1],
    [x1 + e, 1],
  ] as const) {
    const pts: V3[] = [
      [x, y0 + 0.18, gBot],
      [x, at(gBot) - 0.12, gBot],
      [x, at(gTop) - 0.12, gTop],
      [x, y0 + 0.18, gTop],
    ];
    b.fan(s > 0 ? pts : pts.reverse(), [s, 0, 0], MAT_DARK);
  }
  if (o.rear) b.quad([x1 - 0.15, y0 - e, gBot + 0.05], [x0 + 0.15, y0 - e, gBot + 0.05], [x0 + 0.15, y0 - e, gTop], [x1 - 0.15, y0 - e, gTop], [0, -1, 0], MAT_DARK);
}

/** Rotating amber beacon on a small base, light point above. */
function beacon(b: VB, x: number, y: number, z: number) {
  b.box(x - 0.11, x + 0.11, y - 0.11, y + 0.11, z, z + 0.05, MAT_CHASSIS);
  b.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, z + 0.05, z + 0.2, MAT_AMBER);
  b.light([x, y, z + 0.14], LIGHT_AMBER, 1.15, 1);
}

/** A pair of headlamps on the front face y (lenses + light points). */
function headlamps(b: VB, y: number, xs: number, z: number, w = 0.22, h = 0.12) {
  for (const x of [-xs, xs]) {
    b.box(x - w / 2, x + w / 2, y - 0.01, y + 0.015, z - h / 2, z + h / 2, MAT_LAMP);
    b.light([x, y + 0.08, z], LIGHT_HEAD, 0.75, 1);
  }
}

/** A pair of tail lamps on the rear face y. */
function taillamps(b: VB, y: number, xs: number, z: number) {
  for (const x of [-xs, xs]) {
    b.box(x - 0.08, x + 0.08, y - 0.015, y + 0.01, z - 0.05, z + 0.05, MAT_RED);
    b.light([x, y - 0.06, z], LIGHT_REAR, 0.4, 1);
  }
}

/** Superellipse tank along y (front y0 > rear y1) with dished ends, smooth shading. */
function tank(b: VB, y0: number, y1: number, zc: number, hw: number, hh: number, m: number) {
  const segs = b.seg(16);
  const e = 2 / 2.6; // superellipse exponent 2.6: slightly boxy, like a refueller tank
  const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
  const sect: P2[] = [];
  const sn: P2[] = [];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    sect.push([spow(c, e), spow(s, e)]);
    // superellipse normal ∝ (|c|^(2-e) sign c / hw, ...) — approximated per axis
    sn.push([spow(c, 2 - e) / hw, spow(s, 2 - e) / hh]);
  }
  const st: [number, number, number][] = [
    // y, scale, axial normal weight
    [y0, 0.7, 0.85],
    [y0 - 0.1, 0.92, 0.45],
    [y0 - 0.28, 1, 0],
    [y1 + 0.28, 1, 0],
    [y1 + 0.1, 0.92, -0.45],
    [y1, 0.7, -0.85],
  ];
  const ringAt = (i: number) => sect.map(([cx, cz]) => [cx * hw * st[i]![1], st[i]![0], zc + cz * hh * st[i]![1]] as V3);
  const nAt = (i: number, k: number): V3 => {
    const [nx, nz] = sn[k]!;
    const ax = st[i]![2];
    const r = norm([nx, 0, nz]);
    return norm([r[0] * (1 - Math.abs(ax)), ax, r[2] * (1 - Math.abs(ax))]);
  };
  for (let i = 0; i < st.length - 1; i++) {
    const A = ringAt(i);
    const B = ringAt(i + 1);
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      b.tri3(A[k]!, B[k]!, B[k1]!, nAt(i, k), nAt(i + 1, k), nAt(i + 1, k1), m);
      b.tri3(A[k]!, B[k1]!, A[k1]!, nAt(i, k), nAt(i + 1, k1), nAt(i, k1), m);
    }
  }
  b.fan(ringAt(0), [0, 1, 0], m);
  b.fan(ringAt(st.length - 1).reverse(), [0, -1, 0], m);
}

// ------------------------------------------------------------------ recipes

/** Towbarless push-back tug (narrow-body size, 6.6 m; scaled up for wide-bodies). Nose wheel cradle at the rear (y ≈ -2). */
function tug(b: VB) {
  const hw = 1.5;
  b.prismX(
    [
      [-1.0, 0.3],
      [3.12, 0.3],
      [3.3, 0.5],
      [3.3, 1.0],
      [3.05, 1.16],
      [-1.0, 1.16],
    ],
    -hw,
    hw,
    MAT_BODY,
  );
  // the U-shaped cradle opening: two rear arms
  for (const [x0, x1] of [
    [-hw, -0.74],
    [0.74, hw],
  ] as const)
    b.prismX(
      [
        [-3.3, 0.28],
        [-1.0, 0.28],
        [-1.0, 1.02],
        [-3.12, 1.02],
        [-3.3, 0.86],
      ],
      x0,
      x1,
      MAT_BODY,
    );
  // nose-wheel cradle: lifting floor, pusher and clamp arms
  b.box(-0.74, 0.74, -3.0, -1.0, 0.1, 0.24, MAT_ENGINE);
  b.box(-0.74, 0.74, -1.18, -1.0, 0.24, 0.9, MAT_CHASSIS);
  if (!b.coarse) for (const x of [-0.72, 0.6]) b.box(x, x + 0.12, -2.9, -1.3, 0.24, 0.62, MAT_CHASSIS);
  // hazard band, bumpers, engine grille
  b.box(-hw - 0.01, hw + 0.01, -0.98, 3.1, 0.84, 0.98, MAT_TAIL);
  for (const [x0, x1] of [
    [-hw - 0.01, -0.73],
    [0.73, hw + 0.01],
  ] as const)
    b.box(x0, x1, -3.1, -1.0, 0.8, 0.92, MAT_TAIL);
  b.box(-hw + 0.08, hw - 0.08, 3.3, 3.44, 0.42, 0.86, MAT_RUBBER);
  for (const x of [-1.12, 1.12]) b.box(x - 0.36, x + 0.36, -3.4, -3.3, 0.4, 0.78, MAT_RUBBER);
  if (!b.coarse) b.box(0.15, 1.35, 1.4, 2.9, 1.16, 1.2, MAT_CHASSIS);
  // low operator cab, front left (passes under the aircraft's nose)
  cabin(b, { x0: -1.42, x1: -0.3, y0: 1.05, y1: 2.95, z0: 1.16, zw: 1.38, z1: 2.0, slope: 0.26, rear: true });
  b.box(-1.47, -0.25, 1.0, 3.0, 2.0, 2.07, MAT_BODY);
  for (const x of [-1.22, 1.22]) for (const y of [2.25, -0.3]) b.wheel(x, y, 0.43, 0.4);
  beacon(b, -0.86, 2.0, 2.07);
  headlamps(b, 3.3, 1.08, 0.94, 0.26, 0.12);
  taillamps(b, -3.4, 1.18, 0.7);
}

/** Baggage tractor (front at y = 0); returns the y of its tow hitch. */
function tractor(b: VB): number {
  b.prismX(
    [
      [-1.05, 0.38],
      [-0.05, 0.38],
      [0.0, 0.58],
      [0.0, 0.98],
      [-0.15, 1.06],
      [-1.05, 1.06],
    ],
    -0.72,
    0.72,
    MAT_BODY,
  );
  b.box(-0.72, 0.72, -2.85, -1.05, 0.38, 0.72, MAT_BODY);
  b.box(-0.78, 0.78, -2.85, -1.9, 0.72, 0.8, MAT_CHASSIS);
  b.box(-0.35, 0.35, -2.35, -1.9, 0.8, 1.15, MAT_CHASSIS);
  b.box(-0.35, 0.35, -2.5, -2.35, 0.8, 1.6, MAT_CHASSIS);
  for (const x of [-0.68, 0.68])
    for (const y of [-1.12, -2.78]) {
      if (b.coarse) b.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0.72, 1.97, MAT_CHASSIS);
      else b.tube([x, y, 0.72], [x, y, 1.97], 0.035, MAT_CHASSIS, 4);
    }
  b.box(-0.76, 0.76, -2.88, -1.0, 1.96, 2.04, MAT_BODY);
  b.quad([-0.62, -1.1, 1.1], [0.62, -1.1, 1.1], [0.62, -1.1, 1.9], [-0.62, -1.1, 1.9], [0, 1, 0], MAT_DARK);
  b.box(-0.7, 0.7, 0.0, 0.1, 0.4, 0.62, MAT_RUBBER);
  for (const x of [-0.62, 0.62]) {
    b.wheel(x, -0.5, 0.3, 0.26);
    b.wheel(x, -2.35, 0.33, 0.3);
  }
  headlamps(b, 0.0, 0.48, 0.82, 0.16, 0.1);
  taillamps(b, -2.85, 0.6, 0.62);
  beacon(b, 0, -1.9, 2.04);
  b.box(-0.06, 0.06, -3.1, -2.85, 0.4, 0.5, MAT_CHASSIS);
  return -3.1;
}

/** Covered baggage cart hitched at y = yh (curtains in the tail colour). Returns its rear hitch. */
function bagCart(b: VB, yh: number): number {
  const yf = yh - 0.7;
  const yr = yf - 2.6;
  b.box(-0.86, 0.86, yr, yf, 0.28, 0.44, MAT_CHASSIS);
  b.box(-0.82, 0.82, yr + 0.05, yf - 0.05, 0.44, 1.6, MAT_TAIL);
  b.box(-0.87, 0.87, yr, yf, 1.6, 1.68, MAT_ENGINE);
  if (!b.coarse) for (const x of [-0.85, 0.85]) for (const y of [yf - 0.03, yr + 0.03]) b.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0.44, 1.6, MAT_CHASSIS);
  if (b.coarse) b.box(-0.04, 0.04, yf, yh, 0.32, 0.4, MAT_CHASSIS);
  else b.tube([0, yh, 0.4], [0, yf, 0.36], 0.04, MAT_CHASSIS, 4);
  for (const x of [-0.7, 0.7]) for (const y of [yf - 0.45, yr + 0.45]) b.wheel(x, y, 0.2, 0.14);
  return yr - 0.05;
}

/** Container dolly with an LD3 unit load device (contoured side to +x). Returns its rear hitch. */
function uldDolly(b: VB, yh: number): number {
  const yf = yh - 0.7;
  const yr = yf - 2.3;
  b.box(-1.05, 1.05, yr, yf, 0.3, 0.5, MAT_CHASSIS);
  if (!b.coarse) for (const x of [-1.02, 1.02]) b.box(x - 0.03, x + 0.03, yr, yf, 0.5, 0.62, MAT_CHASSIS);
  const ox = -0.22; // centre the 2.01 m top width
  b.prismY(
    [
      [ox - 0.78, 0.5],
      [ox + 0.78, 0.5],
      [ox + 1.23, 1.0],
      [ox + 1.23, 2.13],
      [ox - 0.78, 2.13],
    ],
    yr + 0.38,
    yf - 0.39,
    MAT_ENGINE,
  );
  b.box(ox - 0.795, ox - 0.775, yr + 0.5, yf - 0.5, 0.6, 2.02, MAT_TAIL);
  if (b.coarse) b.box(-0.04, 0.04, yf, yh, 0.34, 0.42, MAT_CHASSIS);
  else b.tube([0, yh, 0.4], [0, yf, 0.38], 0.045, MAT_CHASSIS, 4);
  for (const x of [-0.82, 0.82]) for (const y of [yf - 0.4, yr + 0.4]) b.wheel(x, y, 0.21, 0.15);
  return yr - 0.05;
}

function baggageTrain(b: VB) {
  let y = tractor(b);
  for (let i = 0; i < 3; i++) y = bagCart(b, y);
}

function uldTrain(b: VB) {
  let y = tractor(b);
  for (let i = 0; i < 3; i++) y = uldDolly(b, y);
}

/** Belt loader (7.7 m): conveyor from 1.0 m at the rear up to a ~2.1 m hold sill at the front. */
function beltLoader(b: VB) {
  b.box(-0.95, 0.95, -3.7, 3.0, 0.28, 0.72, MAT_BODY);
  b.box(0.1, 0.95, -3.7, -1.5, 0.72, 1.18, MAT_BODY);
  b.box(-0.85, -0.25, -3.1, -2.6, 0.72, 1.12, MAT_CHASSIS);
  b.box(-0.85, -0.25, -3.25, -3.1, 0.72, 1.55, MAT_CHASSIS);
  if (b.fine) b.tube([-0.55, -2.25, 0.72], [-0.55, -2.45, 1.25], 0.03, MAT_CHASSIS, 4);
  const r0: V3 = [0, -3.4, 1.0];
  const f0: V3 = [0, 3.8, 2.05];
  for (const x of [-0.45, 0.45]) b.beam([x, r0[1], r0[2]], [x, f0[1], f0[2]], 0.1, 0.3, MAT_TAIL);
  const d = norm(sub(f0, r0));
  const up = norm([0, -d[2], d[1]]);
  b.quad([-0.4, r0[1], r0[2] + 0.1], [0.4, r0[1], r0[2] + 0.1], [0.4, f0[1], f0[2] + 0.1], [-0.4, f0[1], f0[2] + 0.1], up, MAT_RUBBER);
  b.beam([0, r0[1], r0[2] - 0.05], [0, f0[1], f0[2] - 0.05], 0.8, 0.1, MAT_CHASSIS);
  if (!b.coarse) {
    const zr = (y: number) => r0[2] + ((y - r0[1]) / (f0[1] - r0[1])) * (f0[2] - r0[2]);
    for (const x of [-0.5, 0.5]) {
      b.tube([x, -1.6, zr(-1.6) + 0.5], [x, 3.6, zr(3.6) + 0.5], 0.025, MAT_CHASSIS, 4);
      for (const y of [-1.6, 1.0, 3.6]) b.tube([x, y, zr(y)], [x, y, zr(y) + 0.5], 0.022, MAT_CHASSIS, 4);
    }
  }
  b.beam([0, -0.4, 0.72], [0, -0.2, 1.48], 0.25, 0.15, MAT_CHASSIS);
  b.beam([0, 2.4, 0.72], [0, 2.4, 1.86], 0.2, 0.15, MAT_CHASSIS);
  b.box(-0.45, 0.45, 3.8, 3.92, 1.92, 2.18, MAT_RUBBER);
  for (const x of [-0.82, 0.82]) {
    b.wheel(x, 2.2, 0.33, 0.26);
    b.wheel(x, -2.6, 0.33, 0.26);
  }
  if (b.coarse) b.box(0.77, 0.83, -3.53, -3.47, 1.18, 1.9, MAT_CHASSIS);
  else b.tube([0.8, -3.5, 1.18], [0.8, -3.5, 1.9], 0.03, MAT_CHASSIS, 4);
  beacon(b, 0.8, -3.5, 1.9);
  headlamps(b, 3.0, 0.7, 0.55, 0.16, 0.1);
  taillamps(b, -3.7, 0.75, 0.55);
}

/** Main-deck / lower-deck container loader (9.6 m), platform raised to a ~3 m wide-body hold sill. */
function containerLoader(b: VB) {
  b.box(-2.0, 2.0, -4.75, 4.0, 0.3, 0.72, MAT_BODY);
  b.box(-1.95, 1.95, -4.7, -0.7, 0.72, 0.92, MAT_ENGINE);
  if (!b.coarse) for (let y = -4.4; y < -0.8; y += 0.6) b.box(-1.8, 1.8, y, y + 0.08, 0.92, 0.95, MAT_CHASSIS);
  b.box(-1.95, 1.95, -0.55, 3.55, 2.82, 3.02, MAT_ENGINE);
  b.box(-1.35, 1.35, 3.55, 4.75, 2.88, 3.02, MAT_ENGINE);
  b.box(-1.35, 1.35, 4.75, 4.85, 2.8, 3.02, MAT_RUBBER);
  for (const x of [-1.6, 1.6]) {
    b.beam([x, -0.4, 0.75], [x, 3.4, 2.8], 0.14, 0.22, MAT_CHASSIS);
    b.beam([x + 0.15, 3.4, 0.75], [x + 0.15, -0.4, 2.8], 0.14, 0.22, MAT_CHASSIS);
  }
  if (!b.coarse) {
    for (const x of [-1.93, 1.93]) {
      b.tube([x, -0.5, 3.95], [x, 3.5, 3.95], 0.03, MAT_TAIL, 4);
      for (const y of [-0.5, 1.5, 3.5]) b.tube([x, y, 3.02], [x, y, 3.95], 0.028, MAT_TAIL, 4);
    }
  }
  cabin(b, { x0: -1.95, x1: -1.15, y0: 2.3, y1: 3.5, z0: 3.02, zw: 3.55, z1: 5.0, slope: 0.08, rear: true });
  for (const x of [-1.7, 1.7]) {
    b.wheel(x, 3.3, 0.32, 0.28);
    b.wheel(x, -3.9, 0.32, 0.28);
  }
  beacon(b, -1.55, 2.9, 5.0);
  headlamps(b, 4.0, 1.6, 0.55, 0.2, 0.1);
  taillamps(b, -4.75, 1.8, 0.55);
}

/** Catering high-loader (9.1 m): box on scissors, rises up to 4 m; platform slides out over the cab. */
function catering(b: VB) {
  const H = 4.0;
  const s0 = 0.06;
  const LB = 6.0;
  const c0 = Math.sqrt(1 - s0 * s0);
  const zArm = 1.27;
  const yP = -4.0;
  const zF = 1.72; // stowed box floor
  b.box(-0.5, 0.5, -4.45, 3.7, 0.55, 0.9, MAT_CHASSIS);
  cabin(b, { x0: -1.25, x1: 1.25, y0: 2.6, y1: 4.5, z0: 0.72, zw: 1.72, z1: 2.9, slope: 0.35, rear: true });
  b.box(-1.22, 1.22, 4.5, 4.62, 0.42, 0.8, MAT_RUBBER);
  if (!b.coarse) b.box(-0.75, 0.75, 4.5, 4.52, 0.9, 1.5, MAT_CHASSIS);
  b.box(-1.2, 1.2, -4.45, 2.4, 0.9, 1.15, MAT_ENGINE);
  for (const x of [-1.02, 1.02]) b.wheel(x, 3.55, 0.5, 0.32);
  for (const x of [-1.08, -0.76, 0.76, 1.08]) b.wheel(x, -2.3, 0.5, 0.28);
  // scissors: two X pairs, hinged at the rear
  for (const x of [-0.95, 0.83]) {
    b.setPart({ kind: PART_SCISSOR, piv: [x, yP, zArm], axis: [1, 0, 0], w: H, prm: s0, lb: LB });
    b.beam([x, yP, zArm], [x, yP + LB * c0, zArm + LB * s0], 0.1, 0.16, MAT_CHASSIS);
    b.setPart({ kind: PART_SCISSOR_TOP, piv: [x + 0.12, yP, zArm + LB * s0], axis: [-1, 0, 0], w: H, prm: s0, lb: LB });
    b.beam([x + 0.12, yP, zArm + LB * s0], [x + 0.12, yP + LB * c0, zArm], 0.1, 0.16, MAT_CHASSIS);
  }
  // the box
  b.setPart({ kind: PART_LIFT, piv: [0, 0, 0], axis: [1, 0, 0], w: H, prm: 0, lb: 0 });
  b.box(-1.25, 1.25, -4.45, 2.4, zF, zF + 2.55, MAT_BODY);
  b.box(-1.26, 1.26, -4.4, 2.35, zF + 0.35, zF + 0.62, MAT_TAIL);
  b.box(-0.55, 0.55, 2.4, 2.415, zF + 0.12, zF + 2.15, MAT_CHASSIS);
  b.box(-0.6, 0.6, -4.465, -4.45, zF + 0.12, zF + 2.2, MAT_CHASSIS);
  // front platform: slides 2.3 m forward once the box clears the cab
  b.setPart({ kind: PART_LIFT, piv: [0, 0, 0], axis: [1, 0, 0], w: H, prm: 2.3, lb: 0 });
  b.box(-1.15, 1.15, 0.3, 2.35, zF - 0.06, zF + 0.08, MAT_ENGINE);
  b.box(-1.1, 1.1, 2.35, 2.45, zF - 0.06, zF + 0.1, MAT_RUBBER);
  if (!b.coarse)
    for (const x of [-1.12, 1.12]) {
      b.tube([x, 0.4, zF + 1.05], [x, 2.3, zF + 1.05], 0.025, MAT_TAIL, 4);
      b.tube([x, 2.3, zF + 0.08], [x, 2.3, zF + 1.05], 0.025, MAT_TAIL, 4);
    }
  b.setPart(null);
  beacon(b, -0.8, 3.3, 2.9);
  beacon(b, 0.8, 3.3, 2.9);
  headlamps(b, 4.5, 0.95, 1.0);
  taillamps(b, -4.45, 1.1, 0.75);
}

/** Into-plane refueller (10.2 m, ~30 m³): cab-over chassis, superellipse tank, rear hose cabinet. */
function fuelBowser(b: VB) {
  b.box(-0.5, 0.5, -4.9, 4.2, 0.55, 0.95, MAT_CHASSIS);
  cabin(b, { x0: -1.27, x1: 1.27, y0: 3.3, y1: 5.1, z0: 0.8, zw: 1.78, z1: 3.0, slope: 0.25 });
  b.box(-1.24, 1.24, 5.1, 5.22, 0.45, 0.82, MAT_RUBBER);
  if (!b.coarse) b.box(-0.8, 0.8, 5.1, 5.12, 0.9, 1.55, MAT_CHASSIS);
  tank(b, 3.1, -4.4, 1.95, 1.25, 0.88, MAT_BODY);
  b.box(-1.255, 1.255, -4.15, 2.85, 1.78, 2.05, MAT_TAIL);
  if (!b.coarse) {
    b.box(-0.35, 0.35, -4.0, 2.6, 2.82, 2.88, MAT_ENGINE);
    for (const x of [-0.5, 0.5]) b.tube([x, -3.8, 2.85], [x, 2.4, 2.85], 0.025, MAT_ENGINE, 4);
    for (const x of [-1.18, 1.18]) b.box(x - 0.06, x + 0.06, -1.2, 2.0, 0.95, 1.4, MAT_ENGINE);
  }
  b.box(-1.25, 1.25, -5.1, -4.45, 0.9, 2.65, MAT_BODY);
  b.box(-1.05, 1.05, -5.115, -5.1, 1.0, 2.5, MAT_CHASSIS);
  for (const x of [-1.04, 1.04]) b.wheel(x, 3.9, 0.52, 0.32);
  for (const y of [-2.35, -3.65]) for (const x of [-1.1, -0.78, 0.78, 1.1]) b.wheel(x, y, 0.5, 0.28);
  beacon(b, 0, 4.2, 3.0);
  beacon(b, -0.9, -4.75, 2.65);
  headlamps(b, 5.1, 0.95, 1.05);
  taillamps(b, -5.1, 1.12, 0.75);
}

/** Hydrant dispenser (7.6 m): filter vessel, hose reels, raised work platform, hose to the pit. */
function hydrantDispenser(b: VB) {
  b.box(-0.5, 0.5, -3.75, 3.2, 0.55, 0.92, MAT_CHASSIS);
  cabin(b, { x0: -1.22, x1: 1.22, y0: 1.95, y1: 3.8, z0: 0.78, zw: 1.75, z1: 2.85, slope: 0.25 });
  b.box(-1.2, 1.2, 3.8, 3.92, 0.42, 0.8, MAT_RUBBER);
  b.box(-1.2, 1.2, -3.8, 1.8, 0.92, 1.25, MAT_BODY);
  b.box(-1.21, 1.21, -3.75, 1.75, 1.0, 1.18, MAT_TAIL);
  b.tube([0.6, 1.2, 1.25], [0.6, 1.2, 2.55], 0.36, MAT_ENGINE, 12, true);
  b.tube([-0.8, 0.55, 1.65], [0.25, 0.55, 1.65], 0.36, MAT_TAIL, 12, true);
  b.box(-1.15, 1.15, -3.7, -0.6, 2.55, 2.68, MAT_ENGINE);
  for (const x of [-1.0, 0.9]) {
    b.beam([x, -3.5, 1.25], [x, -0.8, 2.55], 0.1, 0.14, MAT_CHASSIS);
    b.beam([x + 0.1, -0.8, 1.25], [x + 0.1, -3.5, 2.55], 0.1, 0.14, MAT_CHASSIS);
  }
  if (!b.coarse) {
    for (const x of [-1.12, 1.12]) {
      b.tube([x, -3.65, 3.65], [x, -0.65, 3.65], 0.028, MAT_TAIL, 4);
      for (const y of [-3.65, -2.15, -0.65]) b.tube([x, y, 2.68], [x, y, 3.65], 0.026, MAT_TAIL, 4);
    }
    // hydrant hose down to the pit coupler beside the truck
    b.tube([1.15, -2.6, 1.1], [1.9, -3.0, 0.08], 0.055, MAT_CHASSIS, 5);
    b.tube([1.9, -3.0, 0.08], [3.0, -3.3, 0.08], 0.055, MAT_CHASSIS, 5);
    b.box(2.9, 3.25, -3.5, -3.1, 0.0, 0.22, MAT_ENGINE);
  }
  for (const x of [-1.0, 1.0]) b.wheel(x, 2.75, 0.47, 0.3);
  for (const x of [-1.06, -0.76, 0.76, 1.06]) b.wheel(x, -2.2, 0.47, 0.27);
  beacon(b, 0, 2.5, 2.85);
  headlamps(b, 3.8, 0.9, 1.0);
  taillamps(b, -3.8, 1.05, 0.75);
}

/** Self-propelled passenger stairs: platform at `hp` metres, overall length `lv`. */
function stairs(b: VB, hp: number, lv: number) {
  const yF = lv / 2;
  const yR = -lv / 2;
  b.box(-1.15, 1.15, yR, yF - 0.15, 0.32, 0.78, MAT_BODY);
  b.box(-1.0, 1.0, yR + 0.2, yF - 0.35, 0.16, 0.32, MAT_CHASSIS);
  cabin(b, { x0: 0.05, x1: 1.15, y0: yF - 1.5, y1: yF - 0.05, z0: 0.78, zw: 1.4, z1: 2.1, slope: 0.2, rear: true });
  const yB = yR + 0.35;
  const zB = 0.95;
  const yT = yF - 1.45;
  const rise = hp - zB;
  const run = yT - yB;
  const steps = Math.max(4, Math.round(rise / 0.19));
  if (b.coarse) b.beam([0, yB, zB - 0.05], [0, yT, hp - 0.1], 1.25, 0.18, MAT_ENGINE);
  else
    for (let i = 0; i < steps; i++) {
      const z = zB + (rise * (i + 1)) / steps;
      const y0 = yB + (run * i) / steps;
      b.box(-0.62, 0.62, y0, y0 + run / steps + 0.04, z - 0.07, z, MAT_ENGINE);
    }
  for (const x of [-0.68, 0.68]) b.beam([x, yB, zB - 0.25], [x, yT, hp - 0.22], 0.1, 0.36, MAT_TAIL);
  // A-frame under the flight and pillars under the platform
  for (const x of [-0.6, 0.6]) b.beam([x, yT - 2.2, 0.78], [x, yT - 0.5, hp - 0.4], 0.13, 0.13, MAT_CHASSIS);
  for (const x of [-0.7, 0.7]) b.beam([x, yF - 1.62, 0.78], [x, yF - 1.62, hp - 0.14], 0.14, 0.14, MAT_CHASSIS);
  b.box(-0.78, 0.78, yT - 0.02, yF + 0.05, hp - 0.14, hp, MAT_ENGINE);
  b.box(-0.78, 0.78, yF + 0.05, yF + 0.13, hp - 0.25, hp - 0.02, MAT_RUBBER);
  if (!b.coarse) {
    const rail = (y: number) => zB + ((y - yB) / run) * rise + 0.95;
    for (const x of [-0.72, 0.72]) {
      b.tube([x, yB + 0.4, rail(yB + 0.4)], [x, yT, hp + 0.95], 0.025, MAT_TAIL, 4);
      for (let y = yB + 0.4; y < yT; y += 1.5) b.tube([x, y, rail(y) - 0.95], [x, y, rail(y)], 0.022, MAT_TAIL, 4);
      b.tube([x, yT, hp + 0.95], [x, yF, hp + 0.95], 0.025, MAT_TAIL, 4);
    }
  }
  // canopy over the landing (posts at its four corners)
  const zc = hp + 2.15;
  for (const x of [-0.8, 0.8])
    for (const y of [yT - 0.3, yF]) {
      if (b.coarse) b.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, hp, zc, MAT_CHASSIS);
      else b.tube([x, y, hp], [x, y, zc], 0.03, MAT_CHASSIS, 4);
    }
  b.box(-0.88, 0.88, yT - 0.4, yF + 0.1, zc, zc + 0.1, MAT_BODY);
  if (!b.coarse) for (const x of [-0.86, 0.86]) b.box(x - 0.01, x + 0.01, yT - 0.35, yF + 0.05, hp + 1.35, zc, MAT_BODY);
  for (const x of [-0.95, 0.95]) {
    b.wheel(x, yF - 0.9, 0.4, 0.28);
    b.wheel(x, yR + 1.0, 0.4, 0.28);
  }
  if (b.fine) for (const x of [-1.05, 1.05]) for (const y of [yR + 0.25, yF - 0.3]) b.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.0, 0.32, MAT_CHASSIS);
  beacon(b, 0, yF - 0.6, zc + 0.1);
  headlamps(b, yF - 0.05, 0.85, 0.65, 0.16, 0.1);
  taillamps(b, yR, 0.95, 0.6);
}

/** Boom and basket geometry of the de-icer, in its raised pose (shared with the placement code). */
export const DEICE_BOOM = (() => {
  const piv: V3 = [0, -3.9, 3.35];
  const slew = rad(78);
  const el = rad(52);
  const dir: V3 = [Math.sin(slew) * Math.cos(el), Math.cos(slew) * Math.cos(el), Math.sin(el)];
  const tip = add(piv, scl(dir, 8.5));
  const basket = add(tip, [0.15, 0, 0]);
  return { piv, dir, tip, basket, nozzle: add(basket, [1.3, 0, 0.02]) };
})();
export const SPRAY_PARTICLES = 48;

/** De-icing truck (10 m): orange cab and boom, blue fluid tank, enclosed basket on a slewing boom. */
function deicer(b: VB) {
  b.box(-0.5, 0.5, -4.9, 4.2, 0.55, 0.92, MAT_CHASSIS);
  cabin(b, { x0: -1.27, x1: 1.27, y0: 3.15, y1: 5.0, z0: 0.8, zw: 1.8, z1: 3.05, slope: 0.3 });
  b.box(-1.24, 1.24, 5.0, 5.12, 0.45, 0.82, MAT_RUBBER);
  if (!b.coarse) b.box(-0.8, 0.8, 5.0, 5.02, 0.9, 1.55, MAT_CHASSIS);
  b.prismY(
    [
      [-1.25, 0.95],
      [1.25, 0.95],
      [1.25, 2.6],
      [1.02, 2.85],
      [-1.02, 2.85],
      [-1.25, 2.6],
    ],
    -3.0,
    2.95,
    MAT_TAIL,
  );
  b.box(-1.26, 1.26, -2.95, 2.9, 1.5, 1.72, MAT_BODY);
  b.box(-1.25, 1.25, -4.95, -3.05, 0.95, 2.6, MAT_BODY);
  b.tube([0, -3.9, 2.6], [0, -3.9, 3.2], 0.55, MAT_ENGINE, 12, true);
  // boom + basket, built raised and stored stowed (rotated back along the truck, over the cab)
  const { piv, dir, tip, basket: bc } = DEICE_BOOM;
  const ds = norm([0, 1, 0.025]);
  const k = norm(cross(ds, dir));
  const alpha = Math.acos(Math.max(-1, Math.min(1, dot(ds, dir))));
  const start = b.mark();
  b.setPart({ kind: PART_SWING, piv, axis: k, w: alpha, prm: 0, lb: 0 });
  b.beam(piv, add(piv, scl(dir, 5.4)), 0.5, 0.42, MAT_BODY);
  b.beam(add(piv, scl(dir, 4.8)), tip, 0.36, 0.3, MAT_BODY);
  if (!b.coarse) b.beam(add(piv, [0, 0.5, -0.5]), add(piv, scl(dir, 2.4)), 0.16, 0.16, MAT_ENGINE);
  b.box(bc[0] - 0.7, bc[0] + 0.7, bc[1] - 0.7, bc[1] + 0.7, bc[2] - 0.15, bc[2] + 0.45, MAT_BODY);
  b.box(bc[0] - 0.68, bc[0] + 0.68, bc[1] - 0.68, bc[1] + 0.68, bc[2] + 0.45, bc[2] + 1.3, MAT_DARK);
  b.box(bc[0] - 0.74, bc[0] + 0.74, bc[1] - 0.74, bc[1] + 0.74, bc[2] + 1.3, bc[2] + 1.45, MAT_BODY);
  b.tube(add(bc, [0.7, 0, 0.3]), add(bc, [1.28, 0, 0.04]), 0.06, MAT_ENGINE, 5);
  b.setPart(null);
  b.transform(
    start,
    (p) => add(piv, arot(sub(p, piv), k, -alpha)),
    (n) => arot(n, k, -alpha),
  );
  for (const x of [-1.04, 1.04]) b.wheel(x, 3.95, 0.52, 0.32);
  for (const x of [-1.1, -0.78, 0.78, 1.1]) b.wheel(x, -2.6, 0.5, 0.28);
  // lights: spray and floodlight at the raised basket (they only show with the boom up)
  for (let i = 0; i < SPRAY_PARTICLES; i++) b.light(DEICE_BOOM.nozzle, LIGHT_SPRAY, 1.4, 1, (i + 0.5) / SPRAY_PARTICLES);
  b.light(add(bc, [0.76, 0, 1.38]), LIGHT_WORK, 3.5, 1);
  beacon(b, -0.75, 4.1, 3.05);
  beacon(b, 0.75, 4.1, 3.05);
  beacon(b, -0.95, -4.7, 2.6);
  headlamps(b, 5.0, 0.95, 1.05);
  taillamps(b, -4.95, 1.1, 0.75);
}

/** Apron bus (13.6 m, Cobus-like): low floor, glazed all round, roof air-conditioning pods. */
function apronBus(b: VB) {
  const hl = 6.8;
  const hw = 1.5;
  const c = 0.32;
  const fp = (g: number): P2[] => [
    [-hw - g, -hl + c],
    [-hw + c, -hl - g],
    [hw - c, -hl - g],
    [hw + g, -hl + c],
    [hw + g, hl - c],
    [hw - c, hl + g],
    [-hw + c, hl + g],
    [-hw - g, hl - c],
  ];
  b.prismZ(fp(0), 0.3, 0.95, MAT_BODY);
  b.prismZ(fp(0.01), 0.62, 0.86, MAT_TAIL, MAT_TAIL, null);
  b.prismZ(fp(-0.01), 0.95, 2.72, MAT_DARK, MAT_DARK, null);
  b.prismZ(fp(0), 2.72, 3.0, MAT_BODY);
  // window pillars, and lighter door frames
  for (const s of [-1, 1])
    for (let y = -6.0; y <= 6.01; y += 2.0) {
      const x0 = s > 0 ? hw - 0.005 : -hw - 0.012;
      b.box(x0, x0 + 0.017, y - 0.08, y + 0.08, 0.95, 2.72, MAT_BODY);
    }
  b.box(-0.95, 0.95, -3.6, -1.2, 3.0, 3.26, MAT_ENGINE);
  b.box(-0.95, 0.95, 1.2, 3.6, 3.0, 3.26, MAT_ENGINE);
  b.box(-hw + 0.1, hw - 0.1, hl, hl + 0.09, 0.3, 0.55, MAT_RUBBER);
  b.box(-hw + 0.1, hw - 0.1, -hl - 0.09, -hl, 0.3, 0.55, MAT_RUBBER);
  for (const x of [-1.22, 1.22]) for (const y of [4.75, -4.75]) b.wheel(x, y, 0.45, 0.3);
  beacon(b, 0, 5.6, 3.0);
  headlamps(b, hl, 1.12, 0.65, 0.26, 0.12);
  taillamps(b, -hl, 1.2, 0.68);
}

// ------------------------------------------------------------------ catalogue

interface Recipe {
  build: (b: VB) => void;
  /** Working front point along y in recipe metres (platform tip, cradle, belt end …). */
  tipY?: number;
}

const RECIPES: Record<VehicleShape, Recipe> = {
  'veh-tug': { build: tug, tipY: -2.0 },
  'veh-baggage': { build: baggageTrain },
  'veh-uld': { build: uldTrain },
  'veh-belt': { build: beltLoader, tipY: 3.92 },
  'veh-cloader': { build: containerLoader, tipY: 4.85 },
  'veh-catering': { build: catering, tipY: 4.75 },
  'veh-fuel': { build: fuelBowser },
  'veh-hydrant': { build: hydrantDispenser },
  'veh-stairs': { build: (b) => stairs(b, 3.4, 7.4), tipY: 3.83 },
  'veh-stairs-hi': { build: (b) => stairs(b, 5.2, 9.4), tipY: 4.83 },
  'veh-deice': { build: deicer },
  'veh-bus': { build: apronBus },
};

export const VEHICLE_SHAPES = Object.keys(RECIPES) as VehicleShape[];

export interface VehicleInfo {
  /** True overall length (m) = the mesh's unit length. */
  lengthM: number;
  /** Width (m). */
  widthM: number;
  /** Working point (platform / belt tip, tug cradle) ahead of the mesh centre (m). */
  reach: number;
  /** Mesh centre in recipe coordinates (m along y). */
  centreY: number;
}

function finish(shape: VehicleShape, lod: number, b: VB): { mesh: ModelMesh; info: VehicleInfo } {
  const n = b.mat.length;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  for (let v = 0; v < n; v++) {
    const y = b.pos[v * 3 + 1]!;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    maxX = Math.max(maxX, Math.abs(b.pos[v * 3]!));
  }
  const L = maxY - minY;
  const sc = 1 / L;
  const ym = (maxY + minY) / 2;
  const P = (x: number, y: number, z: number): V3 => [x * sc, (y - ym) * sc, z * sc];
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colorIndex = new Uint8Array(n);
  const part = new Float32Array(n * 4);
  const axis = new Float32Array(n * 4);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) {
    const p = P(b.pos[v * 3]!, b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!);
    const nn = norm([b.nrm[v * 3]!, b.nrm[v * 3 + 1]!, b.nrm[v * 3 + 2]!]);
    for (let k = 0; k < 3; k++) {
      positions[v * 3 + k] = p[k]!;
      normals[v * 3 + k] = nn[k]!;
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
    colorIndex[v] = b.mat[v]!;
    const pi = b.pid[v]!;
    if (pi < 0) continue;
    const ps = b.parts[pi]!;
    const pv = P(ps.piv[0], ps.piv[1], ps.piv[2]);
    const u = norm(ps.axis);
    if (ps.kind === PART_LIFT) {
      part.set([PART_LIFT + Math.min(0.999, ps.prm * sc), pv[0], pv[1], pv[2]], v * 4);
      axis.set([1, 0, 0, ps.w * sc], v * 4);
    } else if (ps.kind === PART_SCISSOR || ps.kind === PART_SCISSOR_TOP) {
      part.set([ps.kind + ps.prm, pv[0], pv[1], pv[2]], v * 4);
      axis.set([u[0] * ps.lb * sc, u[1] * ps.lb * sc, u[2] * ps.lb * sc, ps.w * sc], v * 4);
    } else {
      part.set([ps.kind, pv[0], pv[1], pv[2]], v * 4);
      axis.set([u[0], u[1], u[2], ps.w], v * 4);
    }
  }
  const nl = b.lights.length / LIGHT_STRIDE;
  const lights = new Float32Array(b.lights.length);
  for (let i = 0; i < nl; i++) {
    const o = i * LIGHT_STRIDE;
    const p = P(b.lights[o]!, b.lights[o + 1]!, b.lights[o + 2]!);
    lights.set([p[0], p[1], p[2], b.lights[o + 3]!, b.lights[o + 4]!, b.lights[o + 5]!, b.lights[o + 6]!, 0], o);
  }
  const zero: [number, number, number, number] = [0, 0, 0, 0];
  const mesh: ModelMesh = {
    shape,
    lod,
    positions,
    normals,
    colorIndex,
    disc: new Float32Array(n * 3),
    part,
    axis,
    spanRatio: maxX * 2 * sc,
    vertexCount: n,
    opaqueVertexCount: n,
    triangleCount: n / 3,
    gearVertexCount: 0,
    flapVertexCount: 0,
    slatVertexCount: 0,
    gearTriangleCount: 0,
    lights,
    lightCount: nl,
    anchors: { navL: zero, navR: zero, beaconTop: zero, beaconBottom: zero, logo: zero },
    recipeLengthM: L,
    min,
    max,
    glass: null,
    cabin: null,
  };
  const tip = RECIPES[shape].tipY;
  return { mesh, info: { lengthM: L, widthM: maxX * 2, reach: tip !== undefined ? tip - ym : maxY - ym, centreY: ym } };
}

/** Builds (uncached) a vehicle mesh at a level of detail (0 full, 1 medium, 2 low). */
export function buildVehicleMesh(shape: VehicleShape, lod = 0): ModelMesh {
  const level = Math.max(0, Math.min(2, Math.round(lod)));
  const b = new VB(level);
  (RECIPES[shape] ?? RECIPES['veh-tug']).build(b);
  return finish(shape, level, b).mesh;
}

const cache = new Map<string, ModelMesh>();
const infos = new Map<VehicleShape, VehicleInfo>();

/** Cached vehicle mesh (unknown shapes fall back to the tug). */
export function getVehicleMesh(shape: string, lod = 0): ModelMesh {
  const s = (RECIPES[shape as VehicleShape] ? shape : 'veh-tug') as VehicleShape;
  const key = `${s}|${Math.max(0, Math.min(2, Math.round(lod)))}`;
  let m = cache.get(key);
  if (!m) {
    m = buildVehicleMesh(s, lod);
    cache.set(key, m);
  }
  return m;
}

/** True dimensions and working point of a vehicle (from its full-detail recipe). */
export function vehicleInfo(shape: VehicleShape): VehicleInfo {
  let i = infos.get(shape);
  if (!i) {
    const b = new VB(0);
    RECIPES[shape].build(b);
    i = finish(shape, 0, b).info;
    infos.set(shape, i);
  }
  return i;
}
