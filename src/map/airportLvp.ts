// Airport lighting, part 2 (loaded on demand by airport3d.ts near an airport with OSM taxiways):
//   • Stop bars — red in-pavement lights across the taxiway at every runway-holding position
//     (OSM aeroway=holding_position, from /data/ground/<ICAO>.json), at right angles to the
//     taxiway the hold sits on (nearest taxi-graph edge). Lit in low-visibility procedures
//     (simAirportOps().lvp) at every hold, and at night at the holds serving the runways in use
//     (a hold serves a runway when it lies within ~120 m of that runway's centreline; runway ends
//     come from runways-major.json, the source the simulator uses). A bar drops — and green
//     lead-on lights come on beyond it — while an aircraft moves across it towards the runway.
//   • Runway guard lights ("wig-wags") — pairs of yellow lights either side of each lit stop
//     bar, flashing alternately.
//   • Follow the greens — in LVP, green taxiway centre-line lights switched on along the
//     selected aircraft's cleared taxi route up to the next lit stop bar (alternating green /
//     yellow close to a runway).
//   • De-icing pads (OSM aeroway=deicing_pad) are outlined when the buildings data carries them.

import type * as GeoJSON from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { simAirportOps, simTaxiPath } from '@/data/world';
import { traffic } from '@/state/traffic';
import { ui } from '@/state/ui';
import { LIGHT, localProjection, type GroundFile, type RunwayRow } from './airport3d';

type XY = [number, number];
type Projection = ReturnType<typeof localProjection>;

// ---------------------------------------------------------------- geometry (unit-tested)

/** Distance from p to segment ab, and the closest point. */
function segDist(p: XY, a: XY, b: XY): { d: number; q: XY } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const q: XY = [a[0] + dx * t, a[1] + dy * t];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

export interface RunwaySeg {
  a: XY;
  b: XY;
  idents: [string, string];
}

/** Runway centrelines (local metres) from runways-major rows. */
export function runwaySegments(rows: RunwayRow[], P: Projection): RunwaySeg[] {
  return rows.filter((r) => r[1] && r[5]).map((r) => ({ a: P.fwd(r[1], r[2]), b: P.fwd(r[5], r[6]), idents: [r[0], r[4]] }));
}

export interface HoldBar {
  ref: string;
  /** Hold position (local metres). */
  p: XY;
  /** Taxiway direction at the hold (unit). */
  dir: XY;
  /** Idents (both ends) of the runways whose centreline lies within 120 m. */
  runways: string[];
  /** Unit vector from the hold towards the nearest runway centreline point (or along the taxiway). */
  toRunway: XY;
  /** Stop-bar light positions across the taxiway (local metres). */
  lights: XY[];
  /** Runway guard light positions either side. */
  guards: [XY, XY];
}

const SERVE_M = 120;
const BAR_HALF = 10.5; // lights every 3 m across a ~23 m taxiway
const GUARD_OFF = 14;

