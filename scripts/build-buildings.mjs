// Builds accurate 3D airport buildings from OpenStreetMap (ODbL) via Overpass:
//   public/data/buildings/<ICAO>.json — GeoJSON FeatureCollection of extrusion-ready polygons
//     properties: kind, height_m, min_height_m, [part], [colour], [roof_colour], [material], [name], [osm]
//   public/data/buildings/index.json   — { v, airports: { ICAO: [lat, lon, s, w, n, e, features] } }
//
//   node scripts/build-buildings.mjs                 (resumable; the output is committed)
//   BUILDINGS_BUDGET_MIN=120 BUILDINGS_ONLY=EGLL,KJFK node scripts/build-buildings.mjs
//
// Airports: those with a v2 ground file in public/data/ground/, busiest first. Files already
// built (v1) are skipped, so a run resumes where the last one stopped.
//
// Heights follow the OSM Simple 3D Buildings conventions: `height`/`min_height` tags (metres,
// feet or feet-inches), else `building:levels` × 3.6 m (+ `roof:height`), else defaults by type.
// Outlines that carry `building:part`s are dropped in favour of their parts. Control towers
// get a shaft, a glazed cab and a roof cap; jet bridges (lines) are buffered to 3 m wide.
// Every polygon is grown outward by ~0.5 m so it encloses the base map's own footprint of
// the same building (no z-fighting between the two extrusion layers).
//
// Overpass etiquette (https://wiki.openstreetmap.org/wiki/Overpass_API): an identifying
// User-Agent, ONE query at a time, ≥ 10 s between queries, 60 s back-off on 429/502/504
// and a time budget per run. Other build scripts may be querying too — so we stay polite.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/buildings');
const GROUND = join(ROOT, 'public/data/ground');
const UA = 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const VERSION = 1;
// Raw Overpass answers are kept outside the repo so the features can be rebuilt offline
// (BUILDINGS_REBUILD=1) without asking Overpass again.
const CACHE = process.env.BUILDINGS_CACHE ?? join(tmpdir(), 'arnav-osm-buildings');
const D2R = Math.PI / 180;
const M_PER_DEG = 111_320;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** Parses an OSM length ("12", "12 m", "12.5m", "40'", "40 ft", "12'6\"", "12,5") to metres. */
export function parseLength(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  if (!s) return undefined;
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''))?$/);
  if (m) return round1(Number(m[1]) * 0.3048 + Number(m[2] ?? 0) * 0.0254);
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot|km)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2] ?? 'm';
  if (unit === 'ft' || unit === 'feet' || unit === 'foot') return round1(n * 0.3048);
  if (unit === 'km') return round1(n * 1000);
  return round1(n);
}
const round1 = (n) => Math.round(n * 10) / 10;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

const LEVEL_M = 3.6;
export const DEFAULT_HEIGHT = { terminal: 18, pier: 12, hangar: 22, cargo: 14, parking: 15, hotel: 30, office: 15, other: 7, control_tower: 45, jet_bridge: 6.5 };

/** Classifies a building from its tags (and an optional parent's kind for building:part). */
export function classify(tags, parentKind) {
  const t = tags ?? {};
  const aw = t.aeroway;
  const b = t.building ?? t['building:part'] ?? '';
  const label = `${t.name ?? ''} ${t['name:en'] ?? ''} ${t.terminal ?? ''} ${t.description ?? ''}`.toLowerCase();
  if (aw === 'jet_bridge') return 'jet_bridge';
  if (aw === 'control_tower' || (aw === 'tower' && !/water/.test(label)) || t['tower:type'] === 'airport_control' || t.service === 'aircraft_control' || (t.man_made === 'tower' && /control|atc|tower\s*cab|kontroll|torre de control|tour de contr/.test(label)))
    return 'control_tower';
  if (parentKind && parentKind !== 'other' && t['building:part']) return parentKind;
  if (/\b(pier|concourse|satellite|finger)\b/.test(label) || b === 'concourse') return 'pier';
  if (aw === 'terminal' || b === 'terminal' || t.terminal === 'yes') return 'terminal';
  if (aw === 'hangar' || b === 'hangar') return 'hangar';
  if (b === 'parking' || t.parking === 'multi-storey' || (t.amenity === 'parking' && b)) return 'parking';
  if (/cargo|freight|fracht|logisti|\bmail\b|dhl|fedex|\bups\b/.test(label) || b === 'cargo') return 'cargo';
  if (b === 'hotel' || t.tourism === 'hotel') return 'hotel';
  if (b === 'office' || b === 'commercial' || t.office) return 'office';
  if (aw === 'gate') return 'pier';
  if (b === 'transportation' && /terminal/.test(label)) return 'terminal';
  if (parentKind) return parentKind;
  return 'other';
}

