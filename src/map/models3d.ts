// True-scale 3D aircraft models drawn into the MapLibre GL context as a custom layer.
//
// Geometry comes from modelMeshes.ts (procedural, one recipe per ModelShape, unit length,
// x = right wing, y = forward, z = up, z = 0 at the ground under the gear). This module owns
// the GPU side: one interleaved VBO per shape (uploaded once), a single shader program, and a
// per-instance draw call with per-instance uniforms (≤ a few hundred instances expected).
//
// Placement: each instance is built in local East-North-Up metres
//   M_enu = Rz(-heading) · Rx(pitch) · Ry(roll) · S(length·xScale, length, length)
// and then mapped to the map's world space. All matrix products run in float64 on the CPU so
// the final per-instance MVP (model units → clip space) is precise; only that is uploaded.
//
// Projection handling (MapLibre v5/v6 `render(gl, options)` signature):
//   • Mercator: world = MercatorCoordinate (x east, y SOUTH, z up, all in mercator units), so
//     the model is translated to MercatorCoordinate.fromLngLat([lon, lat], altM), scaled by
//     meterInMercatorCoordinateUnits() and y is flipped (north → −y); clip = mainMatrix · M.
//   • Globe: options.defaultProjectionData.mainMatrix projects a unit sphere (radius 1 =
//     6 371 008.8 m) and projectionTransition ∈ (0, 1] says how "globe" the frame is. We place
//     the model on the sphere using the local ENU basis at its position and, during the
//     globe ↔ mercator transition, blend the globe clip position with the mercator one built
//     from fallbackMatrix exactly like MapLibre's own projectTileFor3D (the blend is linear, so
//     it is folded into a single matrix). Instances behind the horizon (clipping plane) are
//     culled. In practice the default minZoom (13.5) is past MapLibre's globe → mercator
//     transition (zoom 11–12), so globe frames almost always take the plain mercator path.
//
// Robustness: every GL entry point is wrapped; on any error the layer disables itself
// (console.warn once) instead of breaking the map. GL state we touch (blend, depth, cull,
// program, VAO) is restored after drawing. The layer re-adds itself after style swaps.

import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { ModelShape } from '@/data/sim/refTypes';
import { MAT_ROTOR, MODEL_SHAPES, getModelMesh, type ModelMesh } from './modelMeshes';

export interface ModelInstance {
  id: string;
  lat: number;
  lon: number;
  altM: number; // metres above mean sea level (aircraft on the ground: airport elevation)
  hdg: number; // degrees true, where the nose points
  pitch: number; // degrees, nose up positive
  roll: number; // degrees, right wing down positive
  shape: ModelShape;
  lengthM: number;
  spanM: number;
  body: [number, number, number]; // 0..1 rgb
  tail: [number, number, number];
  selected?: boolean;
  rotorRpm?: number; // helicopters/props spin when > 0
}

export interface ModelsHandle {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
}

const LAYER_ID = 'aircraft-models';
const GLOBE_RADIUS = 6371008.8;
const FRAME_MS = 33; // ~30 fps self-driven repaint while models are on screen

// ------------------------------------------------------------------ shaders (GLSL ES 1.00 body, upgraded for WebGL2)
const VS = `
attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute float a_mat;
attribute vec3 a_disc;
uniform mat4 u_mvp;
uniform mat3 u_rot;
uniform vec3 u_inv;
varying vec3 v_wn;
varying vec3 v_mp;
varying vec3 v_mn;
varying float v_mat;
varying vec3 v_disc;
void main() {
  v_wn = u_rot * (a_nrm * u_inv);
  v_mn = a_nrm;
  v_mp = a_pos;
  v_mat = a_mat;
  v_disc = a_disc;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const FS = `
varying vec3 v_wn;
varying vec3 v_mp;
varying vec3 v_mn;
varying float v_mat;
varying vec3 v_disc;
uniform vec3 u_body;
uniform vec3 u_tail;
uniform float u_sel;
uniform vec3 u_light;
uniform vec3 u_view;
uniform vec4 u_glassA; // noseY, zRef, sMin, sMax
uniform vec4 u_glassB; // lo, hi, kLo, kHi
uniform vec4 u_cabA;   // yStart, yEnd, pitch, enabled
uniform vec4 u_cabB;   // zRow, halfH, zRow2, halfW
uniform float u_spin;
uniform float u_blur;

