// True-scale 3D aircraft models drawn into the MapLibre GL context as a custom layer.
//
// Geometry comes from modelMeshes.ts (procedural, one recipe per ModelShape, unit length,
// x = right wing, y = forward, z = up, z = 0 at the ground under the gear). This module owns
// the GPU side: one interleaved VBO per shape (uploaded once), one dynamic per-instance buffer
// rebuilt every frame, and two shader programs (airframe, light points).
//
// Instancing: instances are bucketed by shape and drawn with one instanced draw call per shape
// and pass (WebGL2 drawArraysInstanced + vertexAttribDivisor; WebGL1 ANGLE_instanced_arrays;
// without either, the same shader runs in a per-instance loop with constant vertex attributes).
// Per-instance attributes (36 floats): model matrix (4 columns), ENU orientation quaternion
// (normals), body rgb + selected, tail rgb + night, (gear, flaps, rotor phase, rotor blur),
// (length m, light phase, lights on, 1 / x-scale).
//
// Placement: each instance is built in local East-North-Up metres
//   M_enu = Rz(-heading) · Rx(pitch) · Ry(roll) · S(length·xScale, length, length)
// Precision: all placement math runs in float64 relative to a per-frame origin (the camera
// centre in mercator units). The shared projection uniform is mainMatrix · T(origin) · S(k0)
// (k0 = mercator units per metre at the origin), and the per-instance matrices hold only the
// rotation/scale and the float32 offset in metres from the origin, so nothing jitters even at
// zoom 20.
//
// Projection handling (MapLibre v5/v6 `render(gl, options)` signature):
//   • Mercator: world = MercatorCoordinate (x east, y SOUTH, z up, all in mercator units); y is
//     flipped (north → −y) when building the model columns.
//   • Globe (projectionTransition ∈ (0, 1]): the model is placed on the unit sphere with the
//     local ENU basis and blended with the mercator placement exactly like MapLibre's own
//     projectTileFor3D; the full per-instance clip matrix is computed in float64 and uploaded
//     as the instance matrix with an identity projection uniform. Instances behind the horizon
//     are culled. In practice the default minZoom (13.5) is past MapLibre's globe → mercator
//     transition (zoom 11–12), so globe frames almost always take the plain mercator path.
//
// Moving parts (vertex shader): landing gear swings out of its well (gear 0..1), trailing-edge
// flaps rotate about their hinge line and slide aft (flaps 0..1 = 0..35°), slats droop.
//
// Lights: a second, additive pass of point sprites (depth-tested, not depth-writing): red /
// green / white navigation lights, double-flash wingtip strobes, red beacons, landing and taxi
// lights with a soft beam (only while the gear is down) and tail logo lights. They are strong
// at night (sun below about -4°, computed per aircraft) and subtle by day; at night the
// airframe is moon-lit, the fin is flood-lit and cabin windows glow.
//
// Robustness: every GL entry point is wrapped; on any error the layer disables itself
// (console.warn once) instead of breaking the map. GL state we touch (blend, depth, cull,
// program, VAO, array buffer, attribute divisors) is restored after drawing. The layer re-adds
// itself after style swaps.
//
// Ground-service vehicles (vehicleMeshes.ts, loaded on demand) are extra shapes registered with
// registerMeshes(); they ride the same instanced pipeline. For them the gear channel (i_anim.x)
// drives their moving parts (catering box lift and scissor arms, de-icing boom), they add matte
// rubber / chassis / lamp-lens materials and light types for rotating amber beacons, head and
// tail lamps, de-icing spray particles and work floodlights (see the constants in modelMeshes.ts).

import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { ModelShape } from '@/data/sim/refTypes';
import { LIGHT_STRIDE, MAT_ROTOR, MODEL_SHAPES, getModelMesh, type ModelMesh, type VehicleShape } from './modelMeshes';

export interface ModelInstance {
  id: string;
  lat: number;
  lon: number;
  altM: number; // metres above mean sea level (aircraft on the ground: airport elevation)
  hdg: number; // degrees true, where the nose points
  pitch: number; // degrees, nose up positive
  roll: number; // degrees, right wing down positive
  shape: ModelShape | VehicleShape;
  lengthM: number;
  spanM: number;
  body: [number, number, number]; // 0..1 rgb
  tail: [number, number, number];
  selected?: boolean;
  rotorRpm?: number; // helicopters/props spin when > 0
  /** Gear-down fraction 0 (retracted) .. 1 (down and locked). Default 1. Vehicles: lift / boom fraction. */
  gear?: number;
  /** Flap setting 0 (clean) .. 0.35 (take-off) .. 1 (landing, ~35°). Default 0. */
  flaps?: number;
  /**
   * Exterior lights: true / 1 = all on (default); 0.5 = taxi (no strobes or landing beams);
   * 0.25 = parked (navigation and logo lights only); false / 0 = off.
   */
  lights?: boolean | number;
  /** Night factor override (true / 1 = full night). Default: from the sun altitude at the aircraft. */
  night?: boolean | number;
}

export interface ModelsStats {
  instances: number;
  drawCalls: number;
  /** CPU time of the last render call (ms), including GL command submission. */
  cpuMs: number;
  /** Part of cpuMs spent building the instance data (float64 placement, grouping). */
  prepareMs: number;
  mode: 'webgl2' | 'angle' | 'loop' | 'none';
}

export interface ModelsHandle {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
  /** Diagnostics of the last frame. */
  stats?(): ModelsStats;
}

const LAYER_ID = 'aircraft-models';
const GLOBE_RADIUS = 6371008.8;
const EARTH_CIRC = 2 * Math.PI * GLOBE_RADIUS;
const FRAME_MS = 33; // ~30 fps self-driven repaint while models are on screen
const IF = 36; // floats per instance
const VF = 18; // floats per vertex: pos3 mat1 nrm3 disc3 part4 axis4
const N_INST_ATTR = 9;
const I_BASE = 5; // first instance attribute location
const LOD_PX = 110; // models shorter than this on screen (CSS px) use the low-detail mesh
const TIME_WRAP = 132; // s; multiple of the strobe (1.2 s) and beacon (1.1 s) periods

// ------------------------------------------------------------------ shaders (GLSL ES 1.00 body, upgraded for WebGL2)
const COMMON = `
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
float strobeAt(float t) {
  float c = mod(t, 1.2);
  return exp(-pow((c - 0.06) / 0.045, 2.0)) + exp(-pow((c - 0.24) / 0.045, 2.0));
}
float beaconAt(float t) {
  float c = mod(t, 1.1);
  return exp(-pow((c - 0.12) / 0.08, 2.0));
}`;

const INSTANCE_ATTRS = `
attribute vec4 i_m0;
attribute vec4 i_m1;
attribute vec4 i_m2;
attribute vec4 i_m3;
attribute vec4 i_q;
attribute vec4 i_body;
attribute vec4 i_tail;
attribute vec4 i_anim;
attribute vec4 i_misc;`;

