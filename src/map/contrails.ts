// Contrails: white condensation trails behind simulated jets cruising in cold air.
//
// A small WebGL2 custom layer draws each trail as a camera-facing ribbon at the aircraft's
// real altitude (the same height its 3D model is drawn at), so trails line up with the models
// in the chase view and still read as thin white lines from far above. Trails form a little
// behind the engines, spread and fade out over up to two minutes of simulated time. Twin jets
// leave two trails and four-engined jets four when seen close up; one line when zoomed out.
//
// Formation is simplified (Schmidt–Appleman-style threshold: high and colder than about −40 °C,
// with a smooth "humidity" field deciding how long trails persist). It is a visual effect of
// the simulation, not an observation.

import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import { specOf } from '@/data/sim/typeSpecs';
import { simElevationFt, simNow } from '@/data/world';
import { getSettings } from '@/state/settings';
import { traffic, type Track } from '@/state/traffic';
import { ui } from '@/state/ui';
import { solarElevation, subsolarPoint } from './extraOverlays';

export const CONTRAIL_MIN_ZOOM = 5.5;
export const MAX_CONTRAIL_AIRCRAFT = 300;
const SAMPLE_SIM_MS = 2000; // one trail point every ~500 m of flight
const MAX_LIFE_S = 120;
const MULTI_ZOOM = 12.5; // one trail per engine from here in
const LAYER_ID = 'contrails';
const EARTH_CIRC = 40_075_016.686;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ pure rules (unit tested)

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** ISA outside air temperature (°C) at a pressure altitude, used when the simulator gives none. */
export function isaOatC(altFt: number): number {
  return altFt >= 36_089 ? -56.5 : 15 - 1.98 * (altFt / 1000);
}

export interface ContrailInput {
  altFt: number | undefined;
  oatC: number | undefined;
  onGround: boolean;
  jet: boolean;
}

/**
 * Whether an aircraft leaves a contrail: a jet above about FL260 in air colder than about
 * −40 °C. A trail that is already forming keeps going a little lower / warmer (hysteresis),
 * so it does not flicker on and off at the threshold.
 */
export function formsContrail(c: ContrailInput, forming = false): boolean {
  if (c.onGround || !c.jet || c.altFt === undefined) return false;
  const oat = c.oatC ?? isaOatC(c.altFt);
  return c.altFt >= (forming ? 25_000 : 26_000) && oat <= (forming ? -38 : -40);
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * How moist the simulated upper air is, 0 (dry: short trails) … 1 (ice-supersaturated: long
 * persistent trails). Smooth value noise over a few hundred km and a few hours.
 */
export function persistence(lat: number, lon: number, simMs: number): number {
  const x = lon / 4;
  const y = lat / 3;
  const z = simMs / 10_800_000;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smoothstep(0, 1, x - xi);
  const fy = smoothstep(0, 1, y - yi);
  const fz = smoothstep(0, 1, z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  const a0 = lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy);
  const a1 = lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy);
  return lerp(a0, a1, fz);
}

/** Seconds (simulated) a trail stays visible for a given persistence. */
export function contrailLifeS(persist: number): number {
  return 20 + (MAX_LIFE_S - 20) * smoothstep(0.3, 0.7, persist);
}

/** Opacity of a trail point `ageS` seconds old: it forms over ~2 s behind the engines, then fades out. */
export function contrailAlpha(ageS: number, lifeS: number): number {
  if (!(ageS >= 0) || ageS >= lifeS) return 0;
  return smoothstep(0.15, 2.2, ageS) * (1 - ageS / lifeS) ** 1.6;
}

/** Half-width (m) of a trail `ageS` old: about the engine-exhaust width at first, then spreading. */
export function contrailHalfWidthM(ageS: number, spanM: number): number {
  return 1.2 + 0.02 * spanM + 0.45 * Math.max(0, ageS);
}

/** Lateral engine positions in metres right of the centreline, one trail each. */
export function engineOffsets(count: number, mount: string, spanM: number): number[] {
  const f = (k: number[]) => k.map((v) => v * spanM);
  if (count >= 4) return f([-0.36, -0.2, 0.2, 0.36]);
  if (count === 3) return f([-0.16, 0, 0.16]);
  if (count === 2) return mount === 'rear' || mount === 'fuselage' || mount === 'tail' ? f([-0.09, 0.09]) : f([-0.17, 0.17]);
  return [0];
}