/** Stop bars for every OSM holding position of an airport (local metres). */
export function holdBars(ground: GroundFile, rows: RunwayRow[], P: Projection): HoldBar[] {
  const holds = ground.holds ?? [];
  if (!holds.length) return [];
  const pts = ground.nodes.map(([la, lo]) => P.fwd(la, lo));
  const rws = runwaySegments(rows, P);
  const out: HoldBar[] = [];
  for (const [la, lo, ref] of holds) {
    const p = P.fwd(la, lo);
    // the taxiway it sits on: nearest graph edge
    let best = 40;
    let dir: XY | null = null;
    for (const [i, j] of ground.edges) {
      const a = pts[i];
      const b = pts[j];
      if (!a || !b) continue;
      if (Math.abs(a[0] - p[0]) > 300 || Math.abs(a[1] - p[1]) > 300) continue;
      const { d } = segDist(p, a, b);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < best && l > 1) {
        best = d;
        dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      }
    }
    let near: { d: number; q: XY } | null = null;
    const runways: string[] = [];
    for (const r of rws) {
      const s = segDist(p, r.a, r.b);
      if (s.d < SERVE_M) runways.push(...r.idents);
      if (!near || s.d < near.d) near = s;
    }
    const toR: XY = near && near.d > 1 ? [(near.q[0] - p[0]) / near.d, (near.q[1] - p[1]) / near.d] : dir ?? [1, 0];
    // no taxiway edge found: assume it meets the runway at right angles
    const d = dir ?? toR;
    const n: XY = [-d[1], d[0]];
    const lights: XY[] = [];
    for (let t = -BAR_HALF; t <= BAR_HALF + 1e-6; t += 3) lights.push([p[0] + n[0] * t, p[1] + n[1] * t]);
    out.push({
      ref,
      p,
      dir: d,
      runways,
      toRunway: toR,
      lights,
      guards: [
        [p[0] + n[0] * GUARD_OFF, p[1] + n[1] * GUARD_OFF],
        [p[0] - n[0] * GUARD_OFF, p[1] - n[1] * GUARD_OFF],
      ],
    });
  }
  return out;
}

/** Which stop bars are lit: all of them in LVP, else (at night) those serving a runway in use. */
export function litBars(bars: HoldBar[], o: { lvp: boolean; night: number; inUse: string[] }): HoldBar[] {
  if (o.lvp) return bars;
  if (o.night < 0.05) return [];
  return bars.filter((b) => b.runways.some((r) => o.inUse.includes(r)));
}

/** Points every `step` metres along a polyline, up to `max` metres. */
function along(line: XY[], step: number, max: number, start = 0): XY[] {
  const out: XY[] = [];
  let next = start;
  let acc = 0;
  for (let i = 0; i < line.length - 1 && next <= max; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= acc + l && next <= max) {
      const t = (next - acc) / l;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += step;
    }
    acc += l;
  }
  return out;
}

// ---------------------------------------------------------------- map layers

const SRC = 'apt-stopbar';
const SRC_G = 'apt-guard';
const SRC_PAD = 'apt-deice-pad';
const LAYERS = ['apt-stopbar-bloom', 'apt-stopbar', 'apt-guard-bloom', 'apt-guard'] as const;
const PAD_LAYERS = ['apt-deice-pad-fill', 'apt-deice-pad-line'] as const;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

interface AirportCtx {
  icao: string;
  P: Projection;
  bars: HoldBar[];
  rws: RunwaySeg[];
  lat: number;
  lon: number;
}

const st = {
  map: null as MlMap | null,
  ctx: null as AirportCtx | null,
  night: 0,
  sig: '',
  guardIds: [[], []] as number[][],
  guardPhase: -1,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  flasher: undefined as ReturnType<typeof setInterval> | undefined,
  lit: false,
};

const size = (k: number) =>
  ['interpolate', ['exponential', 1.6], ['zoom'], 10, ['*', 0.5 * k, ['get', 'r']], 13, ['*', 1.25 * k, ['get', 'r']], 15, ['*', 2.3 * k, ['get', 'r']], 17, ['*', 4.4 * k, ['get', 'r']], 19, ['*', 8.5 * k, ['get', 'r']]] as unknown as number;