const VS = `
attribute vec4 a_pos;
attribute vec3 a_nrm;
attribute vec3 a_disc;
attribute vec4 a_part;
attribute vec4 a_axis;
${INSTANCE_ATTRS}
uniform mat4 u_proj;
uniform float u_time;
varying vec4 v_wn;
varying vec4 v_mp;
varying vec4 v_mn;
varying vec4 v_disc;
varying vec4 v_body;
varying vec4 v_tail;
varying vec4 v_fx;
${COMMON}
vec3 arot(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  vec3 p = a_pos.xyz;
  vec3 n = a_nrm;
  float kind = a_part.x;
  if (kind > 0.5) {
    // integer part: kind of moving part; fraction: a per-part parameter (vehicles)
    float kf = floor(kind + 0.001);
    float kp = kind - kf;
    vec3 piv = a_part.yzw;
    vec3 ax = a_axis.xyz;
    float ang = 0.0;
    vec3 sl = vec3(0.0);
    float g = clamp(i_anim.x, 0.0, 1.0);
    if (kf < 1.5) {
      // landing gear: swings 90° into its well and shortens as it folds; gone when up
      ang = (1.0 - g) * 1.5708;
      p = g < 0.005 ? piv : piv + (p - piv) * mix(0.72, 1.0, g);
    } else if (kf < 2.5) {
      // trailing-edge flap: hinge rotation (35° at 1) plus Fowler travel aft
      float f = clamp(i_anim.y, 0.0, 1.0);
      ang = f * 0.61;
      sl = vec3(0.0, -a_axis.w * f, 0.0);
    } else if (kf < 3.5) {
      // leading-edge slat: forward and down
      float f = clamp(i_anim.y * 2.5, 0.0, 1.0);
      ang = -f * 0.33;
      sl = vec3(0.0, a_axis.w * f, -0.4 * a_axis.w * f);
    } else if (kf < 4.5) {
      // vehicle body lift (catering box); its platform slides forward once clear of the cab
      sl = vec3(0.0, kp * smoothstep(0.32, 0.42, g), a_axis.w * g);
    } else if (kf < 6.5) {
      // scissor arm: its angle follows the lift height (|axis| = arm length, kp = sin of the stowed angle)
      float lb = max(length(ax), 1e-6);
      ax /= lb;
      ang = asin(clamp(kp + g * a_axis.w / lb, -1.0, 1.0)) - asin(kp);
      if (kf > 5.5) sl = vec3(0.0, 0.0, a_axis.w * g);
    } else {
      // rigid swing (de-icing boom)
      ang = g * a_axis.w;
    }
    p = piv + arot(p - piv, ax, ang) + sl;
    n = arot(n, ax, ang);
  }
  gl_Position = u_proj * (mat4(i_m0, i_m1, i_m2, i_m3) * vec4(p, 1.0));
  v_wn = vec4(qrot(i_q, n * vec3(i_misc.w, 1.0, 1.0)), a_pos.w);
  v_mp = vec4(p, i_body.w);
  v_mn = vec4(n, i_anim.z);
  v_disc = vec4(a_disc, i_anim.w);
  v_body = vec4(i_body.rgb, i_tail.w);
  v_tail = vec4(i_tail.rgb, i_misc.z);
  float t = u_time + i_misc.y * 1.2;
  // z: rotating amber beacon reflector (two lobes, ~1.5 rev/s)
  v_fx = vec4(strobeAt(t), beaconAt(t + 0.37), pow(0.5 + 0.5 * sin((u_time + i_misc.y * 7.0) * 18.85), 3.0), 0.0);
}`;

const FS = `
varying vec4 v_wn;
varying vec4 v_mp;
varying vec4 v_mn;
varying vec4 v_disc;
varying vec4 v_body;
varying vec4 v_tail;
varying vec4 v_fx;
uniform vec3 u_light;
uniform vec3 u_view;
uniform vec4 u_glassA; // noseY, zRef, sMin, sMax
uniform vec4 u_glassB; // lo, hi, kLo, kHi
uniform vec4 u_cabA;   // yStart, yEnd, pitch, enabled
uniform vec4 u_cabB;   // zRow, halfH, zRow2, halfW
uniform vec4 u_navL;   // light spill anchors: xyz, radius (0 = none)
uniform vec4 u_navR;
uniform vec4 u_bcnT;
uniform vec4 u_bcnB;
uniform vec4 u_logo;

#ifdef HAS_DERIV
float aaw(float x) { return max(fwidth(x) * 0.75, 1e-6); }
#else
float aaw(float x) { return 1e-4; }
#endif

float spill(vec3 p, vec4 a) {
  if (a.w <= 0.0) return 0.0;
  vec3 d = (p - a.xyz) / a.w;
  return exp(-dot(d, d) * 2.2);
}

vec3 shade(vec3 base, vec3 N, vec3 V, float spec, float shin, float night) {
  vec3 L = normalize(u_light);
  float ndl = dot(N, L);
  float diff = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
  float under = mix(0.74, 1.0, smoothstep(-0.75, 0.25, N.z));
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), shin) * spec * smoothstep(-0.05, 0.2, ndl);
  float sky = 0.5 + 0.5 * N.z;
  vec3 c = base * (0.45 + 0.6 * diff) * under + base * vec3(0.05, 0.065, 0.085) * sky + vec3(sp);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  c += vec3(0.62, 0.72, 0.85) * fres * 0.12;
  if (night > 0.0) {
    // moonlight: dim, cool, from high in the north-west, with a faint sky rim
    vec3 M = normalize(vec3(-0.35, 0.45, 0.82));
    float md = clamp((dot(N, M) + 0.25) / 1.25, 0.0, 1.0);
    vec3 Hm = normalize(M + V);
    float spm = pow(max(dot(N, Hm), 0.0), shin) * spec * 0.18;
    vec3 cn = base * (0.085 + 0.2 * md) * vec3(0.58, 0.66, 0.95) + vec3(spm) * vec3(0.6, 0.7, 1.0) + vec3(0.25, 0.32, 0.5) * fres * 0.08;
    c = mix(c, cn, night);
  }
  return c;
}

void main() {
  float m = floor(v_wn.w + 0.5);
  vec3 N = normalize(v_wn.xyz);
  vec3 V = normalize(u_view);
  float night = v_body.w;
  float lit = step(0.01, v_tail.w);
  float strobes = step(0.75, v_tail.w);
  float beacons = step(0.4, v_tail.w);

  if (m > 3.5 && m < 4.5) {
    // rotor / propeller disc: procedural blades, motion-blurred when spinning
    float r = length(v_disc.xy);
    if (r > 1.0) discard;
    float blades = max(v_disc.z, 1.0);
    float seg = 6.2831853 / blades;
    float a = mod(atan(v_disc.y, v_disc.x) + v_mn.w, seg);
    a = min(a, seg - a) * max(r, 0.05);
    float bw = mix(0.075, 0.04, r);
    float blade = (1.0 - smoothstep(bw * 0.6, bw, a)) * smoothstep(0.06, 0.12, r);
    float hub = 1.0 - smoothstep(0.08, 0.11, r);
    float rim = smoothstep(0.86, 0.97, r);
    float still = max(blade, hub);
    float blur = max(hub, 0.12 + 0.16 * rim + 0.08 * blade);
    float alpha = mix(still * 0.95, blur, v_disc.w) * (1.0 - smoothstep(0.975, 1.0, r));
    vec3 c = mix(vec3(0.12, 0.13, 0.15), vec3(0.6, 0.63, 0.68), v_disc.w * (1.0 - hub));
    c *= (0.75 + 0.25 * max(dot(N, normalize(u_light)), 0.0)) * mix(1.0, 0.22, night);
    outColor = vec4(c * alpha, alpha);
    return;
  }

  vec3 base = v_body.rgb;
  float spec = 0.22;
  float shin = 38.0;
  if (m > 0.5 && m < 1.5) base = v_tail.rgb;
  else if (m > 1.5 && m < 2.5) { base = vec3(0.07, 0.085, 0.11); spec = 0.55; shin = 80.0; }
  else if (m > 2.5 && m < 3.5) { base = vec3(0.76, 0.78, 0.81); spec = 0.42; shin = 55.0; }
  else if (m > 4.5 && m < 5.5) { base = vec3(0.70, 0.73, 0.77); spec = 0.3; shin = 45.0; }
  else if (m > 5.5 && m < 6.5) { base = vec3(0.04, 0.042, 0.046); spec = 0.05; shin = 12.0; }
  else if (m > 6.5 && m < 7.5) { base = vec3(0.15, 0.16, 0.175); spec = 0.2; shin = 30.0; }
  else if (m > 7.5) { base = m < 8.5 ? vec3(0.95, 0.5, 0.06) : m < 9.5 ? vec3(0.72, 0.05, 0.04) : vec3(0.9, 0.91, 0.88); spec = 0.6; shin = 70.0; }

  float win = 0.0;
  float glass = 0.0;
  if (m < 0.5) {
    // cockpit glass: s = distance from the nose, h = height above the reference line
    float s = u_glassA.x - v_mp.y;
    float h = v_mp.z - u_glassA.y;
    float g = min(min(s - u_glassA.z, u_glassA.w - s), min(h - (u_glassB.x + u_glassB.z * s), (u_glassB.y + u_glassB.w * s) - h));
    glass = smoothstep(-aaw(g), aaw(g), g);
    // cabin windows: dots when resolvable, a soft dark line when not
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

  vec3 c = shade(base, N, V, spec, shin, night);

  // exterior light spill on the airframe (mostly visible at night)
  vec3 p = v_mp.xyz;
  float sw = lit * mix(0.1, 1.0, night);
  vec3 em = vec3(1.0, 0.12, 0.06) * spill(p, u_navL) * 0.6 + vec3(0.12, 1.0, 0.35) * spill(p, u_navR) * 0.6;
  em += vec3(0.9, 0.95, 1.0) * (spill(p, u_navL) + spill(p, u_navR)) * v_fx.x * strobes * 1.2;
  em += vec3(1.0, 0.1, 0.04) * (spill(p, u_bcnT) + spill(p, u_bcnB)) * v_fx.y * beacons * 0.9;
  if (m > 0.5 && m < 1.5 && abs(p.x) < 0.05) em += vec3(1.0, 0.95, 0.86) * spill(p, u_logo) * 1.25 * night;
  c += base * em * sw;
  // warm cabin windows and a faint cockpit glow at night
  c = mix(c, vec3(1.0, 0.8, 0.5) * 0.95, win * night * lit * 0.85);
  c += vec3(0.25, 0.35, 0.45) * glass * night * lit * 0.12;
  if (m > 7.5) {
    // vehicle lamp lenses: beacons pulse with their rotating reflector, head / tail lamps glow at night
    vec3 lc = m < 8.5 ? vec3(1.0, 0.55, 0.08) : m < 9.5 ? vec3(1.0, 0.1, 0.06) : vec3(1.0, 0.97, 0.9);
    float on = m < 8.5 ? mix(0.3, 1.0, v_fx.z) * mix(0.55, 1.0, night) : night * 0.9;
    c = mix(c, lc * 1.25, clamp(on * lit, 0.0, 1.0));
  }

  if (v_mp.w > 0.5) {
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
    c = mix(c, vec3(0.424, 0.78, 1.0), 0.03 + 0.62 * fres);
  }
  outColor = vec4(c, 1.0);
}`;