/** Height and base (metres) per the Simple 3D Buildings rules, with type defaults. */
export function buildingHeights(tags, kind) {
  const t = tags ?? {};
  const roof = parseLength(t['roof:height']) ?? 0;
  let h = parseLength(t.height) ?? parseLength(t['building:height']);
  const levels = Number(String(t['building:levels'] ?? '').replace(',', '.'));
  if (h === undefined && Number.isFinite(levels) && levels > 0) h = round1(levels * LEVEL_M + roof);
  if (h === undefined) {
    if (kind === 'parking' && Number.isFinite(levels) && levels > 0) h = levels * 3;
    else h = DEFAULT_HEIGHT[kind] ?? DEFAULT_HEIGHT.other;
  }
  let mh = parseLength(t.min_height) ?? parseLength(t['building:min_height']);
  const minLevel = Number(String(t['building:min_level'] ?? t.min_level ?? '').replace(',', '.'));
  if (mh === undefined && Number.isFinite(minLevel) && minLevel > 0) mh = round1(minLevel * LEVEL_M);
  mh = Math.max(0, mh ?? 0);
  h = Math.min(Math.max(h, 2), 600);
  if (mh >= h) mh = Math.max(0, h - 1);
  return { height: round1(h), min: round1(mh) };
}

/** Local metric projection around a reference latitude: [lon,lat] ↔ [x,y] metres. */
function projector(lat0, lon0) {
  const k = Math.cos(lat0 * D2R) * M_PER_DEG;
  return {
    fwd: ([lon, lat]) => [(lon - lon0) * k, (lat - lat0) * M_PER_DEG],
    inv: ([x, y]) => [lon0 + x / k, lat0 + y / M_PER_DEG],
  };
}

/** Signed area in m² of a closed [lon,lat] ring (positive = counter-clockwise). */
export function ringArea(ring) {
  if (ring.length < 4) return 0;
  const p = projector(ring[0][1], ring[0][0]);
  const pts = ring.map(p.fwd);
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return a / 2;
}