#ifdef HAS_DERIV
float aaw(float x) { return max(fwidth(x) * 0.75, 1e-6); }
#else
float aaw(float x) { return 1e-4; }
#endif

vec3 shade(vec3 base, vec3 N, vec3 V, float spec, float shin) {
  vec3 L = normalize(u_light);
  float ndl = dot(N, L);
  float diff = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
  float under = mix(0.74, 1.0, smoothstep(-0.75, 0.25, N.z));
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), shin) * spec * smoothstep(-0.05, 0.2, ndl);
  float sky = 0.5 + 0.5 * N.z;
  vec3 c = base * (0.45 + 0.6 * diff) * under + base * vec3(0.05, 0.065, 0.085) * sky + vec3(sp);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  return c + vec3(0.62, 0.72, 0.85) * fres * 0.12;
}

void main() {
  float m = floor(v_mat + 0.5);
  vec3 N = normalize(v_wn);
  vec3 V = normalize(u_view);

  if (m > 3.5 && m < 4.5) {
    // rotor / propeller disc: procedural blades, motion-blurred when spinning
    float r = length(v_disc.xy);
    if (r > 1.0) discard;
    float blades = max(v_disc.z, 1.0);
    float seg = 6.2831853 / blades;
    float a = mod(atan(v_disc.y, v_disc.x) + u_spin, seg);
    a = min(a, seg - a) * max(r, 0.05);
    float bw = mix(0.075, 0.04, r);
    float blade = (1.0 - smoothstep(bw * 0.6, bw, a)) * smoothstep(0.06, 0.12, r);
    float hub = 1.0 - smoothstep(0.08, 0.11, r);
    float rim = smoothstep(0.86, 0.97, r);
    float still = max(blade, hub);
    float blur = max(hub, 0.12 + 0.16 * rim + 0.08 * blade);
    float alpha = mix(still * 0.95, blur, u_blur) * (1.0 - smoothstep(0.975, 1.0, r));
    vec3 c = mix(vec3(0.12, 0.13, 0.15), vec3(0.6, 0.63, 0.68), u_blur * (1.0 - hub));
    c *= 0.75 + 0.25 * max(dot(N, normalize(u_light)), 0.0);
    outColor = vec4(c * alpha, alpha);
    return;
  }

  vec3 base = u_body;
  float spec = 0.22;
  float shin = 38.0;
  if (m > 0.5 && m < 1.5) base = u_tail;
  else if (m > 1.5 && m < 2.5) { base = vec3(0.07, 0.085, 0.11); spec = 0.55; shin = 80.0; }
  else if (m > 2.5 && m < 3.5) { base = vec3(0.76, 0.78, 0.81); spec = 0.42; shin = 55.0; }
  else if (m > 4.5) { base = vec3(0.70, 0.73, 0.77); spec = 0.3; shin = 45.0; }

  if (m < 0.5) {
    // cockpit glass: s = distance from the nose, h = height above the reference line
    float s = u_glassA.x - v_mp.y;
    float h = v_mp.z - u_glassA.y;
    float g = min(min(s - u_glassA.z, u_glassA.w - s), min(h - (u_glassB.x + u_glassB.z * s), (u_glassB.y + u_glassB.w * s) - h));
    float glass = smoothstep(-aaw(g), aaw(g), g);
    // cabin windows: dots when resolvable, a soft dark line when not
    float win = 0.0;
    if (u_cabA.w > 0.5) {
      float k = (u_cabA.x - v_mp.y) / u_cabA.z;
      float kEnd = (u_cabA.x - u_cabA.y) / u_cabA.z;
      float wk = aaw(k);
      float inside = smoothstep(-wk, wk, k) * smoothstep(-wk, wk, kEnd - k);
      float f = abs(fract(k) - 0.5);
      float along = 1.0 - smoothstep(u_cabB.w - wk, u_cabB.w + wk, f);
      along = mix(along, 0.5, smoothstep(0.18, 0.45, wk));
      float d1 = abs(v_mp.z - u_cabB.x);
      float d2 = abs(v_mp.z - u_cabB.z);
      float wz = aaw(v_mp.z);
      float rows = max(1.0 - smoothstep(u_cabB.y - wz, u_cabB.y + wz, d1), 1.0 - smoothstep(u_cabB.y - wz, u_cabB.y + wz, d2));
      float side = smoothstep(0.35, 0.6, abs(v_mn.x));
      win = inside * along * rows * side;
    }
    float dark = max(glass, win * 0.85);
    if (dark > 0.0) {
      base = mix(base, vec3(0.06, 0.08, 0.11), dark);
      spec = mix(spec, 0.6, dark);
      shin = mix(shin, 90.0, dark);
    }
  }

  vec3 c = shade(base, N, V, spec, shin);
  if (u_sel > 0.5) {
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
    c = mix(c, vec3(0.424, 0.78, 1.0), 0.03 + 0.62 * fres);
  }
  outColor = vec4(c, 1.0);
}`;

function sources(webgl2: boolean, deriv: boolean): [string, string] {
  if (webgl2) {
    return [
      `#version 300 es\n#define attribute in\n#define varying out\n${VS}`,
      `#version 300 es\nprecision highp float;\n#define HAS_DERIV 1\n#define varying in\nout vec4 outColor;\n${FS}`,
    ];
  }
  return [
    `precision highp float;\n${VS}`,
    `${deriv ? '#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n' : ''}precision highp float;\n#define outColor gl_FragColor\n${FS}`,
  ];
}