/** Sources and layers (idempotent; again after a style swap). */
export function installLvp(map: MlMap, before?: string) {
  st.map = map;
  const b = before && map.getLayer(before) ? before : undefined;
  for (const id of [SRC, SRC_G, SRC_PAD]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const circle = (id: string, source: string, radius: number, blur: number, color: unknown, opacity: unknown) => {
    if (map.getLayer(id)) return;
    map.addLayer(
      {
        id,
        type: 'circle',
        source,
        minzoom: 12,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': radius, 'circle-color': color as string, 'circle-blur': blur, 'circle-opacity': opacity as number, 'circle-pitch-alignment': 'map' },
      },
      b,
    );
  };
  const flash = ['case', ['boolean', ['feature-state', 'on'], false], 1, 0.08] as ExpressionSpecification;
  circle(LAYERS[0], SRC, size(4.4), 1, ['get', 'c'], ['*', 0.5, ['get', 'o']]);
  circle(LAYERS[1], SRC, size(1.05), 0.4, ['get', 'c'], ['get', 'o']);
  circle(LAYERS[2], SRC_G, size(5.5), 1, LIGHT.yellow, ['*', 0.6, flash]);
  circle(LAYERS[3], SRC_G, size(1.3), 0.35, LIGHT.yellow, flash);
  if (!map.getLayer(PAD_LAYERS[0]))
    map.addLayer({ id: PAD_LAYERS[0], type: 'fill', source: SRC_PAD, minzoom: 13, paint: { 'fill-color': '#e08a2c', 'fill-opacity': 0.08 } }, b);
  if (!map.getLayer(PAD_LAYERS[1]))
    map.addLayer({ id: PAD_LAYERS[1], type: 'line', source: SRC_PAD, minzoom: 13, paint: { 'line-color': '#ffb066', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } }, b);
  st.sig = '';
  st.guardPhase = -1;
  refresh();
}

/** The airport whose lights are on screen (null: none). */
export function setLvpAirport(map: MlMap, a: { icao: string; rows: RunwayRow[]; ground: GroundFile | null; lat: number; lon: number } | null) {
  st.map = map;
  if (!a || !a.ground) st.ctx = null;
  else if (st.ctx?.icao !== a.icao) {
    const P = localProjection(a.lat, a.lon);
    st.ctx = { icao: a.icao, P, bars: holdBars(a.ground, a.rows, P), rws: runwaySegments(a.rows, P), lat: a.lat, lon: a.lon };
  }
  st.timer ??= setInterval(refresh, 1500);
  refresh();
}

export function setLvpNight(night: number) {
  if (Math.abs(night - st.night) < 0.01) return;
  st.night = night;
  refresh();
}

/** De-icing pad outlines ([lon, lat] rings) from the buildings data, when it has them. */
export function setDeicePads(map: MlMap, pads: [number, number][][] | undefined) {
  (map.getSource(SRC_PAD) as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: (pads ?? []).filter((r) => r.length >= 4).map((r) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [r] }, properties: {} })),
  });
}

export function disposeLvp() {
  if (st.timer) clearInterval(st.timer);
  if (st.flasher) clearInterval(st.flasher);
  st.timer = undefined;
  st.flasher = undefined;
  st.ctx = null;
}

const hdgDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