const LVS = `
attribute vec4 a_lpos;   // xyz (model units), light type
attribute vec4 a_lparam; // glow diameter (m), base intensity
${INSTANCE_ATTRS}
uniform mat4 u_proj;
uniform float u_time;
uniform vec3 u_view;   // towards the camera, ENU
uniform vec3 u_viewW;  // towards the camera in instance-matrix space, scaled to the depth bias
uniform vec2 u_px;     // framebuffer px per metre at the reference depth, reference clip w
uniform vec2 u_pt;     // min, max point size (px)
varying vec4 v_col;
${COMMON}
void main() {
  float type = a_lpos.w;
  float night = i_tail.w;
  float g = clamp(i_anim.x, 0.0, 1.0);
  float t = u_time + i_misc.y * 1.2;
  vec3 col = vec3(1.0);
  float k = 0.0;
  float core = 1.0;
  float grow = 1.0;
  vec3 lp = a_lpos.xyz;
  if (type < 0.5) { col = vec3(1.0, 0.13, 0.07); k = mix(0.3, 1.0, night); }
  else if (type < 1.5) { col = vec3(0.1, 1.0, 0.4); k = mix(0.3, 1.0, night); }
  else if (type < 2.5) { col = vec3(1.0, 0.97, 0.92); k = mix(0.2, 0.8, night); }
  else if (type < 3.5) { float f = strobeAt(t); col = vec3(0.9, 0.95, 1.0); k = f * mix(1.1, 1.8, night); grow = 0.5 + 0.75 * f; }
  else if (type < 4.5) { float f = beaconAt(t + 0.37); col = vec3(1.0, 0.09, 0.04); k = f * mix(0.75, 1.15, night); grow = 0.7 + 0.4 * f; }
  else if (type < 5.5) {
    vec3 fwd = qrot(i_q, vec3(0.0, 1.0, 0.0));
    float face = smoothstep(-0.3, 0.9, dot(fwd, u_view));
    col = vec3(1.0, 0.96, 0.88);
    k = g * mix(0.5, 1.3, night) * mix(0.6, 1.35, face);
  }
  else if (type < 6.5) { col = vec3(1.0, 0.85, 0.6); k = g * mix(0.0, 0.55, night); core = 0.0; }
  else if (type < 7.5) { col = vec3(1.0, 0.93, 0.8); k = night * 0.3; core = 0.0; }
  else if (type < 8.5) {
    // rotating amber beacon: flashes as the reflector's beam sweeps past the viewer
    float ang = (u_time + i_misc.y * 7.0) * 9.42;
    vec3 beam = qrot(i_q, vec3(cos(ang), sin(ang), 0.0));
    float hv = length(u_view.xy);
    float side = pow(max(dot(beam.xy, u_view.xy / max(hv, 1e-3)), 0.0), 6.0);
    float f = mix(pow(0.5 + 0.5 * sin(ang * 2.0), 4.0), side, smoothstep(0.05, 0.3, hv));
    col = vec3(1.0, 0.55, 0.07);
    k = (0.14 + 1.05 * f) * mix(0.55, 1.2, night);
    grow = 0.65 + 0.55 * f;
  } else if (type < 9.5) {
    // headlamp: forward facing
    vec3 fwd = qrot(i_q, vec3(0.0, 1.0, 0.0));
    col = vec3(1.0, 0.95, 0.85);
    k = mix(0.05, 0.85, night) * mix(0.25, 1.2, smoothstep(-0.2, 0.9, dot(fwd, u_view)));
  } else if (type < 10.5) {
    // tail lamp: rear facing
    vec3 fwd = qrot(i_q, vec3(0.0, 1.0, 0.0));
    col = vec3(1.0, 0.08, 0.05);
    k = mix(0.04, 0.55, night) * mix(0.3, 1.0, smoothstep(-0.2, 0.9, -dot(fwd, u_view)));
  } else if (type < 11.5) {
    // de-icing spray: particles stream from the nozzle (+x and down), fan out and fade to mist
    float seed = a_lparam.z;
    float s = fract(u_time * 0.6 + seed * 7.31);
    float fan = (fract(seed * 31.7) - 0.5) * 0.8;
    float drop = 0.35 + fract(seed * 13.37) * 0.4;
    vec3 dir = normalize(vec3(1.0, fan, -drop));
    lp += (dir * (8.0 * s) + vec3(0.0, 0.0, -2.5 * s * s)) / max(i_misc.x, 1.0);
    col = mix(vec3(1.0, 0.8, 0.52), vec3(0.9, 0.94, 1.0), s);
    k = (1.0 - s) * smoothstep(0.0, 0.1, s) * mix(0.07, 0.15, night) * step(0.995, g);
    grow = 0.5 + 2.6 * s;
    core = 0.0;
  } else {
    // work floodlight on the de-icing basket (night, boom up)
    col = vec3(1.0, 0.9, 0.72);
    k = night * 0.5 * step(0.98, g);
    core = 0.0;
  }
  // lights level: 1 all, 0.5 taxi (no strobes, no landing beams), 0.25 parked (nav, logo only)
  float lv = i_misc.z;
  k *= step(0.01, lv) * a_lparam.y;
  if (type > 2.5 && type < 3.5) k *= step(0.75, lv);
  if (type > 3.5 && type < 5.5) k *= step(0.4, lv);
  if (type > 5.5 && type < 6.5) k *= step(0.75, lv);
  if (k < 0.004) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    v_col = vec4(0.0);
    return;
  }
  vec4 w = mat4(i_m0, i_m1, i_m2, i_m3) * vec4(lp, 1.0);
  w.xyz += u_viewW;
  gl_Position = u_proj * w;
  float px = a_lparam.x * grow * mix(0.6, 1.0, night) * u_px.x * u_px.y / max(gl_Position.w, 1e-6);
  float dim = clamp(px / u_pt.x, 0.35, 1.0);
  gl_PointSize = clamp(px, u_pt.x, u_pt.y);
  v_col = vec4(col * k * dim, core);
}`;