// ------------------------------------------------------------------ math (column-major, float64)
type M4 = Float64Array;
type Mat = ArrayLike<number>;

function mul4(a: Mat, b: Mat, out: M4 = new Float64Array(16)): M4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return out;
}

/** ENU rotation (3×3, column-major): Rz(-hdg) · Rx(pitch) · Ry(roll). */
function enuRotation(hdgDeg: number, pitchDeg: number, rollDeg: number, out: Float64Array) {
  const h = (-hdgDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  const ch = Math.cos(h), sh = Math.sin(h);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  // Rz·Rx
  const a = [ch, sh, 0, -sh * cp, ch * cp, sp, sh * sp, -ch * sp, cp]; // columns
  // (Rz·Rx)·Ry, Ry columns: (cr,0,-sr), (0,1,0), (sr,0,cr)
  for (let row = 0; row < 3; row++) {
    const x = a[row]!, y = a[3 + row]!, z = a[6 + row]!;
    out[row] = x * cr - z * sr;
    out[3 + row] = y;
    out[6 + row] = x * sr + z * cr;
  }
}

// ------------------------------------------------------------------ GPU resources
interface ShapeGpu {
  mesh: ModelMesh;
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null;
}

interface Gpu {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  webgl2: boolean;
  vaoExt: OES_vertex_array_object | null;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  shapes: Map<ModelShape, ShapeGpu>;
}

const UNIFORMS = ['u_mvp', 'u_rot', 'u_inv', 'u_body', 'u_tail', 'u_sel', 'u_light', 'u_view', 'u_glassA', 'u_glassB', 'u_cabA', 'u_cabB', 'u_spin', 'u_blur'];
const STRIDE = 10 * 4; // pos3 nrm3 mat1 disc3

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`aircraft-models shader: ${log ?? 'compile failed'}`);
  }
  return s;
}

function createGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): Gpu {
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const deriv = webgl2 || !!gl.getExtension('OES_standard_derivatives');
  const vaoExt = webgl2 ? null : gl.getExtension('OES_vertex_array_object');
  const [vs, fs] = sources(webgl2, deriv);
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.bindAttribLocation(prog, 1, 'a_nrm');
  gl.bindAttribLocation(prog, 2, 'a_mat');
  gl.bindAttribLocation(prog, 3, 'a_disc');
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`aircraft-models link: ${gl.getProgramInfoLog(prog) ?? ''}`);
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n);
  return { gl, webgl2, vaoExt, prog, u, shapes: new Map() };
}

function setupAttribs(gl: WebGLRenderingContext) {
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.enableVertexAttribArray(2);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 24);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 28);
}

function bindVao(g: Gpu, vao: ShapeGpu['vao']) {
  if (g.webgl2) (g.gl as WebGL2RenderingContext).bindVertexArray(vao as WebGLVertexArrayObject | null);
  else if (g.vaoExt) g.vaoExt.bindVertexArrayOES(vao as WebGLVertexArrayObjectOES | null);
}