const close = (ring) => {
  const f = ring[0];
  const l = ring[ring.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
};

/**
 * Offsets a closed [lon,lat] ring by `d` metres: outward for a counter-clockwise ring (an
 * outer boundary), and — because holes are clockwise — shrinks a hole. Mitred joins, capped
 * at 3 × d so sharp corners do not spike.
 */
export function offsetRing(ring, d) {
  const r = close(ring);
  const n = r.length - 1;
  if (n < 3 || d === 0) return r;
  const p = projector(r[0][1], r[0][0]);
  const pts = r.slice(0, n).map(p.fwd);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const n1 = rightNormal(a, b);
    const n2 = rightNormal(b, c);
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * n1[0] + my * n1[1];
    const len = Math.min(Math.abs(d) * 3, Math.abs(d) / Math.max(cos, 1e-6)) * Math.sign(d);
    out.push(p.inv([b[0] + mx * len, b[1] + my * len]));
  }
  out.push(out[0]);
  return out;
}
/** Unit normal to the right of travel a→b — the outside of a counter-clockwise ring. */
function rightNormal(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/** Douglas–Peucker on a closed ring, tightening until it has at most `max` vertices. */
export function simplifyRing(ring, max = 64) {
  let r = close(ring);
  const p = projector(r[0][1], r[0][0]);
  const pts = r.map(p.fwd);
  // Drop consecutive duplicates.
  const uniq = [pts[0]];
  const src = [r[0]];
  for (let i = 1; i < pts.length; i++) {
    const q = uniq[uniq.length - 1];
    if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) > 0.05 || i === pts.length - 1) {
      uniq.push(pts[i]);
      src.push(r[i]);
    }
  }
  let tol = 0.15;
  let keep = dp(uniq, tol);
  while (keep.length > max && tol < 500) {
    tol *= 1.6;
    keep = dp(uniq, tol);
  }
  r = keep.map((i) => src[i]);
  return close(r.length >= 4 ? r : src);
}
function dp(pts, tol) {
  const n = pts.length;
  if (n <= 4) return pts.map((_, i) => i);
  // Split the closed ring at the vertex farthest from the first one.
  let far = 1;
  let fd = -1;
  for (let i = 1; i < n - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const mark = new Uint8Array(n);
  mark[0] = mark[far] = mark[n - 1] = 1;
  const stack = [
    [0, far],
    [far, n - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      mark[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (mark[i]) out.push(i);
  return out;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Buffers a [lon,lat] polyline into a closed polygon `width` metres wide (mitred, flat ends). */
export function bufferLine(line, width) {
  if (line.length < 2) return [];
  const p = projector(line[0][1], line[0][0]);
  const pts = line.map(p.fwd);
  const h = width / 2;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[i];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    const n1 = i > 0 ? rightNormal(a, b) : rightNormal(b, c);
    const n2 = i < pts.length - 1 ? rightNormal(b, c) : n1;
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = Math.max(mx * n1[0] + my * n1[1], 0.35);
    const len = h / cos;
    right.push(p.inv([b[0] + mx * len, b[1] + my * len]));
    left.push(p.inv([b[0] - mx * len, b[1] - my * len]));
  }
  // Counter-clockwise: right side forward, left side back.
  const ring = [...right, ...left.reverse()];
  ring.push(ring[0]);
  return ringArea(ring) < 0 ? ring.reverse() : ring;
}

/** A regular polygon (counter-clockwise) of `r` metres around [lon,lat]. */
export function circle(center, r, sides = 16) {
  const p = projector(center[1], center[0]);
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push(p.inv([Math.cos(a) * r, Math.sin(a) * r]));
  }
  out.push(out[0]);
  return out;
}

/** Scales a ring about its centroid (used for tower shafts inside their cab outline). */
function scaleRing(ring, f) {
  const c = ringCentroid(ring);
  return ring.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]);
}
export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
export function pointInRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Orients rings (outer CCW, holes CW), grows by `grow` m, simplifies and rounds. */
export function finishPolygon(rings, grow = 0.5) {
  const out = [];
  rings.forEach((ring, i) => {
    let r = close(ring);
    const a = ringArea(r);
    if ((i === 0 && a < 0) || (i > 0 && a > 0)) r = [...r].reverse();
    r = simplifyRing(r, 64);
    if (grow) r = offsetRing(r, grow);
    out.push(r.map(([x, y]) => [r5(x), r5(y)]));
  });
  return out;
}

const COLOUR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;
function colourOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return COLOUR.test(s) ? s : undefined;
}

// ---------------------------------------------------------------- OSM element → features