function refresh() {
  const map = st.map;
  if (!map || !map.getSource(SRC)) return;
  const ctx = st.ctx;
  const z = map.getZoom();
  const c = map.getCenter();
  const near = !!ctx && z >= 12 && Math.abs(c.lat - ctx.lat) < 0.08 && Math.abs(c.lng - ctx.lon) < 0.12;
  const ops = near ? simAirportOps(ctx.icao) : undefined;
  const lvp = !!ops?.lvp;
  const lit = near && ops ? litBars(ctx.bars, { lvp, night: st.night, inUse: [ops.arrRunway, ops.depRunway].filter(Boolean) }) : [];
  // bars an aircraft is crossing (moving towards the runway) are dropped for it
  const dropped = new Set<HoldBar>();
  if (ctx && lit.length) {
    const now = Date.now();
    const box = 0.03;
    for (const t of traffic.tracks.values()) {
      const a = t.ac;
      if (!a.onGround || (a.groundSpeed ?? 0) < 3) continue;
      const pos = traffic.displayPosition(t, now);
      if (Math.abs(pos.lat - ctx.lat) > box || Math.abs(pos.lon - ctx.lon) > box * 1.6) continue;
      const q = ctx.P.fwd(pos.lat, pos.lon);
      const trk = pos.trk ?? a.track ?? 0;
      for (const b of lit) {
        if (Math.hypot(q[0] - b.p[0], q[1] - b.p[1]) > 50) continue;
        const brg = (Math.atan2(b.toRunway[0], b.toRunway[1]) * 180) / Math.PI;
        if (hdgDiff(trk, brg) < 70) dropped.add(b);
      }
    }
  }
  const P = ctx?.P;
  const features: GeoJSON.Feature[] = [];
  const guards: GeoJSON.Feature[] = [];
  const pt = (p: XY, props: Record<string, unknown>, id?: number): GeoJSON.Feature => {
    const [lon, lat] = P!.inv(p[0], p[1]);
    const f: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7] }, properties: props };
    if (id !== undefined) f.id = id;
    return f;
  };
  const ease = lvp ? 1 : st.night * st.night * (3 - 2 * st.night);
  const nearRunway = (p: XY) => (ctx?.rws ?? []).some((r) => segDist(p, r.a, r.b).d < 75);
  const groups: number[][] = [[], []];
  for (const b of lit) {
    if (dropped.has(b)) {
      // lead-on: greens beyond the dropped bar onto the runway
      for (let i = 0; i < 4; i++) {
        const p: XY = [b.p[0] + b.toRunway[0] * (7 + 15 * i), b.p[1] + b.toRunway[1] * (7 + 15 * i)];
        features.push(pt(p, { c: i % 2 ? LIGHT.yellow : LIGHT.green, r: 0.7, o: ease }));
      }
    } else for (const p of b.lights) features.push(pt(p, { c: LIGHT.red, r: 0.75, o: ease }));
    b.guards.forEach((p, k) => {
      const id = guards.length;
      groups[k]!.push(id);
      guards.push(pt(p, { r: 0.8 }, id));
    });
  }
  // follow the greens for the selected aircraft (LVP)
  if (lvp && ctx) {
    const path = simTaxiPath(ui().selectedId)?.path;
    if (path && path.length > 1) {
      const line = path.map(([lon, lat]) => ctx.P.fwd(lat, lon));
      const stops = lit.filter((b) => !dropped.has(b));
      let i = 0;
      for (const p of along(line, 15, 1200, 10)) {
        if (stops.some((b) => Math.hypot(p[0] - b.p[0], p[1] - b.p[1]) < 18)) break;
        features.push(pt(p, { c: nearRunway(p) && i % 2 ? LIGHT.yellow : LIGHT.green, r: 0.6, o: ease }));
        i++;
      }
    }
  }
  const sig = `${features.length}|${guards.length}|${ease.toFixed(2)}|${features
    .slice(0, 400)
    .map((f) => (f.geometry as GeoJSON.Point).coordinates.join(','))
    .join(';')}`;
  if (sig !== st.sig) {
    st.sig = sig;
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    if (map.getSource(SRC_G)) map.removeFeatureState({ source: SRC_G });
    (map.getSource(SRC_G) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: guards });
    st.guardIds = groups;
    st.guardPhase = -1;
  }
  const on = features.length > 0 || guards.length > 0;
  if (on !== st.lit) {
    st.lit = on;
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
  // wig-wag: the two lights of each pair alternate about once a second
  const flashing = on && guards.length > 0 && !document.hidden;
  if (flashing && !st.flasher) st.flasher = setInterval(flash, 500);
  else if (!flashing && st.flasher) {
    clearInterval(st.flasher);
    st.flasher = undefined;
  }
}

function flash() {
  const map = st.map;
  if (!map || !map.getSource(SRC_G)) return;
  const phase = Math.floor(Date.now() / 500) % 2;
  if (phase === st.guardPhase) return;
  st.guardPhase = phase;
  for (const [k, ids] of st.guardIds.entries()) for (const id of ids) map.setFeatureState({ source: SRC_G, id }, { on: k === phase });
}