function shapeGpu(g: Gpu, shape: ModelShape): ShapeGpu {
  let s = g.shapes.get(shape);
  if (s) return s;
  const gl = g.gl;
  const mesh = getModelMesh(shape);
  const data = new Float32Array(mesh.vertexCount * 10);
  for (let v = 0; v < mesh.vertexCount; v++) {
    const o = v * 10;
    data[o] = mesh.positions[v * 3]!;
    data[o + 1] = mesh.positions[v * 3 + 1]!;
    data[o + 2] = mesh.positions[v * 3 + 2]!;
    data[o + 3] = mesh.normals[v * 3]!;
    data[o + 4] = mesh.normals[v * 3 + 1]!;
    data[o + 5] = mesh.normals[v * 3 + 2]!;
    data[o + 6] = mesh.colorIndex[v]!;
    data[o + 7] = mesh.disc[v * 3]!;
    data[o + 8] = mesh.disc[v * 3 + 1]!;
    data[o + 9] = mesh.disc[v * 3 + 2]!;
  }
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('createBuffer failed');
  let vao: ShapeGpu['vao'] = null;
  if (g.webgl2) vao = (gl as WebGL2RenderingContext).createVertexArray();
  else if (g.vaoExt) vao = g.vaoExt.createVertexArrayOES();
  bindVao(g, vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  if (vao) setupAttribs(gl);
  bindVao(g, null);
  s = { mesh, vbo, vao };
  g.shapes.set(shape, s);
  return s;
}

function destroyGpu(g: Gpu) {
  const gl = g.gl;
  if (gl.isContextLost()) return;
  for (const s of g.shapes.values()) {
    gl.deleteBuffer(s.vbo);
    if (s.vao) {
      if (g.webgl2) (gl as WebGL2RenderingContext).deleteVertexArray(s.vao as WebGLVertexArrayObject);
      else g.vaoExt?.deleteVertexArrayOES(s.vao as WebGLVertexArrayObjectOES);
    }
  }
  gl.deleteProgram(g.prog);
}

// ------------------------------------------------------------------ the layer
// Light from the south-east, 50° above the horizon (ENU: x east, y north, z up).
const LIGHT: [number, number, number] = (() => {
  const el = (50 * Math.PI) / 180;
  const az = (135 * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
})();

const NO_GLASS = new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]);
const NO_CABIN = new Float32Array([0, 0, 1, 0, -99, 0, -99, 0.2]);