// ------------------------------------------------------------------ trail bookkeeping

interface Hist {
  /** Flat [mercX, mercY, altMslM, simMs] per point, oldest first. */
  pts: number[];
  forming: boolean;
  life: number;
  offsets: number[];
  span: number;
  fieldM: number | undefined;
  lastSample: number;
  seenAt: number; // real ms
}

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec3 u_cam;
uniform float u_dt;
uniform float u_pxk;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_dir;
layout(location = 2) in vec4 a_m; // side, age at build (s), life (s), base half-width
out float v_side;
out float v_a; // coverage (thin far-away ribbons are widened to a pixel but fainter)
out float v_age; // interpolated so opacity is exact along long segments
out float v_life;
void main() {
  float age = a_m.y + u_dt;
  v_age = age;
  v_life = a_m.z;
  v_a = 1.0;
  vec3 toCam = u_cam - a_pos;
  float dist = length(toCam);
  vec3 n = cross(a_dir, toCam);
  float nl = length(n);
  n = nl > 1e-6 * max(dist, 1.0) ? n / nl : vec3(-a_dir.y, a_dir.x, 0.0);
  float hw = a_m.w + 0.45 * age;
  float minW = dist * u_pxk;
  if (hw < minW) {
    v_a *= max(0.4, hw / minW);
    hw = minW;
  }
  v_side = a_m.x;
  gl_Position = u_matrix * vec4(a_pos + n * (a_m.x * hw), 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
in float v_side;
in float v_a;
in float v_age;
in float v_life;
out vec4 o;
void main() {
  // forms over ~2 s behind the engines, then fades out (contrailAlpha in TypeScript)
  float life = smoothstep(0.15, 2.2, v_age) * pow(clamp(1.0 - v_age / v_life, 0.0, 1.0), 1.6);
  float e = max(0.0, 1.0 - v_side * v_side);
  float a = life * v_a * u_alpha * e * sqrt(e);
  o = vec4(u_color * a, a);
}`;

interface Batch {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  origin: [number, number]; // mercator
  k0: number; // mercator units per metre at the origin
  sim: number; // sim ms at build
}

interface Gpu {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  bulk: Batch;
  sel: Batch;
}

const FLOATS = 10; // pos3 dir3 m4

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function createGpu(gl: WebGL2RenderingContext): Gpu {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const u: Gpu['u'] = {};
  for (const n of ['u_matrix', 'u_cam', 'u_dt', 'u_pxk', 'u_color', 'u_alpha']) u[n] = gl.getUniformLocation(prog, n);
  const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
  const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
  const batch = (): Batch => {
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, FLOATS * 4, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 24);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: 0, origin: [0, 0], k0: 1, sim: 0 };
  };
  const g: Gpu = { gl, prog, u, bulk: batch(), sel: batch() };
  gl.bindVertexArray(prevVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
  return g;
}

function destroyGpu(g: Gpu) {
  const { gl } = g;
  for (const b of [g.bulk, g.sel]) {
    gl.deleteVertexArray(b.vao);
    gl.deleteBuffer(b.vbo);
    gl.deleteBuffer(b.ibo);
  }
  gl.deleteProgram(g.prog);
}

/** Growable typed arrays reused between rebuilds. */
class Geo {
  v = new Float32Array(FLOATS * 1024);
  i = new Uint32Array(3 * 1024);
  nv = 0;
  ni = 0;
  reset() {
    this.nv = 0;
    this.ni = 0;
  }
  reserve(verts: number, idx: number) {
    if ((this.nv + verts) * FLOATS > this.v.length) {
      const n = new Float32Array(Math.max(this.v.length * 2, (this.nv + verts) * FLOATS));
      n.set(this.v.subarray(0, this.nv * FLOATS));
      this.v = n;
    }
    if (this.ni + idx > this.i.length) {
      const n = new Uint32Array(Math.max(this.i.length * 2, this.ni + idx));
      n.set(this.i.subarray(0, this.ni));
      this.i = n;
    }
  }
}

function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
}

/** Mercator units per metre at mercator y (1 / (C·cos lat) = cosh(π(1 − 2y)) / C). */
const kAtY = (y: number) => Math.cosh(Math.PI * (1 - 2 * y)) / EARTH_CIRC;

/** Contrail colour and opacity from the sun at the view centre: white by day, warm at sunset, faint at night. */
export function contrailLight(sunAltDeg: number): { color: [number, number, number]; alpha: number } {
  if (sunAltDeg >= 10) return { color: [0.97, 0.98, 1], alpha: 0.78 };
  if (sunAltDeg >= 0) {
    const k = sunAltDeg / 10;
    return { color: [1, 0.84 + 0.14 * k, 0.72 + 0.28 * k], alpha: 0.72 + 0.06 * k };
  }
  if (sunAltDeg >= -8) {
    // high trails stay sunlit after sunset on the ground
    const k = (sunAltDeg + 8) / 8;
    return { color: [0.55 + 0.45 * k, 0.55 + 0.2 * k, 0.65 + 0.07 * k], alpha: 0.3 + 0.4 * k };
  }
  return { color: [0.55, 0.6, 0.7], alpha: 0.24 };
}

// ------------------------------------------------------------------ layer

export interface ContrailsHandle {
  dispose(): void;
}

export function startContrails(map: MlMap): ContrailsHandle {
  const hist = new Map<string, Hist>();
  const bulkGeo = new Geo();
  const selGeo = new Geo();
  let gpu: Gpu | null = null;
  let broken = false;
  let disposed = false;
  let lastScan = 0;
  let lastSample = 0;
  let lastBulk = 0;
  let bulkDirty = true;
  let candidates: Track[] = [];
  let light = contrailLight(30);
  let lightAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const m64 = new Float64Array(16);
  const base = new Float64Array(16);
  const m32 = new Float32Array(16);

  const enabled = () => getSettings().showContrails && !ui().replay.active && (map.getZoom() >= CONTRAIL_MIN_ZOOM || ui().chase);

  const jetInfo = (t: Track) => {
    const spec = t.ac.aircraftType ? specOf(t.ac.aircraftType) : undefined;
    return spec && spec.engines.kind === 'jet' ? spec : undefined;
  };

  /** Picks the (at most 300) aircraft nearest the view centre that are high enough to matter. */
  const scan = (now: number) => {
    const c = map.getCenter();
    const b = map.getBounds();
    const w = b.getWest();
    const e = b.getEast();
    const s = b.getSouth();
    const n = b.getNorth();
    const padX = Math.min(20, (e - w) * 0.15);
    const padY = Math.min(15, (n - s) * 0.15);
    const wide = e - w >= 300;
    const sel = ui().selectedId;
    const k = Math.cos(c.lat * D2R);
    const near: { t: Track; d: number }[] = [];
    for (const t of traffic.tracks.values()) {
      const a = t.ac;
      if (a.onGround || (a.altitudeBarometric ?? 0) < 25_000) continue;
      let lon = a.lon;
      if (!wide) {
        if (lon < w - padX) lon += 360;
        else if (lon > e + padX) lon -= 360;
        if (t.id !== sel && (lon < w - padX || lon > e + padX || a.lat < s - padY || a.lat > n + padY)) continue;
      }
      const dx = (lon - c.lng) * k;
      const dy = a.lat - c.lat;
      near.push({ t, d: t.id === sel ? -1 : dx * dx + dy * dy });
    }
    near.sort((p, q) => p.d - q.d);
    candidates = near.slice(0, MAX_CONTRAIL_AIRCRAFT).map((x) => x.t);
    for (const t of candidates) {
      const h = hist.get(t.id);
      if (h) h.seenAt = now;
    }
    // forget trails that left the view and have faded
    for (const [id, h] of hist) if (now - h.seenAt > 15_000) hist.delete(id);
  };

  /** Adds trail points for forming aircraft and drops faded ones. */
  const sample = (now: number, sim: number) => {
    const zoomedIn = map.getZoom() >= 10;
    const sel = ui().selectedId;
    for (const t of candidates) {
      const a = t.ac;
      const spec = jetInfo(t);
      let h = hist.get(t.id);
      const alt = a.altitudeBarometric;
      const forming = formsContrail({ altFt: alt, oatC: a.ext?.outsideAirTemp, onGround: a.onGround, jet: !!spec }, h?.forming ?? false);
      if (!h) {
        if (!forming || !spec) continue;
        h = {
          pts: [],
          forming: false,
          life: 60,
          offsets: engineOffsets(spec.engines.count, spec.engines.mount, spec.spanM),
          span: spec.spanM,
          fieldM: undefined,
          lastSample: 0,
          seenAt: now,
        };
        hist.set(t.id, h);
      }
      h.seenAt = now;
      if (h.fieldM === undefined && (zoomedIn || t.id === sel)) {
        const f = simElevationFt(t.id);
        if (f !== undefined) h.fieldM = f * 0.3048;
      }
      const pos = traffic.displayPosition(t, now);
      if (forming && alt !== undefined) {
        h.life = contrailLifeS(persistence(pos.lat, pos.lon, sim));
        const m = MercatorCoordinate.fromLngLat([pos.lon, pos.lat]);
        if (!h.forming && h.pts.length === 0 && Math.abs(a.verticalRate ?? 0) < 400 && (a.groundSpeed ?? 0) > 150) {
          // Already cruising when first seen: lay the recent trail back along the track
          // (straight and level), so trails do not all start growing at the moment you look.
          const trk = (pos.trk ?? a.track ?? 0) * D2R;
          const kk = kAtY(m.y);
          const v = (a.groundSpeed ?? 0) * 0.514444; // m/s
          const span = Math.min(h.life - 4, 90);
          for (let s = span; s >= SAMPLE_SIM_MS / 1000; s -= SAMPLE_SIM_MS / 1000) {
            const d = v * s * kk;
            h.pts.push(m.x - Math.sin(trk) * d, m.y + Math.cos(trk) * d, alt * 0.3048, sim - s * 1000);
          }
        }
        if (sim - h.lastSample >= SAMPLE_SIM_MS || h.pts.length === 0) {
          h.pts.push(m.x, m.y, alt * 0.3048, sim);
          h.lastSample = sim;
        }
      }
      h.forming = forming;
      // expire old points
      const cutoff = sim - h.life * 1000;
      let drop = 0;
      while (drop < h.pts.length && h.pts[drop + 3]! < cutoff) drop += 4;
      if (drop) h.pts.splice(0, drop);
      if (!h.forming && h.pts.length === 0) hist.delete(t.id);
    }
    // trails of aircraft no longer in the candidate list still fade out
    for (const [id, h] of hist) {
      if (h.seenAt === now) continue;
      const cutoff = sim - h.life * 1000;
      let drop = 0;
      while (drop < h.pts.length && h.pts[drop + 3]! < cutoff) drop += 4;
      if (drop) h.pts.splice(0, drop);
      if (h.pts.length === 0) hist.delete(id);
    }
  };

  /** Appends the ribbons of one aircraft to `geo` (positions relative to `origin`, in metres). */
  const emit = (
    geo: Geo,
    h: Hist,
    head: [number, number, number] | null,
    origin: [number, number],
    k0: number,
    sim: number,
    multi: boolean,
    terrain: boolean,
  ) => {
    const n = h.pts.length / 4 + (head ? 1 : 0);
    if (n < 2) return;
    const field = terrain ? 0 : (h.fieldM ?? 0);
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const pz = new Float64Array(n);
    const age = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x: number, y: number, alt: number, t: number;
      if (i < h.pts.length / 4) {
        x = h.pts[i * 4]!;
        y = h.pts[i * 4 + 1]!;
        alt = h.pts[i * 4 + 2]!;
        t = h.pts[i * 4 + 3]!;
      } else {
        [x, y, alt] = head!;
        t = sim;
      }
      let dx = x - origin[0];
      if (dx > 0.5) dx -= 1;
      else if (dx < -0.5) dx += 1;
      px[i] = dx / k0;
      py[i] = (y - origin[1]) / k0;
      pz[i] = (Math.max(0, alt - field) * kAtY(y)) / k0;
      age[i] = (sim - t) / 1000;
    }
    const offsets = multi ? h.offsets : [0];
    const w0 = contrailHalfWidthM(0, h.span) * (multi ? 1 : 1.6);
    geo.reserve(offsets.length * n * 2, offsets.length * (n - 1) * 6);
    const v = geo.v;
    for (const off of offsets) {
      const first = geo.nv;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let tx = px[b]! - px[a]!;
        let ty = py[b]! - py[a]!;
        let tz = pz[b]! - pz[a]!;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const hl = Math.hypot(tx, ty) || 1;
        // right of the direction of travel (mercator y points south)
        const rx = -ty / hl;
        const ry = tx / hl;
        const x = px[i]! + rx * off;
        const y = py[i]! + ry * off;
        for (const side of [-1, 1]) {
          const o = geo.nv++ * FLOATS;
          v[o] = x;
          v[o + 1] = y;
          v[o + 2] = pz[i]!;
          v[o + 3] = tx;
          v[o + 4] = ty;
          v[o + 5] = tz;
          v[o + 6] = side;
          v[o + 7] = age[i]!;
          v[o + 8] = h.life;
          v[o + 9] = w0;
        }
      }
      const idx = geo.i;
      for (let i = 0; i < n - 1; i++) {
        const a = first + i * 2;
        idx[geo.ni++] = a;
        idx[geo.ni++] = a + 1;
        idx[geo.ni++] = a + 2;
        idx[geo.ni++] = a + 1;
        idx[geo.ni++] = a + 3;
        idx[geo.ni++] = a + 2;
      }
    }
  };

  const headOf = (t: Track, now: number, h: Hist): [number, number, number] | null => {
    if (!h.forming || t.ac.altitudeBarometric === undefined) return null;
    const pos = traffic.displayPosition(t, now);
    const m = MercatorCoordinate.fromLngLat([pos.lon, pos.lat]);
    return [m.x, m.y, t.ac.altitudeBarometric * 0.3048];
  };

  const upload = (gl: WebGL2RenderingContext, b: Batch, geo: Geo) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.v.subarray(0, geo.nv * FLOATS), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.i.subarray(0, geo.ni), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    b.count = geo.ni;
  };

  const schedule = () => {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      if (!disposed && hist.size) map.triggerRepaint();
    }, 250);
  };

  const draw = (gl: WebGL2RenderingContext, args: CustomRenderMethodInput) => {
    if (!enabled()) return;
    const pd = args.defaultProjectionData;
    if (typeof pd.projectionTransition === 'number' && pd.projectionTransition > 0.001) return; // globe: not drawn
    const now = Date.now();
    const sim = simNow(now);
    const zoom = map.getZoom();
    if (now - lastScan > 500) {
      lastScan = now;
      scan(now);
    }
    if (now - lastSample > 100) {
      lastSample = now;
      sample(now, sim);
      bulkDirty = true;
    }
    if (!hist.size) return;
    if (!gpu || gpu.gl !== gl) gpu = createGpu(gl);
    const g = gpu;
    const terrain = !!map.getTerrain();
    const multi = zoom >= MULTI_ZOOM;
    const sel = ui().selectedId;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;

    // bulk: everything but the selected aircraft, rebuilt a few times a second
    if (bulkDirty && now - lastBulk > (zoom >= 11 ? 100 : 200)) {
      lastBulk = now;
      bulkDirty = false;
      const c = MercatorCoordinate.fromLngLat(map.getCenter());
      const origin: [number, number] = [c.x, c.y];
      const k0 = kAtY(c.y);
      bulkGeo.reset();
      for (const [id, h] of hist) {
        if (id === sel) continue;
        const t = traffic.get(id);
        emit(bulkGeo, h, t ? headOf(t, now, h) : null, origin, k0, sim, multi, terrain);
      }
      upload(gl, g.bulk, bulkGeo);
      g.bulk.origin = origin;
      g.bulk.k0 = k0;
      g.bulk.sim = sim;
    }
    // selected: every frame, so the trail stays attached to the (moving) model
    g.sel.count = 0;
    const sh = sel ? hist.get(sel) : undefined;
    const st = sel ? traffic.get(sel) : undefined;
    if (sh && st) {
      const head = headOf(st, now, sh);
      const pos = traffic.displayPosition(st, now);
      const m = MercatorCoordinate.fromLngLat([pos.lon, pos.lat]);
      const origin: [number, number] = [m.x, m.y];
      const k0 = kAtY(m.y);
      selGeo.reset();
      emit(selGeo, sh, head, origin, k0, sim, multi || ui().chase, terrain);
      upload(gl, g.sel, selGeo);
      g.sel.origin = origin;
      g.sel.k0 = k0;
      g.sel.sim = sim;
    }

    if (now - lightAt > 3000) {
      lightAt = now;
      const c = map.getCenter();
      light = contrailLight(solarElevation(c.lat, c.lng, subsolarPoint(sim)));
    }
    const zoomFade = 0.45 + 0.55 * smoothstep(CONTRAIL_MIN_ZOOM, 9, zoom);

    // camera position (mercator) for camera-facing ribbons
    const cc = map.getCenter();
    const C = MercatorCoordinate.fromLngLat(cc, map.getCenterElevation());
    const p = map.getPitch() * D2R;
    const bb = map.getBearing() * D2R;
    const H = map.getCanvas().clientHeight || 600;
    const fov = map.getVerticalFieldOfView() * D2R;
    const ctc = (0.5 * H) / Math.tan(fov / 2);
    const dM = ctc / (512 * 2 ** zoom);
    const cam = [C.x - Math.sin(p) * Math.sin(bb) * dM, C.y + Math.sin(p) * Math.cos(bb) * dM, C.z + Math.cos(p) * dM];
    const pxk = ((map.getZoom() >= MULTI_ZOOM ? 0.55 : 0.8) * 2 * Math.tan(fov / 2)) / H;

    const st0 = {
      blend: gl.isEnabled(gl.BLEND),
      depth: gl.isEnabled(gl.DEPTH_TEST),
      cull: gl.isEnabled(gl.CULL_FACE),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
      depthFunc: gl.getParameter(gl.DEPTH_FUNC) as number,
      srcRGB: gl.getParameter(gl.BLEND_SRC_RGB) as number,
      dstRGB: gl.getParameter(gl.BLEND_DST_RGB) as number,
      srcA: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
      dstA: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
      prog: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    };
    try {
      gl.useProgram(g.prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.uniform3f(g.u.u_color!, light.color[0], light.color[1], light.color[2]);
      gl.uniform1f(g.u.u_alpha!, light.alpha * zoomFade);
      gl.uniform1f(g.u.u_pxk!, pxk);
      for (const b of [g.bulk, g.sel]) {
        if (!b.count) continue;
        base.fill(0);
        base[0] = b.k0;
        base[5] = b.k0;
        base[10] = b.k0;
        base[12] = b.origin[0];
        base[13] = b.origin[1];
        base[15] = 1;
        mul4(pd.mainMatrix, base, m64);
        for (let i = 0; i < 16; i++) m32[i] = m64[i]!;
        let cx = cam[0]! - b.origin[0];
        if (cx > 0.5) cx -= 1;
        else if (cx < -0.5) cx += 1;
        gl.uniformMatrix4fv(g.u.u_matrix!, false, m32);
        gl.uniform3f(g.u.u_cam!, cx / b.k0, (cam[1]! - b.origin[1]) / b.k0, cam[2]! / b.k0);
        gl.uniform1f(g.u.u_dt!, (sim - b.sim) / 1000);
        gl.bindVertexArray(b.vao);
        gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
      }
    } finally {
      gl.bindVertexArray(prevVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
      gl.useProgram(st0.prog);
      if (st0.blend) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      if (st0.depth) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      if (st0.cull) gl.enable(gl.CULL_FACE);
      else gl.disable(gl.CULL_FACE);
      gl.depthMask(st0.depthMask);
      gl.depthFunc(st0.depthFunc);
      gl.blendFuncSeparate(st0.srcRGB, st0.dstRGB, st0.srcA, st0.dstA);
    }
    // keep fading / growing even when nothing else repaints the map
    schedule();
  };

  const layer: CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd: () => undefined,
    onRemove: () => {
      if (gpu) {
        try {
          destroyGpu(gpu);
        } catch {
          /* context may already be gone */
        }
      }
      gpu = null;
    },
    render: (gl, args) => {
      if (broken || !(gl instanceof WebGL2RenderingContext)) return;
      try {
        draw(gl, args);
      } catch (e) {
        broken = true;
        console.warn('[contrails] disabled after an error:', e);
      }
    },
  };

  const ensureLayer = () => {
    if (disposed || broken) return;
    try {
      if (map.getLayer(LAYER_ID)) return;
      // under the aircraft icons and the 3D models, above everything else
      const before = map.getLayer('ac-icons') ? 'ac-icons' : map.getLayer('ac-labels') ? 'ac-labels' : undefined;
      map.addLayer(layer, before);
    } catch {
      /* style not ready yet: retried on the next style event */
    }
  };
  const onContextLost = () => {
    gpu = null;
  };
  map.on('style.load', ensureLayer);
  map.on('styledata', ensureLayer);
  map.on('webglcontextlost', onContextLost);
  ensureLayer();
  map.triggerRepaint();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      map.off('style.load', ensureLayer);
      map.off('styledata', ensureLayer);
      map.off('webglcontextlost', onContextLost);
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      } catch {
        /* map already removed */
      }
    },
  };
}