const LFS = `
varying vec4 v_col;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 >= 1.0) discard;
  float halo = exp(-r2 * mix(2.4, 4.5, v_col.w)) * (1.0 - r2);
  float core = exp(-r2 * 38.0) * v_col.w;
  float peak = max(max(v_col.r, v_col.g), v_col.b);
  vec3 c = v_col.rgb * (halo * 0.85 + core * 1.4) + vec3(core * peak * 0.75);
  outColor = vec4(c, 0.0);
}`;

function sources(webgl2: boolean, deriv: boolean, vs: string, fs: string): [string, string] {
  if (webgl2) {
    return [
      `#version 300 es\n#define attribute in\n#define varying out\n${vs}`,
      `#version 300 es\nprecision highp float;\n#define HAS_DERIV 1\n#define varying in\nout vec4 outColor;\n${fs}`,
    ];
  }
  return [
    `precision highp float;\n${vs}`,
    `${deriv ? '#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n' : ''}precision highp float;\n#define outColor gl_FragColor\n${fs}`,
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
  const a0 = ch, a1 = sh, a2 = 0, a3 = -sh * cp, a4 = ch * cp, a5 = sp, a6 = sh * sp, a7 = -ch * sp, a8 = cp; // columns
  // (Rz·Rx)·Ry, Ry columns: (cr,0,-sr), (0,1,0), (sr,0,cr)
  out[0] = a0 * cr - a6 * sr;
  out[1] = a1 * cr - a7 * sr;
  out[2] = a2 * cr - a8 * sr;
  out[3] = a3;
  out[4] = a4;
  out[5] = a5;
  out[6] = a0 * sr + a6 * cr;
  out[7] = a1 * sr + a7 * cr;
  out[8] = a2 * sr + a8 * cr;
}

/** Unit quaternion (x, y, z, w) of a column-major rotation matrix, written at out[o..o+3]. */
function quatFromMat3(m: Float64Array, out: Float32Array, o: number) {
  const m00 = m[0]!, m10 = m[1]!, m20 = m[2]!, m01 = m[3]!, m11 = m[4]!, m21 = m[5]!, m02 = m[6]!, m12 = m[7]!, m22 = m[8]!;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = w;
}

// ------------------------------------------------------------------ sun position
/** Per-instant solar terms (declination, right ascension, Greenwich sidereal angle). */
export interface SunFrame {
  sinDec: number;
  cosDec: number;
  /** Greenwich hour angle of the sun, degrees (local hour angle = gha + lon). */
  gha: number;
}

/** Low-precision solar position (≈0.01°, good for 1950–2050). */
export function sunFrame(timeMs: number): SunFrame {
  const d = timeMs / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const rd = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * rd;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rd;
  const e = (23.439 - 0.00000036 * d) * rd;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rd;
  const sinDec = Math.sin(e) * Math.sin(L);
  const gmst = 280.46061837 + 360.98564736629 * d;
  return { sinDec, cosDec: Math.sqrt(1 - sinDec * sinDec), gha: gmst - ra };
}

/** Sun altitude (degrees above the horizon) at a place for a precomputed SunFrame. */
export function sunAltitudeAt(f: SunFrame, lat: number, lon: number): number {
  const rd = Math.PI / 180;
  const la = lat * rd;
  const h = (f.gha + lon) * rd;
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(la) * f.sinDec + Math.cos(la) * f.cosDec * Math.cos(h)))) / rd;
}

/** Sun altitude in degrees at (lat, lon) and time (ms since epoch). */
export function sunAltitudeDeg(lat: number, lon: number, timeMs: number): number {
  return sunAltitudeAt(sunFrame(timeMs), lat, lon);
}

/** 0 by day … 1 at night: lights fade in from a 2° sun to full strength below about -4.5°. */
export function nightFactor(sunAltDeg: number): number {
  return smoothstep(2, -4.5, sunAltDeg);
}

// ------------------------------------------------------------------ GPU resources
type Vao = WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null;
type Mode = 'webgl2' | 'angle' | 'loop';

interface ShapeGpu {
  mesh: ModelMesh;
  vbo: WebGLBuffer;
  vao: Vao;
  lvbo: WebGLBuffer | null;
  lvao: Vao;
  lightCount: number;
}