/** Adds a custom layer 'aircraft-models' (beforeId optional) that draws `source()` every frame. */
export function installModels(map: MlMap, source: () => ModelInstance[], opts?: { beforeId?: string; minZoom?: number }): ModelsHandle {
  const minZoom = opts?.minZoom ?? 13.5;
  let enabled = true;
  let broken = false;
  let disposed = false;
  let gpu: Gpu | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const mvp64 = new Float64Array(16);
  const model64 = new Float64Array(16);
  const globe64 = new Float64Array(16);
  const mvpG64 = new Float64Array(16);
  const rot = new Float64Array(9);
  const mvp32 = new Float32Array(16);
  const rot32 = new Float32Array(9);
  let pool = new Float32Array(25 * 64); // per-instance mvp (16) + rotation (9), reused every frame

  const fail = (where: string, e: unknown) => {
    if (!broken) console.warn(`[aircraft-models] disabled after an error in ${where}:`, e);
    broken = true;
  };

  const schedule = () => {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      if (!disposed && enabled && !broken) map.triggerRepaint();
    }, FRAME_MS);
  };

  const draw = (gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) => {
    if (!enabled || broken || disposed) return;
    if (map.getZoom() < minZoom) return;
    const list = source();
    if (!list.length) return;
    if (gl.isContextLost()) {
      gpu = null;
      return;
    }
    if (!gpu || gpu.gl !== gl) gpu = createGpu(gl);
    const g = gpu;

    const pd = args.defaultProjectionData;
    const transition = typeof pd.projectionTransition === 'number' ? pd.projectionTransition : 0;
    const globe = transition > 0;
    const flatMatrix: Mat = globe ? pd.fallbackMatrix : pd.mainMatrix;
    const clipPlane = pd.clippingPlane;

    // view direction (towards the camera) in ENU, shared by all instances
    const b = (map.getBearing() * Math.PI) / 180;
    const p = (map.getPitch() * Math.PI) / 180;
    const view: [number, number, number] = [-Math.sin(b) * Math.sin(p), -Math.cos(b) * Math.sin(p), Math.cos(p)];
    const centerX = MercatorCoordinate.fromLngLat(map.getCenter()).x;
    const now = performance.now() / 1000;

    // group by shape
    const groups = new Map<ModelShape, ModelInstance[]>();
    for (const inst of list) {
      const shape = MODEL_SHAPES.includes(inst.shape) ? inst.shape : 'narrow';
      let arr = groups.get(shape);
      if (!arr) groups.set(shape, (arr = []));
      arr.push(inst);
    }

    // save GL state we change
    const st = {
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

    let drawn = 0;
    let spinning = false;
    try {
      gl.useProgram(g.prog);
      gl.uniform3f(g.u.u_light!, LIGHT[0], LIGHT[1], LIGHT[2]);
      gl.uniform3f(g.u.u_view!, view[0], view[1], view[2]);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);

      // Per-instance matrices are computed once and reused by the translucent pass.
      const prepared: { s: ShapeGpu; inst: ModelInstance; o: number; inv: number }[] = [];
      for (const [shape, insts] of groups) {
        const s = shapeGpu(g, shape);
        for (const inst of insts) {
          const L = inst.lengthM > 0 ? inst.lengthM : 30;
          const ratio = inst.spanM > 0 ? inst.spanM / L / s.mesh.spanRatio : 1;
          const xs = Math.min(1.8, Math.max(0.55, ratio));
          enuRotation(inst.hdg, inst.pitch || 0, inst.roll || 0, rot);
          const sx = L * xs;

          // mercator model matrix
          const mc = MercatorCoordinate.fromLngLat([inst.lon, inst.lat], inst.altM);
          const k = mc.meterInMercatorCoordinateUnits();
          const mx = mc.x + Math.round(centerX - mc.x); // nearest world copy
          for (let c = 0; c < 3; c++) {
            const sc = c === 0 ? sx : L;
            model64[c * 4] = rot[c * 3]! * sc * k;
            model64[c * 4 + 1] = -rot[c * 3 + 1]! * sc * k;
            model64[c * 4 + 2] = rot[c * 3 + 2]! * sc * k;
            model64[c * 4 + 3] = 0;
          }
          model64[12] = mx;
          model64[13] = mc.y;
          model64[14] = mc.z;
          model64[15] = 1;
          mul4(flatMatrix, model64, mvp64);

          if (globe) {
            const lat = (inst.lat * Math.PI) / 180;
            const lon = (inst.lon * Math.PI) / 180;
            const U = [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
            if (clipPlane && U[0]! * clipPlane[0] + U[1]! * clipPlane[1] + U[2]! * clipPlane[2] + clipPlane[3] < 0) continue;
            const E = [Math.cos(lon), 0, -Math.sin(lon)];
            const Nn = [-Math.sin(lon) * Math.sin(lat), Math.cos(lat), -Math.cos(lon) * Math.sin(lat)];
            for (let c = 0; c < 3; c++) {
              const sc = (c === 0 ? sx : L) / GLOBE_RADIUS;
              const re = rot[c * 3]!, rn = rot[c * 3 + 1]!, ru = rot[c * 3 + 2]!;
              for (let r = 0; r < 3; r++) globe64[c * 4 + r] = (E[r]! * re + Nn[r]! * rn + U[r]! * ru) * sc;
              globe64[c * 4 + 3] = 0;
            }
            const e = 1 + inst.altM / GLOBE_RADIUS;
            globe64[12] = U[0]! * e;
            globe64[13] = U[1]! * e;
            globe64[14] = U[2]! * e;
            globe64[15] = 1;
            mul4(pd.mainMatrix, globe64, mvpG64);
            if (transition >= 0.999) mvp64.set(mvpG64);
            else for (let i = 0; i < 16; i++) mvp64[i] = mvp64[i]! * (1 - transition) + mvpG64[i]! * transition;
          }

          // cheap frustum reject on the model origin (generous margin for the airframe size)
          const cw = mvp64[15]!;
          const cx = mvp64[12]!;
          const cy = mvp64[13]!;
          if (cw <= 0 || Math.abs(cx) > 2.5 * cw || Math.abs(cy) > 2.5 * cw) continue;

          const o = prepared.length * 25;
          if (pool.length < o + 25) {
            const grown = new Float32Array(pool.length * 2);
            grown.set(pool);
            pool = grown;
          }
          for (let i = 0; i < 16; i++) pool[o + i] = mvp64[i]!;
          for (let i = 0; i < 9; i++) pool[o + 16 + i] = rot[i]!;
          prepared.push({ s, inst, o, inv: 1 / xs });
        }
      }

      const setInstance = (it: (typeof prepared)[number]) => {
        mvp32.set(pool.subarray(it.o, it.o + 16));
        rot32.set(pool.subarray(it.o + 16, it.o + 25));
        gl.uniformMatrix4fv(g.u.u_mvp!, false, mvp32);
        gl.uniformMatrix3fv(g.u.u_rot!, false, rot32);
        gl.uniform3f(g.u.u_inv!, it.inv, 1, 1);
        gl.uniform3f(g.u.u_body!, it.inst.body[0], it.inst.body[1], it.inst.body[2]);
        gl.uniform3f(g.u.u_tail!, it.inst.tail[0], it.inst.tail[1], it.inst.tail[2]);
        gl.uniform1f(g.u.u_sel!, it.inst.selected ? 1 : 0);
      };
      let bound: ShapeGpu | null = null;
      const bindShape = (s: ShapeGpu) => {
        if (bound === s) return;
        bound = s;
        bindVao(g, s.vao);
        if (!s.vao) {
          gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
          setupAttribs(gl);
        }
        const gl8 = s.mesh.glass ?? NO_GLASS;
        const cb = s.mesh.cabin;
        gl.uniform4f(g.u.u_glassA!, gl8[0]!, gl8[1]!, gl8[2]!, gl8[3]!);
        gl.uniform4f(g.u.u_glassB!, gl8[4]!, gl8[5]!, gl8[6]!, gl8[7]!);
        if (cb) {
          gl.uniform4f(g.u.u_cabA!, cb[0]!, cb[1]!, cb[2]!, 1);
          gl.uniform4f(g.u.u_cabB!, cb[3]!, cb[4]!, cb[5]!, cb[6]!);
        } else {
          gl.uniform4f(g.u.u_cabA!, NO_CABIN[0]!, NO_CABIN[1]!, NO_CABIN[2]!, 0);
          gl.uniform4f(g.u.u_cabB!, NO_CABIN[4]!, NO_CABIN[5]!, NO_CABIN[6]!, NO_CABIN[7]!);
        }
      };

      // opaque pass
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      for (const it of prepared) {
        bindShape(it.s);
        setInstance(it);
        gl.drawArrays(gl.TRIANGLES, 0, it.s.mesh.opaqueVertexCount);
        drawn++;
      }
      // translucent rotor / propeller discs
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const it of prepared) {
        const mesh = it.s.mesh;
        if (mesh.opaqueVertexCount >= mesh.vertexCount) continue;
        const rpm = Math.max(0, it.inst.rotorRpm ?? 0);
        if (rpm > 0) spinning = true;
        // apparent rotation capped so the blades never strobe at 30 fps
        const rate = Math.min(rpm / 60, 1.6) * Math.PI * 2;
        const phase = (hashId(it.inst.id) * 6.2831853 + now * rate) % (Math.PI * 2);
        bindShape(it.s);
        setInstance(it);
        gl.uniform1f(g.u.u_spin!, phase);
        gl.uniform1f(g.u.u_blur!, smoothstep(20, 250, rpm));
        gl.drawArrays(gl.TRIANGLES, mesh.opaqueVertexCount, mesh.vertexCount - mesh.opaqueVertexCount);
      }
    } finally {
      // restore
      bindVao(g, null);
      if (!g.vaoExt && !g.webgl2) for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
      gl.useProgram(st.prog);
      if (st.blend) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      if (st.depth) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      if (st.cull) gl.enable(gl.CULL_FACE);
      else gl.disable(gl.CULL_FACE);
      gl.depthMask(st.depthMask);
      gl.depthFunc(st.depthFunc);
      gl.blendFuncSeparate(st.srcRGB, st.dstRGB, st.srcA, st.dstA);
    }
    // Keep animating while models are on screen (rotors spin; positions are interpolated by the caller).
    if (drawn > 0 && (spinning || enabled)) schedule();
  };

  const layer: CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd: () => {
      // GPU resources are created lazily on the first visible frame.
    },
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
      try {
        draw(gl, args);
      } catch (e) {
        fail('render', e);
      }
    },
  };

  const ensureLayer = () => {
    if (disposed || broken) return;
    try {
      if (map.getLayer(LAYER_ID)) return;
      const before = opts?.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
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

  return {
    setEnabled(on: boolean) {
      if (enabled === on) return;
      enabled = on;
      if (on) ensureLayer();
      map.triggerRepaint();
    },
    isEnabled() {
      return enabled && !broken;
    },
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

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// ------------------------------------------------------------------ visual check helper
const DEMO: [ModelShape, number, number, [number, number, number], [number, number, number], number?][] = [
  ['narrow', 37.6, 35.8, [0.97, 0.97, 0.98], [0.86, 0.12, 0.16]],
  ['rear-jet', 26.8, 21.2, [0.96, 0.96, 0.97], [0.1, 0.3, 0.62]],
  ['wide-twin', 63.7, 60.9, [0.97, 0.97, 0.98], [0.05, 0.22, 0.45]],
  ['tri-jet', 61.6, 51.7, [0.95, 0.95, 0.96], [0.9, 0.55, 0.1]],
  ['quad', 63.7, 60.3, [0.96, 0.96, 0.97], [0.55, 0.08, 0.2]],
  ['b747', 70.7, 64.4, [0.97, 0.97, 0.98], [0.1, 0.18, 0.4]],
  ['a380', 72.7, 79.8, [0.97, 0.97, 0.98], [0.75, 0.62, 0.32]],
  ['high-turboprop', 27.2, 27.05, [0.96, 0.96, 0.97], [0.15, 0.45, 0.3]],
  ['low-turboprop', 14.2, 17.65, [0.95, 0.95, 0.96], [0.2, 0.25, 0.55], 1700],
  ['high-quad-turboprop', 29.8, 40.4, [0.42, 0.45, 0.42], [0.38, 0.41, 0.38], 1000],
  ['high-jet-quad', 53, 51.75, [0.5, 0.53, 0.56], [0.45, 0.48, 0.51]],
  ['single-high', 8.28, 11, [0.97, 0.97, 0.97], [0.75, 0.1, 0.1], 0],
  ['single-low', 7.3, 10.7, [0.96, 0.96, 0.96], [0.1, 0.25, 0.6], 2400],
  ['single-turboprop', 14.4, 16.3, [0.96, 0.96, 0.97], [0.2, 0.2, 0.25], 1700],
  ['heli', 10.2, 10.2, [0.85, 0.12, 0.12], [0.95, 0.95, 0.95], 380],
  ['glider', 6.6, 15, [0.98, 0.98, 0.98], [0.9, 0.3, 0.1]],
  ['fighter', 19.4, 13.05, [0.55, 0.58, 0.62], [0.5, 0.53, 0.57]],
  ['awacs', 46.6, 44.4, [0.62, 0.64, 0.66], [0.55, 0.57, 0.6]],
];

/** One instance of every shape in a 6 × 3 grid around `center` ([lon, lat]), all heading north. */
export function demoInstances(center: [number, number]): ModelInstance[] {
  const [lon0, lat0] = center;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return DEMO.map(([shape, lengthM, spanM, body, tail, rpm], i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const east = (col - 2.5) * 95;
    const north = (1 - row) * 105;
    return {
      id: `demo-${shape}`,
      lat: lat0 + north / mPerDegLat,
      lon: lon0 + east / mPerDegLon,
      altM: 0,
      hdg: 0,
      pitch: 0,
      roll: 0,
      shape,
      lengthM,
      spanM,
      body,
      tail,
      selected: shape === 'narrow',
      ...(rpm !== undefined ? { rotorRpm: rpm } : {}),
    };
  });
}

// Re-exported for callers that want to know whether a shape has spinning parts.
export function hasRotor(shape: ModelShape): boolean {
  const m = getModelMesh(shape);
  return m.opaqueVertexCount < m.vertexCount && m.colorIndex[m.vertexCount - 1] === MAT_ROTOR;
}