/** Joins member ways (as [lon,lat] lists) into closed rings. */
export function stitch(segments) {
  const segs = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (segs.length) {
    let cur = segs.shift();
    let grew = true;
    while (!same(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = cur[cur.length - 1];
        if (same(end, s[0])) cur = cur.concat(s.slice(1));
        else if (same(end, s[s.length - 1])) cur = cur.concat([...s].reverse().slice(1));
        else if (same(cur[0], s[s.length - 1])) cur = s.slice(0, -1).concat(cur);
        else if (same(cur[0], s[0])) cur = [...s].reverse().slice(0, -1).concat(cur);
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

/** Polygons ([outer, ...holes]) of an Overpass `out geom` element. */
function polygonsOf(el) {
  const ll = (g) => [g.lon, g.lat];
  if (el.type === 'way') {
    const g = (el.geometry ?? []).map(ll);
    if (g.length >= 4 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]) return [[g]];
    return [];
  }
  if (el.type === 'relation' && el.tags?.type === 'multipolygon') {
    const mem = el.members ?? [];
    const outers = stitch(mem.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map(ll)));
    const inners = stitch(mem.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry.map(ll)));
    return outers.map((o) => [o, ...inners.filter((h) => pointInRing(h[0], o))]);
  }
  return [];
}

/**
 * Turns Overpass elements into extrusion features. `keep(lonlat)` optionally limits the
 * output to the aerodrome (used when no aerodrome area could be resolved).
 */
export function buildFeatures(elements, keep = () => true) {
  const items = [];
  const towerNodes = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'relation' && t.type === 'building') continue; // members come separately
    if (skipTags(t)) continue;
    if (el.type === 'node') {
      if (classify(t) === 'control_tower' && keep([el.lon, el.lat], t)) towerNodes.push({ el, kind: 'control_tower', polys: [[circle([el.lon, el.lat], 6)]], node: true });
      continue;
    }
    if (t.aeroway === 'jet_bridge' && el.type === 'way') {
      const line = (el.geometry ?? []).map((g) => [g.lon, g.lat]);
      const closed = line.length >= 4 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
      const poly = closed && Math.abs(ringArea(line)) > 20 ? line : bufferLine(line, 3);
      if (poly.length >= 4 && keep(line[0], t)) items.push({ el, kind: 'jet_bridge', polys: [[poly]] });
      continue;
    }
    const polys = polygonsOf(el);
    if (!polys.length) continue;
    const isPart = !!t['building:part'] && !t.building;
    const kind = classify(t);
    for (const poly of polys) {
      if (!keep(ringCentroid(poly[0]), t)) continue;
      items.push({ el, kind, polys: [poly], part: isPart, area: Math.abs(ringArea(poly[0])) });
    }
  }

  // Control towers modelled in 3D (slender parts with explicit heights near the tower): keep
  // the mapper's model, mark its top as the cab and skip the synthetic tower.
  for (const tw of [...towerNodes, ...items.filter((i) => i.kind === 'control_tower' && !i.part)]) {
    const c = tw.node ? [tw.el.lon, tw.el.lat] : ringCentroid(tw.polys[0][0]);
    const near = items.filter((i) => i !== tw && i.kind !== 'jet_bridge' && i.area < 2500 && parseLength(i.el.tags?.height) >= 25 && distM(c, ringCentroid(i.polys[0][0])) < 60);
    if (near.length >= 2 || near.some((i) => parseLength(i.el.tags?.min_height) >= 20)) {
      tw.modelled = true;
      const top = Math.max(...near.map((i) => parseLength(i.el.tags.height)));
      for (const i of near) {
        i.kind = 'control_tower';
        i.towerPart = parseLength(i.el.tags.height) === top ? 'cab' : i.area > 300 && parseLength(i.el.tags.height) <= 40 ? 'base' : 'shaft';
      }
    }
  }
  items.push(...towerNodes.filter((n) => !n.modelled && !items.some((i) => i.kind === 'control_tower' && !i.modelled && distM([n.el.lon, n.el.lat], ringCentroid(i.polys[0][0])) < 40)));

  // building:part handling: parts inherit their parent's kind; an outline whose parts cover it
  // (as Simple 3D Buildings intends) is dropped. Partly covered outlines stay, just below their parts.
  const parents = items.filter((i) => !i.part && !i.node && i.kind !== 'jet_bridge' && !i.towerPart);
  const parts = items.filter((i) => i.part);
  const drop = new Set();
  for (const par of parents) {
    const outer = par.polys[0][0];
    let covered = 0;
    const inside = [];
    for (const pt of parts) {
      if (!pointInRing(ringCentroid(pt.polys[0][0]), outer)) continue;
      covered += pt.area;
      inside.push(pt);
      if (!pt.towerPart) pt.kind = classify(pt.el.tags, par.kind);
      pt.parentTags = par.el.tags;
    }
    if (covered >= par.area * 0.88) drop.add(par);
    else if (inside.length) par.below = inside;
  }

  const features = [];
  const seen = new Set();
  for (const it of items) {
    if (drop.has(it) || it.modelled) continue;
    const t = it.el.tags ?? {};
    const key = `${it.el.type}${it.el.id}:${ringCentroid(it.polys[0][0]).map((v) => v.toFixed(5)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const outer = it.polys[0][0];
    const area = it.area ?? Math.abs(ringArea(outer));
    if (it.kind !== 'control_tower' && area < 30 && !(parseLength(t.height) >= 15)) continue;
    const pt = it.parentTags ?? {};
    const colour = colourOf(t['building:colour'] ?? t.colour ?? pt['building:colour']);
    const roofColour = colourOf(t['roof:colour'] ?? pt['roof:colour']);
    const material = String(t['building:material'] ?? t['roof:material'] ?? pt['building:material'] ?? '').toLowerCase() || undefined;
    const name = String(t.name ?? t['name:en'] ?? pt.name ?? '').trim().slice(0, 40) || undefined;
    const extra = {};
    if (colour) extra.colour = colour;
    if (roofColour) extra.roof_colour = roofColour;
    if (material && /^[a-z_;]{2,24}$/.test(material)) extra.material = material;
    if (name) extra.name = name;
    if (it.el.type !== 'node') extra.osm = `${it.el.type[0]}${it.el.id}`;
    const push = (rings, p, grow = 0.5) => features.push({ type: 'Feature', properties: { ...p, ...extra }, geometry: { type: 'Polygon', coordinates: finishPolygon(rings, grow) } });

    if (it.towerPart) {
      const { height, min } = buildingHeights(t, 'control_tower');
      push(it.polys[0], { kind: 'control_tower', part: it.towerPart, height_m: height, min_height_m: min }, 0.3);
      continue;
    }
    if (it.kind === 'control_tower') {
      const h = parseLength(t.height) ?? (Number(t['building:levels']) > 6 ? Number(t['building:levels']) * LEVEL_M : DEFAULT_HEIGHT.control_tower);
      const cabBase = Math.max(h - 7, 3);
      let shaftRing;
      let cabRing;
      if (!it.node && area > 600) {
        // The outline is the base building: a low block, with the tower rising from its centre.
        const c = ringCentroid(outer);
        push(it.polys[0], { kind: 'control_tower', part: 'base', height_m: Math.min(12, round1(h / 4)), min_height_m: 0 });
        shaftRing = circle(c, 4.5);
        cabRing = circle(c, 8, 12);
      } else if (it.node) {
        shaftRing = circle([it.el.lon, it.el.lat], 3.6);
        cabRing = circle([it.el.lon, it.el.lat], 6.5, 12);
      } else {
        shaftRing = scaleRing(close(outer), area > 150 ? 0.55 : 0.7);
        cabRing = offsetRing(ringArea(outer) < 0 ? [...outer].reverse() : outer, 1.2);
      }
      push([shaftRing], { kind: 'control_tower', part: 'shaft', height_m: round1(cabBase), min_height_m: 0 }, 0);
      push([cabRing], { kind: 'control_tower', part: 'cab', height_m: round1(h), min_height_m: round1(cabBase) }, 0);
      push([cabRing], { kind: 'control_tower', part: 'cap', height_m: round1(h + 1.5), min_height_m: round1(h) }, 0.6);
      continue;
    }
    if (it.kind === 'jet_bridge') {
      push(it.polys[0], { kind: 'jet_bridge', height_m: 6.5, min_height_m: 3.5 }, 0);
      continue;
    }
    let { height, min } = buildingHeights(t, it.kind);
    const explicit = parseLength(t.height) !== undefined || Number(t['building:levels']) > 0;
    if (!explicit && it.kind === 'other') height = area >= 10_000 ? 12 : area >= 3000 ? 10 : height;
    // Canopies (building=roof): a thin roof on columns, not a solid block.
    if ((t.building === 'roof' || t['building:part'] === 'roof') && parseLength(t.min_height) === undefined) {
      if (!explicit) height = 7;
      min = round1(Math.max(height - 1.2, 0));
    }
    // A partly covered outline: what its parts leave uncovered is usually a lower annex
    // (fixed links, piers), so without its own height it sits at half its parts' height;
    // either way it stays just below them so the roofs never z-fight.
    if (it.below) {
      const partH = it.below.map((p) => buildingHeights(p.el.tags, p.kind).height);
      if (!explicit) height = Math.max(6, round1(Math.min(...partH) * 0.5));
      for (const ph of partH) if (Math.abs(ph - height) < 0.3) height = round1(height - 0.4);
    }
    for (const poly of it.polys) {
      const rings = [poly[0], ...poly.slice(1).filter((h) => Math.abs(ringArea(h)) > 150)];
      push(rings, { kind: it.kind, height_m: height, min_height_m: min });
    }
  }
  return features;
}

/** Things tagged as buildings that are not visible structures above ground. */
function skipTags(t) {
  if (t.building === 'no' || t['building:part'] === 'no') return true;
  if (t.indoor || /^(elevator|stairs|stairwell|steps|corridor|room)$/.test(t['building:part'] ?? '')) return true;
  if (/underground|indoor/.test(t.location ?? '') || t.building === 'underground') return true;
  if (Number(t.layer) < 0 && !t.height) return true;
  if (/^-/.test(String(t.level ?? '')) && !t.building) return true;
  return false;
}

function distM(a, b) {
  return Math.hypot((a[0] - b[0]) * Math.cos(a[1] * D2R), a[1] - b[1]) * M_PER_DEG;
}

// ---------------------------------------------------------------- Overpass run

// Overpass instance(s) (OVERPASS_URLS, comma-separated); with several, a busy answer moves the
// next (still backed-off) attempt to the next one so the load is shared.
const ENDPOINTS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter').split(',');
let endpoint = 0;

async function overpass(q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINTS[endpoint % ENDPOINTS.length], {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: q }),
      });
    } catch {
      console.log('  network error, waiting 60 s…');
      endpoint++;
      await sleep(60_000);
      continue;
    }
    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
      console.log(`  overpass busy (${res.status}), backing off 60 s…`);
      endpoint++;
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const j = JSON.parse(text);
    if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) {
      console.log(`  overpass remark: ${j.remark.slice(0, 120)} — backing off 60 s…`);
      await sleep(60_000);
      continue;
    }
    return j;
  }
  throw new Error('overpass unavailable');
}

function loadAirports() {
  const fleet = readFileSync(join(ROOT, 'src/data/sim/fleet.ts'), 'utf8') + readFileSync(join(ROOT, 'src/data/sim/fleet-more.ts'), 'utf8');
  const weight = new Map();
  for (const m of fleet.matchAll(/airline\('[A-Z]{3}', '[A-Z0-9]{0,2}', '[^']+', '[A-Z]{2}', '[^']+', '([^']+)', '[^']+', (\d+)/g)) {
    const hubs = m[1].split(' ');
    for (const h of hubs) weight.set(h, (weight.get(h) ?? 0) + Number(m[2]) / hubs.length);
  }
  const rows = JSON.parse(readFileSync(join(ROOT, 'public/data/airports/index-major.json'), 'utf8')).rows;
  const pos = new Map(rows.map((r) => [r[0], [r[6], r[7]]]));
  const runways = JSON.parse(readFileSync(join(ROOT, 'public/data/airports/runways-major.json'), 'utf8')).runways;
  const ground = readdirSync(GROUND)
    .filter((f) => /^[A-Z0-9]{3,4}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .filter((id) => {
      try {
        return JSON.parse(readFileSync(join(GROUND, `${id}.json`), 'utf8')).v === 2 && pos.has(id);
      } catch {
        return false;
      }
    });
  const first = (process.env.BUILDINGS_FIRST ?? 'EGLL,KJFK,OMDB,EDDF').split(',');
  const order = [...ground].sort((a, b) => {
    const fa = first.indexOf(a);
    const fb = first.indexOf(b);
    if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    return (weight.get(b) ?? 0) - (weight.get(a) ?? 0);
  });
  return { order, pos, runways };
}

/** Same airport box as build-ground: ±0.03° around the reference point, grown to the runways. */
function bbox(lat, lon, rws) {
  let s = lat - 0.03;
  let n = lat + 0.03;
  let w = lon - 0.03 / Math.cos(lat * D2R);
  let e = lon + 0.03 / Math.cos(lat * D2R);
  for (const r of rws ?? []) {
    for (const [la, lo] of [
      [r[1], r[2]],
      [r[5], r[6]],
    ]) {
      if (!la && !lo) continue;
      s = Math.min(s, la);
      n = Math.max(n, la);
      w = Math.min(w, lo);
      e = Math.max(e, lo);
    }
  }
  const m = 0.012;
  return [s - m, w - m / Math.cos(lat * D2R), n + m, e + m / Math.cos(lat * D2R)];
}

const FILTERS = (a) => `way[building](${a});relation[building](${a});way[aeroway~"^(terminal|hangar|gate|jet_bridge|control_tower|tower)$"](${a});way[man_made=tower](${a});node[man_made=tower](${a});node[aeroway=control_tower](${a});way["building:part"](${a});`;

/** Near the aerodrome (fallback without an area): within 500 m of a taxiway node or terminal. */
/** The aerodrome outline(s) for an airport: tagged with its ICAO code, else containing it, else nearest. */
function pickAerodrome(elements, ident, pt) {
  const ads = elements.filter((x) => x.tags?.aeroway === 'aerodrome' && !x.tags.building);
  const rings = (list) => list.flatMap((x) => polygonsOf(x).map((poly) => poly[0]));
  const mine = rings(ads.filter((x) => x.tags.icao === ident));
  if (mine.length) return mine;
  const all = rings(ads);
  const containing = all.filter((r) => pointInRing(pt, r));
  if (containing.length) return containing;
  const near = all.map((r) => [r, distM(pt, ringCentroid(r))]).filter(([, d]) => d < 3000);
  near.sort((a, b) => a[1] - b[1]);
  return near.length ? [near[0][0]] : [];
}

function nearGround(ident) {
  const g = JSON.parse(readFileSync(join(GROUND, `${ident}.json`), 'utf8'));
  const cells = new Set();
  // ~110 m cells; a building counts when it is within two cells of the airfield's own features.
  const cell = (lat, lon) => `${Math.floor(lat / 0.001)},${Math.floor((lon * Math.cos(lat * D2R)) / 0.001)}`;
  for (const [la, lo] of g.nodes) cells.add(cell(la, lo));
  for (const t of g.terminals ?? []) for (const [la, lo] of t.ring) cells.add(cell(la, lo));
  for (const st of g.stands ?? []) cells.add(cell(st[0], st[1]));
  return ([lon, lat], tags = {}) => {
    if (RESIDENTIAL.test(tags.building ?? '') || tags['addr:housenumber']) return false;
    const cy = Math.floor(lat / 0.001);
    const cx = Math.floor((lon * Math.cos(lat * D2R)) / 0.001);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (cells.has(`${cy + dy},${cx + dx}`)) return true;
    return false;
  };
}
const RESIDENTIAL = /^(house|detached|semidetached_house|terrace|apartments|residential|garage|garages|shed|church|school|kindergarten|temple|retail|hospital|greenhouse|farm|barn|cabin|bungalow|dormitory)$/;

function writeIndex() {
  const airports = {};
  for (const f of readdirSync(OUT)) {
    if (!/^[A-Z0-9]{3,4}\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
      if (j.v !== VERSION || !j.features?.length) continue;
      airports[f.replace('.json', '')] = [...j.center, ...j.bbox, j.features.length];
    } catch {
      /* skip */
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ v: VERSION, source: '© OpenStreetMap contributors (ODbL)', airports }));
  return Object.keys(airports).length;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const BUDGET_MS = Number(process.env.BUILDINGS_BUDGET_MIN ?? 60) * 60_000;
  const MAX = Number(process.env.BUILDINGS_AIRPORTS ?? 400);
  const ONLY = process.env.BUILDINGS_ONLY?.split(',');
  const GAP_MS = Math.max(10_000, Number(process.env.BUILDINGS_GAP_S ?? 12) * 1000);
  const { order, pos, runways } = loadAirports();
  const REBUILD = process.env.BUILDINGS_REBUILD === '1';
  mkdirSync(CACHE, { recursive: true });
  const list = (ONLY ?? order).slice(0, MAX);
  const started = Date.now();
  let fetched = 0;
  let lastQuery = 0;
  const query = async (q) => {
    const wait = lastQuery + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await overpass(q);
    } finally {
      lastQuery = Date.now();
    }
  };
  for (const ident of list) {
    const file = join(OUT, `${ident}.json`);
    if (existsSync(file) && !ONLY && !REBUILD) {
      try {
        if (JSON.parse(readFileSync(file, 'utf8')).v === VERSION) continue;
      } catch {
        /* rebuild */
      }
    }
    if (Date.now() - started > BUDGET_MS) {
      console.log('buildings: time budget used — run again later for the remaining airports');
      break;
    }
    if (!pos.has(ident)) continue;
    const [lat, lon] = pos.get(ident);
    const [s, w, n, e] = bbox(lat, lon, runways[ident]);
    const box = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
    const q = `[out:json][timeout:180][bbox:${box}];
(way[aeroway=aerodrome][icao="${ident}"];relation[aeroway=aerodrome][icao="${ident}"];)->.ad;
.ad map_to_area->.a1;
is_in(${lat.toFixed(5)},${lon.toFixed(5)})->.p;
area.p[aeroway=aerodrome]->.a2;
(.a1;.a2;)->.a;
(${FILTERS('area.a')});
out body geom qt;
.a out ids;
(way[aeroway=aerodrome];relation[aeroway=aerodrome];)->.adAll;
.adAll out geom;`;
    try {
      const t0 = Date.now();
      const raw = join(CACHE, `${ident}.json`);
      let j;
      let fallback = false;
      let aerodrome = [];
      if (existsSync(raw)) ({ j, fallback, aerodrome = [] } = JSON.parse(readFileSync(raw, 'utf8')));
      else if (REBUILD) continue;
      else {
        j = await query(q);
        aerodrome = pickAerodrome(j.elements, ident, [lon, lat]);
        if (!j.elements.some((x) => x.type === 'area')) {
          // Overpass has no area for this aerodrome (it happens): query inside the aerodrome
          // outline itself (a simplified polygon filter), or near the airfield's pavements.
          fallback = true;
          const outline = [...aerodrome].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
          if (outline) {
            const ccw = ringArea(outline) < 0 ? [...outline].reverse() : outline;
            const poly = offsetRing(simplifyRing(ccw, 80), 60)
              .slice(0, -1)
              .map(([x, y]) => `${y.toFixed(5)} ${x.toFixed(5)}`)
              .join(' ');
            console.log(`  ${ident}: no aerodrome area — querying inside its outline`);
            j = await query(`[out:json][timeout:180];(${FILTERS(`poly:"${poly}"`)});out body geom qt;`);
          } else {
            // No outline either: just the explicitly aeronautical structures in the airport box.
            console.log(`  ${ident}: no aerodrome area or outline — querying aeroway structures`);
            j = await query(`[out:json][timeout:180][bbox:${box}];(way[aeroway~"^(terminal|hangar|jet_bridge|control_tower|tower)$"];relation[aeroway=terminal];node[aeroway=control_tower];way[building~"^(terminal|hangar)$"];);out body geom qt;`);
          }
        }
        if (fallback && !j.elements.length) throw new Error('fallback query returned nothing — will retry next run');
        writeFileSync(raw, JSON.stringify({ j, fallback, aerodrome }));
      }
      const inAerodrome = (c) => aerodrome.some((ring) => pointInRing(c, ring));
      const near = nearGround(ident);
      const keep = !fallback ? () => true : aerodrome.length ? (c, t = {}) => inAerodrome(c) && !RESIDENTIAL.test(t.building ?? '') : near;
      const features = buildFeatures(
        j.elements.filter((x) => x.type !== 'area' && !(x.tags?.aeroway === 'aerodrome' && !x.tags.building)),
        keep,
      );
      let bs = 90;
      let bw = 180;
      let bn = -90;
      let be = -180;
      for (const f of features)
        for (const [x, y] of f.geometry.coordinates[0]) {
          bs = Math.min(bs, y);
          bn = Math.max(bn, y);
          bw = Math.min(bw, x);
          be = Math.max(be, x);
        }
      const out = {
        type: 'FeatureCollection',
        v: VERSION,
        icao: ident,
        source: '© OpenStreetMap contributors (ODbL)',
        center: [r5(lat), r5(lon)],
        bbox: features.length ? [r5(bs), r5(bw), r5(bn), r5(be)] : [s, w, n, e].map(r5),
        features,
      };
      const json = JSON.stringify(out);
      writeFileSync(file, json);
      fetched++;
      writeIndex();
      const kinds = {};
      for (const f of features) kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
      console.log(
        `buildings: ${ident} — ${features.length} features (${Object.entries(kinds)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}), ${(json.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
      );
    } catch (err) {
      console.warn(`buildings: ${ident} failed: ${err.message}`);
    }
  }
  const n = writeIndex();
  console.log(`buildings: fetched ${fetched} this run; ${n} airports in the index`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