interface Prog {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

interface Gpu {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  webgl2: boolean;
  mode: Mode;
  vaoExt: OES_vertex_array_object | null;
  inst: ANGLE_instanced_arrays | null;
  mesh: Prog;
  light: Prog;
  shapes: Map<string, ShapeGpu>; // key: shape|lod
  ibuf: WebGLBuffer;
  icap: number; // bytes allocated in ibuf
  maxPt: number;
}

const MESH_UNIFORMS = ['u_proj', 'u_time', 'u_light', 'u_view', 'u_glassA', 'u_glassB', 'u_cabA', 'u_cabB', 'u_navL', 'u_navR', 'u_bcnT', 'u_bcnB', 'u_logo'];
const LIGHT_UNIFORMS = ['u_proj', 'u_time', 'u_view', 'u_viewW', 'u_px', 'u_pt'];
const INSTANCE_NAMES = ['i_m0', 'i_m1', 'i_m2', 'i_m3', 'i_q', 'i_body', 'i_tail', 'i_anim', 'i_misc'];

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

function link(gl: WebGLRenderingContext, srcs: [string, string], attribs: string[], uniforms: string[]): Prog {
  const v = compile(gl, gl.VERTEX_SHADER, srcs[0]);
  const f = compile(gl, gl.FRAGMENT_SHADER, srcs[1]);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  attribs.forEach((name, i) => {
    if (name) gl.bindAttribLocation(prog, i, name);
  });
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`aircraft-models link: ${gl.getProgramInfoLog(prog) ?? ''}`);
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const n of uniforms) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

function createGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): Gpu {
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  if (maxAttribs < I_BASE + N_INST_ATTR) throw new Error(`only ${maxAttribs} vertex attributes`);
  const deriv = webgl2 || !!gl.getExtension('OES_standard_derivatives');
  const vaoExt = webgl2 ? null : gl.getExtension('OES_vertex_array_object');
  const inst = webgl2 ? null : gl.getExtension('ANGLE_instanced_arrays');
  const mode: Mode = webgl2 ? 'webgl2' : inst ? 'angle' : 'loop';
  const mesh = link(gl, sources(webgl2, deriv, VS, FS), ['a_pos', 'a_nrm', 'a_disc', 'a_part', 'a_axis', ...INSTANCE_NAMES], MESH_UNIFORMS);
  const light = link(gl, sources(webgl2, false, LVS, LFS), ['a_lpos', 'a_lparam', '', '', '', ...INSTANCE_NAMES], LIGHT_UNIFORMS);
  const ibuf = gl.createBuffer();
  if (!ibuf) throw new Error('createBuffer failed');
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const maxPt = range && range.length > 1 ? Math.max(1, range[1]!) : 64;
  return { gl, webgl2, mode, vaoExt, inst, mesh, light, shapes: new Map(), ibuf, icap: 0, maxPt };
}

function bindVao(g: Gpu, vao: Vao) {
  if (g.webgl2) (g.gl as WebGL2RenderingContext).bindVertexArray(vao as WebGLVertexArrayObject | null);
  else if (g.vaoExt) g.vaoExt.bindVertexArrayOES(vao as WebGLVertexArrayObjectOES | null);
}

function currentVao(g: Gpu): Vao {
  if (g.webgl2) return g.gl.getParameter((g.gl as WebGL2RenderingContext).VERTEX_ARRAY_BINDING) as Vao;
  if (g.vaoExt) return g.gl.getParameter(g.vaoExt.VERTEX_ARRAY_BINDING_OES) as Vao;
  return null;
}

function createVao(g: Gpu): Vao {
  if (g.webgl2) return (g.gl as WebGL2RenderingContext).createVertexArray();
  if (g.vaoExt) return g.vaoExt.createVertexArrayOES();
  return null;
}

function divisor(g: Gpu, loc: number, d: number) {
  if (g.webgl2) (g.gl as WebGL2RenderingContext).vertexAttribDivisor(loc, d);
  else if (g.inst) g.inst.vertexAttribDivisorANGLE(loc, d);
}

function meshAttribs(gl: WebGLRenderingContext, vbo: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const S = VF * 4;
  for (let i = 0; i < 5; i++) gl.enableVertexAttribArray(i);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, S, 0); // pos + material
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 16); // normal
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, S, 28); // disc
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, 40); // part
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, S, 56); // axis
}

function lightAttribs(gl: WebGLRenderingContext, vbo: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const S = LIGHT_STRIDE * 4;
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, S, 0);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, 16);
}

/** Points the instance attributes at instance `first` of the instance buffer (instanced modes). */
function instanceAttribs(g: Gpu, first: number) {
  const gl = g.gl;
  if (g.mode === 'loop') {
    for (let i = 0; i < N_INST_ATTR; i++) gl.disableVertexAttribArray(I_BASE + i);
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.ibuf);
  const base = first * IF * 4;
  for (let i = 0; i < N_INST_ATTR; i++) {
    const loc = I_BASE + i;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, IF * 4, base + i * 16);
    divisor(g, loc, 1);
  }
}

// ------------------------------------------------------------------ shape registry
// Aircraft shapes first (fixed), then shapes registered at run time (ground vehicles).
const SHAPES: string[] = [...MODEL_SHAPES];
const SHAPE_INDEX = new Map<string, number>(SHAPES.map((s, i) => [s, i]));
const N_AIRCRAFT_SHAPES = SHAPES.length;
const extraMeshes = new Map<string, (lod: number) => ModelMesh>();
/** Vehicles are small: they switch to finer meshes at this fraction of the aircraft LOD size. */
const EXTRA_LOD_SCALE = 0.35;

/** Registers extra mesh shapes (e.g. ground vehicles) drawn by every models layer. */
export function registerMeshes(shapes: readonly string[], get: (shape: string, lod: number) => ModelMesh) {
  for (const s of shapes) {
    if (!SHAPE_INDEX.has(s)) {
      SHAPE_INDEX.set(s, SHAPES.length);
      SHAPES.push(s);
    }
    extraMeshes.set(s, (lod) => get(s, lod));
  }
}

function meshOf(shape: string, lod = 0): ModelMesh {
  const extra = extraMeshes.get(shape);
  return extra ? extra(lod) : getModelMesh(shape as ModelShape, lod);
}

function shapeGpu(g: Gpu, shape: string, lod: number): ShapeGpu {
  const key = `${shape}|${lod}`;
  let s = g.shapes.get(key);
  if (s) return s;
  const gl = g.gl;
  const mesh = meshOf(shape, lod);
  const data = new Float32Array(mesh.vertexCount * VF);
  for (let v = 0; v < mesh.vertexCount; v++) {
    const o = v * VF;
    data[o] = mesh.positions[v * 3]!;
    data[o + 1] = mesh.positions[v * 3 + 1]!;
    data[o + 2] = mesh.positions[v * 3 + 2]!;
    data[o + 3] = mesh.colorIndex[v]!;
    data[o + 4] = mesh.normals[v * 3]!;
    data[o + 5] = mesh.normals[v * 3 + 1]!;
    data[o + 6] = mesh.normals[v * 3 + 2]!;
    data[o + 7] = mesh.disc[v * 3]!;
    data[o + 8] = mesh.disc[v * 3 + 1]!;
    data[o + 9] = mesh.disc[v * 3 + 2]!;
    for (let k = 0; k < 4; k++) {
      data[o + 10 + k] = mesh.part[v * 4 + k]!;
      data[o + 14 + k] = mesh.axis[v * 4 + k]!;
    }
  }
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('createBuffer failed');
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  let lvbo: WebGLBuffer | null = null;
  const full = meshOf(shape, 0); // light points are the same at every level of detail
  if (full.lightCount > 0) {
    lvbo = gl.createBuffer();
    if (!lvbo) throw new Error('createBuffer failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, lvbo);
    gl.bufferData(gl.ARRAY_BUFFER, full.lights, gl.STATIC_DRAW);
  }
  // VAOs hold the per-vertex layout; instance pointers are re-pointed per draw.
  const vao = createVao(g);
  const lvao = lvbo ? createVao(g) : null;
  if (vao) {
    bindVao(g, vao);
    meshAttribs(gl, vbo);
  }
  if (lvao && lvbo) {
    bindVao(g, lvao);
    lightAttribs(gl, lvbo);
  }
  s = { mesh, vbo, vao, lvbo, lvao, lightCount: full.lightCount };
  g.shapes.set(key, s);
  return s;
}

function destroyGpu(g: Gpu) {
  const gl = g.gl;
  if (gl.isContextLost()) return;
  const delVao = (v: Vao) => {
    if (!v) return;
    if (g.webgl2) (gl as WebGL2RenderingContext).deleteVertexArray(v as WebGLVertexArrayObject);
    else g.vaoExt?.deleteVertexArrayOES(v as WebGLVertexArrayObjectOES);
  };
  for (const s of g.shapes.values()) {
    gl.deleteBuffer(s.vbo);
    if (s.lvbo) gl.deleteBuffer(s.lvbo);
    delVao(s.vao);
    delVao(s.lvao);
  }
  gl.deleteBuffer(g.ibuf);
  gl.deleteProgram(g.mesh.prog);
  gl.deleteProgram(g.light.prog);
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
const NARROW = SHAPE_INDEX.get('narrow') ?? 0;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const num = (v: boolean | number | undefined, dflt: number) => (v === undefined ? dflt : typeof v === 'boolean' ? (v ? 1 : 0) : Math.min(1, Math.max(0, v)));

/** Adds a custom layer 'aircraft-models' (beforeId optional) that draws `source()` every frame. */
export function installModels(
  map: MlMap,
  source: () => ModelInstance[],
  opts?: { beforeId?: string; minZoom?: number; clock?: () => number },
): ModelsHandle {
  const minZoom = opts?.minZoom ?? 13.5;
  const clock = opts?.clock ?? Date.now;
  let enabled = true;
  let broken = false;
  let disposed = false;
  let gpu: Gpu | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stats: ModelsStats = { instances: 0, drawCalls: 0, cpuMs: 0, prepareMs: 0, mode: 'none' };

  const proj64 = new Float64Array(16);
  const base64 = new Float64Array(16);
  const model64 = new Float64Array(16);
  const flat64 = new Float64Array(16);
  const globe64 = new Float64Array(16);
  const mvpG64 = new Float64Array(16);
  const rot = new Float64Array(9);
  const proj32 = new Float32Array(16);
  // instance groups: shape index × 3 + level of detail (grows when shapes are registered)
  let counts = new Int32Array(SHAPES.length * 3);
  let starts = new Int32Array(SHAPES.length * 3);
  let data = new Float32Array(IF * 256);
  let stage = new Float32Array(IF * 256);
  let gid = new Int32Array(256);
  let pxPerM = 0; // framebuffer px per metre at the reference depth
  let wRef = 1; // clip w of the camera centre
  const hashes = new Map<string, number>();

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

  const hashOf = (id: string) => {
    let h = hashes.get(id);
    if (h === undefined) {
      if (hashes.size > 20_000) hashes.clear();
      h = hashId(id);
      hashes.set(id, h);
    }
    return h;
  };

  /**
   * Fills the instance buffer, grouped by shape and level of detail (counting sort through a
   * staging buffer). Returns the number of instances kept after culling.
   */
  const prepare = (
    list: ModelInstance[],
    pd: CustomRenderMethodInput['defaultProjectionData'],
    globe: boolean,
    transition: number,
    now: number,
    W: number,
    H: number,
    lodPx: number,
  ) => {
    if (stage.length < list.length * IF) {
      stage = new Float32Array(Math.max(list.length, (stage.length / IF) * 2) * IF);
      gid = new Int32Array(stage.length / IF);
    }
    if (counts.length < SHAPES.length * 3) {
      counts = new Int32Array(SHAPES.length * 3);
      starts = new Int32Array(SHAPES.length * 3);
    }
    const NG = counts.length;

    // per-frame origin: the camera centre in mercator units
    const c = MercatorCoordinate.fromLngLat(map.getCenter());
    const ox = c.x;
    const oy = c.y;
    const k0 = c.meterInMercatorCoordinateUnits();
    for (let i = 0; i < 16; i++) base64[i] = 0;
    base64[0] = k0;
    base64[5] = k0;
    base64[10] = k0;
    base64[12] = ox;
    base64[13] = oy;
    base64[15] = 1;
    mul4(globe ? pd.fallbackMatrix : pd.mainMatrix, base64, proj64);
    // screen scale: framebuffer px per metre at the camera centre (east / north, unforeshortened)
    const P = proj64;
    wRef = P[15]!;
    const sx0 = P[12]! / wRef;
    const sy0 = P[13]! / wRef;
    const pxE = Math.hypot(((P[0]! + P[12]!) / (P[3]! + wRef) - sx0) * W * 0.5, ((P[1]! + P[13]!) / (P[3]! + wRef) - sy0) * H * 0.5);
    const pxN = Math.hypot(((P[4]! + P[12]!) / (P[7]! + wRef) - sx0) * W * 0.5, ((P[5]! + P[13]!) / (P[7]! + wRef) - sy0) * H * 0.5);
    pxPerM = globe || !Number.isFinite(pxE + pxN) ? 0 : Math.max(pxE, pxN);
    const clipPlane = pd.clippingPlane;
    let sun: SunFrame | null = null;
    let kept = 0;

    for (let i = 0; i < list.length; i++) {
      const inst = list[i]!;
      const si = SHAPE_INDEX.get(inst.shape) ?? NARROW;
      const mesh = meshOf(SHAPES[si]!);
      const L = inst.lengthM > 0 ? inst.lengthM : 30;
      const ratio = inst.spanM > 0 ? inst.spanM / L / mesh.spanRatio : 1;
      const xs = Math.min(1.8, Math.max(0.55, ratio));
      enuRotation(inst.hdg, inst.pitch || 0, inst.roll || 0, rot);
      const sx = L * xs;

      // float64 mercator position, nearest world copy to the camera
      const latR = (inst.lat * Math.PI) / 180;
      const mx0 = (180 + inst.lon) / 360;
      const mx = mx0 + Math.round(ox - mx0);
      const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + latR / 2))) / 360;
      const k = 1 / (EARTH_CIRC * Math.cos(latR));
      const mz = inst.altM * k;
      const tx = (mx - ox) / k0;
      const ty = (my - oy) / k0;
      const tz = mz / k0;
      const r = k / k0;

      // cheap frustum reject on the model origin (generous margin for the airframe size)
      let cw: number, cx: number, cy: number;
      if (!globe) {
        cw = proj64[3]! * tx + proj64[7]! * ty + proj64[11]! * tz + proj64[15]!;
        cx = proj64[0]! * tx + proj64[4]! * ty + proj64[8]! * tz + proj64[12]!;
        cy = proj64[1]! * tx + proj64[5]! * ty + proj64[9]! * tz + proj64[13]!;
      } else {
        const lon = (inst.lon * Math.PI) / 180;
        const U = [Math.sin(lon) * Math.cos(latR), Math.sin(latR), Math.cos(lon) * Math.cos(latR)];
        if (clipPlane && U[0]! * clipPlane[0] + U[1]! * clipPlane[1] + U[2]! * clipPlane[2] + clipPlane[3] < 0) continue;
        // flat (absolute mercator) and globe placements, blended in clip space
        for (let col = 0; col < 3; col++) {
          const sc = (col === 0 ? sx : L) * k;
          model64[col * 4] = rot[col * 3]! * sc;
          model64[col * 4 + 1] = -rot[col * 3 + 1]! * sc;
          model64[col * 4 + 2] = rot[col * 3 + 2]! * sc;
          model64[col * 4 + 3] = 0;
        }
        model64[12] = mx;
        model64[13] = my;
        model64[14] = mz;
        model64[15] = 1;
        mul4(pd.fallbackMatrix, model64, flat64);
        const E = [Math.cos(lon), 0, -Math.sin(lon)];
        const Nn = [-Math.sin(lon) * Math.sin(latR), Math.cos(latR), -Math.cos(lon) * Math.sin(latR)];
        for (let col = 0; col < 3; col++) {
          const sc = (col === 0 ? sx : L) / GLOBE_RADIUS;
          const re = rot[col * 3]!, rn = rot[col * 3 + 1]!, ru = rot[col * 3 + 2]!;
          for (let row = 0; row < 3; row++) globe64[col * 4 + row] = (E[row]! * re + Nn[row]! * rn + U[row]! * ru) * sc;
          globe64[col * 4 + 3] = 0;
        }
        const e = 1 + inst.altM / GLOBE_RADIUS;
        globe64[12] = U[0]! * e;
        globe64[13] = U[1]! * e;
        globe64[14] = U[2]! * e;
        globe64[15] = 1;
        mul4(pd.mainMatrix, globe64, mvpG64);
        if (transition >= 0.999) flat64.set(mvpG64);
        else for (let j = 0; j < 16; j++) flat64[j] = flat64[j]! * (1 - transition) + mvpG64[j]! * transition;
        cw = flat64[15]!;
        cx = flat64[12]!;
        cy = flat64[13]!;
      }
      if (cw <= 0) continue;
      // projected length in px: picks the level of detail and widens the frustum test
      const lenPx = pxPerM > 0 ? (Math.max(L, inst.spanM || 0) * pxPerM * wRef) / cw : 0;
      if (pxPerM > 0) {
        const mx2 = 1.05 + (0.6 * lenPx) / (W * 0.5);
        const my2 = 1.05 + (0.6 * lenPx) / (H * 0.5);
        if (Math.abs(cx) > mx2 * cw || Math.abs(cy) > my2 * cw) continue;
      } else if (Math.abs(cx) > 2.5 * cw || Math.abs(cy) > 2.5 * cw) continue;
      const lp = si >= N_AIRCRAFT_SHAPES ? lodPx * EXTRA_LOD_SCALE : lodPx;
      const lod = globe || lenPx < lp * 0.36 ? 2 : lenPx < lp ? 1 : 0;

      gid[kept] = si * 3 + lod;
      const o = kept++ * IF;
      const data = stage;
      if (!globe) {
        for (let col = 0; col < 3; col++) {
          const sc = (col === 0 ? sx : L) * r;
          data[o + col * 4] = rot[col * 3]! * sc;
          data[o + col * 4 + 1] = -rot[col * 3 + 1]! * sc;
          data[o + col * 4 + 2] = rot[col * 3 + 2]! * sc;
          data[o + col * 4 + 3] = 0;
        }
        data[o + 12] = tx;
        data[o + 13] = ty;
        data[o + 14] = tz;
        data[o + 15] = 1;
      } else {
        for (let j = 0; j < 16; j++) data[o + j] = flat64[j]!;
      }
      quatFromMat3(rot, data, o + 16);
      const sel = inst.selected ? 1 : 0;
      data[o + 20] = inst.body[0];
      data[o + 21] = inst.body[1];
      data[o + 22] = inst.body[2];
      data[o + 23] = sel;
      let night: number;
      if (inst.night === undefined) {
        sun ??= sunFrame(clock());
        night = nightFactor(sunAltitudeAt(sun, inst.lat, inst.lon));
      } else night = num(inst.night, 0);
      data[o + 24] = inst.tail[0];
      data[o + 25] = inst.tail[1];
      data[o + 26] = inst.tail[2];
      data[o + 27] = night;
      const rpm = Math.max(0, inst.rotorRpm ?? 0);
      // apparent rotation capped so the blades never strobe at 30 fps
      const rate = Math.min(rpm / 60, 1.6) * Math.PI * 2;
      const h = hashOf(inst.id);
      data[o + 28] = num(inst.gear, 1);
      data[o + 29] = num(inst.flaps, 0);
      data[o + 30] = (h * 6.2831853 + now * rate) % (Math.PI * 2);
      data[o + 31] = smoothstep(20, 250, rpm);
      data[o + 32] = L;
      data[o + 33] = h;
      data[o + 34] = num(inst.lights, 1);
      data[o + 35] = 1 / xs;
    }

    // counting sort of the kept instances into contiguous (shape, lod) groups
    counts.fill(0);
    for (let i = 0; i < kept; i++) counts[gid[i]!]!++;
    let acc = 0;
    for (let gi = 0; gi < NG; gi++) {
      starts[gi] = acc;
      acc += counts[gi]!;
    }
    if (data.length < kept * IF) data = new Float32Array(Math.max(kept, (data.length / IF) * 2) * IF);
    counts.fill(0);
    for (let i = 0; i < kept; i++) {
      const gi = gid[i]!;
      data.set(stage.subarray(i * IF, i * IF + IF), (starts[gi]! + counts[gi]!++) * IF);
    }
    return kept;
  };

  const draw = (gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) => {
    if (!enabled || broken || disposed) return;
    if (map.getZoom() < minZoom) return;
    const t0 = performance.now();
    const list = source();
    if (!list.length) {
      stats.instances = 0;
      stats.drawCalls = 0;
      return;
    }
    if (gl.isContextLost()) {
      gpu = null;
      return;
    }
    if (!gpu || gpu.gl !== gl) gpu = createGpu(gl);
    const g = gpu;
    stats.mode = g.mode;

    const pd = args.defaultProjectionData;
    const transition = typeof pd.projectionTransition === 'number' ? pd.projectionTransition : 0;
    const globe = transition > 0;
    const now = performance.now() / 1000;
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const tp = performance.now();
    const used = prepare(list, pd, globe, transition, now, W, H, LOD_PX * dpr);
    stats.prepareMs = performance.now() - tp;

    // view direction (towards the camera) in ENU, shared by all instances
    const b = (map.getBearing() * Math.PI) / 180;
    const p = (map.getPitch() * Math.PI) / 180;
    const view: [number, number, number] = [-Math.sin(b) * Math.sin(p), -Math.cos(b) * Math.sin(p), Math.cos(p)];
    if (globe) proj32.set(IDENTITY);
    else for (let i = 0; i < 16; i++) proj32[i] = proj64[i]!;


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
      vao: currentVao(g),
      buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    };

    let drawn = 0;
    let calls = 0;
    let spinning = false;
    try {
      // upload instances
      gl.bindBuffer(gl.ARRAY_BUFFER, g.ibuf);
      const bytes = used * IF * 4;
      if (g.mode !== 'loop') {
        if (g.icap < bytes) {
          g.icap = Math.max(bytes, g.icap * 2, IF * 4 * 64);
          gl.bufferData(gl.ARRAY_BUFFER, g.icap, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, used * IF));
      }

      const groups: { s: ShapeGpu; first: number; n: number }[] = [];
      for (let gi = 0; gi < counts.length; gi++) {
        const n = counts[gi]!;
        if (n > 0) groups.push({ s: shapeGpu(g, SHAPES[Math.floor(gi / 3)]!, gi % 3), first: starts[gi]!, n });
        drawn += n;
      }

      const drawGroup = (mode: number, firstVertex: number, count: number, grp: { first: number; n: number }) => {
        calls++;
        if (g.mode === 'webgl2') (gl as WebGL2RenderingContext).drawArraysInstanced(mode, firstVertex, count, grp.n);
        else if (g.mode === 'angle') g.inst!.drawArraysInstancedANGLE(mode, firstVertex, count, grp.n);
        else {
          for (let i = 0; i < grp.n; i++) {
            const o = (grp.first + i) * IF;
            for (let a = 0; a < N_INST_ATTR; a++) gl.vertexAttrib4fv(I_BASE + a, data.subarray(o + a * 4, o + a * 4 + 4));
            gl.drawArrays(mode, firstVertex, count);
          }
        }
      };
      const bindMesh = (grp: (typeof groups)[number]) => {
        const s = grp.s;
        bindVao(g, s.vao);
        if (!s.vao) meshAttribs(gl, s.vbo);
        instanceAttribs(g, grp.first);
        const gl8 = s.mesh.glass ?? NO_GLASS;
        const cb = s.mesh.cabin;
        const u = g.mesh.u;
        gl.uniform4f(u.u_glassA!, gl8[0]!, gl8[1]!, gl8[2]!, gl8[3]!);
        gl.uniform4f(u.u_glassB!, gl8[4]!, gl8[5]!, gl8[6]!, gl8[7]!);
        if (cb) {
          gl.uniform4f(u.u_cabA!, cb[0]!, cb[1]!, cb[2]!, 1);
          gl.uniform4f(u.u_cabB!, cb[3]!, cb[4]!, cb[5]!, cb[6]!);
        } else {
          gl.uniform4f(u.u_cabA!, NO_CABIN[0]!, NO_CABIN[1]!, NO_CABIN[2]!, 0);
          gl.uniform4f(u.u_cabB!, NO_CABIN[4]!, NO_CABIN[5]!, NO_CABIN[6]!, NO_CABIN[7]!);
        }
        const an = s.mesh.anchors;
        gl.uniform4fv(u.u_navL!, an.navL);
        gl.uniform4fv(u.u_navR!, an.navR);
        gl.uniform4fv(u.u_bcnT!, an.beaconTop);
        gl.uniform4fv(u.u_bcnB!, an.beaconBottom);
        gl.uniform4fv(u.u_logo!, an.logo);
      };

      const time = now % TIME_WRAP;
      gl.useProgram(g.mesh.prog);
      gl.uniformMatrix4fv(g.mesh.u.u_proj!, false, proj32);
      gl.uniform1f(g.mesh.u.u_time!, time);
      gl.uniform3f(g.mesh.u.u_light!, LIGHT[0], LIGHT[1], LIGHT[2]);
      gl.uniform3f(g.mesh.u.u_view!, view[0], view[1], view[2]);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);

      // opaque pass
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      for (const grp of groups) {
        bindMesh(grp);
        drawGroup(gl.TRIANGLES, 0, grp.s.mesh.opaqueVertexCount, grp);
      }
      // translucent rotor / propeller discs
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const grp of groups) {
        const mesh = grp.s.mesh;
        if (mesh.opaqueVertexCount >= mesh.vertexCount) continue;
        for (let i = 0; i < grp.n && !spinning; i++) if (data[(grp.first + i) * IF + 31]! > 0) spinning = true;
        bindMesh(grp);
        drawGroup(gl.TRIANGLES, mesh.opaqueVertexCount, mesh.vertexCount - mesh.opaqueVertexCount, grp);
      }
      // additive light sprites
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(g.light.prog);
      const lu = g.light.u;
      gl.uniformMatrix4fv(lu.u_proj!, false, proj32);
      gl.uniform1f(lu.u_time!, time);
      gl.uniform3f(lu.u_view!, view[0], view[1], view[2]);
      const bias = globe ? 0 : 0.6; // metres towards the camera so lights clear their own surface
      gl.uniform3f(lu.u_viewW!, view[0] * bias, -view[1] * bias, view[2] * bias);
      gl.uniform2f(lu.u_px!, pxPerM, wRef);
      gl.uniform2f(lu.u_pt!, 2.4 * dpr, Math.max(2.4 * dpr, Math.min(g.maxPt, 0.22 * H)));
      for (const grp of groups) {
        const s = grp.s;
        if (!s.lvbo) continue;
        bindVao(g, s.lvao);
        if (!s.lvao) lightAttribs(gl, s.lvbo);
        instanceAttribs(g, grp.first);
        drawGroup(gl.POINTS, 0, s.lightCount, grp);
      }
    } finally {
      // restore
      if (!g.vaoExt && !g.webgl2) {
        for (let i = 0; i < I_BASE + N_INST_ATTR; i++) {
          if (i >= I_BASE) divisor(g, i, 0);
          gl.disableVertexAttribArray(i);
        }
      }
      bindVao(g, st.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
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
    stats.instances = drawn;
    stats.drawCalls = calls;
    stats.cpuMs = performance.now() - t0;
    // Keep animating while models are on screen (rotors spin, lights flash; positions are interpolated by the caller).
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
    stats() {
      return { ...stats };
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

/**
 * Demo instances around `center` ([lon, lat]), all heading north. By default one of every
 * shape in a 6 × 3 grid (row 1 parked, row 2 take-off flaps, row 3 landing flaps with gear in
 * transit). `count` > 18 lays out a larger grid of mixed shapes (performance testing).
 */
export function demoInstances(center: [number, number], opts?: { count?: number; night?: boolean | number; spacingM?: number }): ModelInstance[] {
  const [lon0, lat0] = center;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const count = opts?.count ?? DEMO.length;
  const cols = count <= DEMO.length ? 6 : Math.ceil(Math.sqrt(count));
  const dx = opts?.spacingM ?? (count <= DEMO.length ? 95 : 90);
  const dy = count <= DEMO.length ? 105 : dx;
  const rows = Math.ceil(count / cols);
  const out: ModelInstance[] = [];
  for (let i = 0; i < count; i++) {
    const [shape, lengthM, spanM, body, tail, rpm] = DEMO[i % DEMO.length]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const east = (col - (cols - 1) / 2) * dx;
    const north = ((rows - 1) / 2 - row) * dy;
    const phase = row % 3;
    out.push({
      id: count <= DEMO.length ? `demo-${shape}` : `demo-${i}`,
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
      selected: i === 0,
      gear: phase === 2 ? 0.6 : 1,
      flaps: phase === 0 ? 0 : phase === 1 ? 0.35 : 1,
      ...(opts?.night !== undefined ? { night: opts.night } : {}),
      ...(rpm !== undefined ? { rotorRpm: rpm } : {}),
    });
  }
  return out;
}

// Re-exported for callers that want to know whether a shape has spinning parts.
export function hasRotor(shape: ModelShape): boolean {
  const m = getModelMesh(shape);
  return m.opaqueVertexCount < m.vertexCount && m.colorIndex[m.vertexCount - 1] === MAT_ROTOR;
}
