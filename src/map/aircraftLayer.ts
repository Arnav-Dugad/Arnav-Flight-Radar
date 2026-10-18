// Aircraft rendering engine on top of MapLibre (GPU symbol layers, no DOM per aircraft).
//
//  • One GeoJSON source holds every visible aircraft; it is rebuilt on an adaptive
//    schedule (≈15 fps when zoomed in, 1 fps at continental zoom) because motion
//    is sub-pixel when zoomed out.
//  • The selected aircraft lives in its own tiny source updated every frame, so the
//    thing you are looking at is always perfectly smooth.
//  • Icons are signed-distance fields: colour (altitude/speed/…) and halos are
//    applied on the GPU, at any size, without generating per-colour bitmaps.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { classifyAircraft, type AircraftClass } from '@shared/classify';
import { aircraftColorExpression, ALTITUDE_STOPS, GROUND_COLOR, scaleColor, SPEED_STOPS, VERTICAL_STOPS } from '@/lib/colors';
import { compileFilter } from '@/lib/filters';
import { useFilters } from '@/state/filters';
import { getSettings, useSettings } from '@/state/settings';
import { simRouteCodes } from '@/data/world';
import { traffic, type Track, type TrailPoint } from '@/state/traffic';
import { ui, useUI } from '@/state/ui';
import { viewPadding } from './camera';
import { silhouetteSdf } from './sdf';
import { SILHOUETTES } from './silhouettes';

const SRC = 'ac';
const SRC_SEL = 'ac-sel';
const SRC_SEL_TRAIL = 'ac-sel-trail';
const SRC_TRAILS = 'ac-trails';
const SRC_RIBBON = 'ac-sel-ribbon';

const CLASSES = Object.keys(SILHOUETTES) as AircraftClass[];

export const AIRCRAFT_LAYERS = [
  'ac-heat',
  'ac-trails',
  'ac-sel-ribbon',
  'ac-sel-trail',
  'ac-emergency',
  'ac-icons',
  'ac-labels',
  'ac-sel-glow',
  'ac-sel-ring',
  'ac-sel-report',
  'ac-sel-icon',
  'ac-sel-label',
] as const;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

let sdfCache: Map<AircraftClass, ReturnType<typeof silhouetteSdf>> | null = null;

function ensureImages(map: MlMap) {
  sdfCache ??= new Map(CLASSES.map((c) => [c, silhouetteSdf(c)]));
  for (const [cls, img] of sdfCache) {
    const id = `ac-${cls}`;
    if (!map.hasImage(id)) map.addImage(id, img, { sdf: true, pixelRatio: 2 });
  }
}

function sizeExpr(scale: number) {
  // Ground traffic is drawn smaller so busy aprons don't swamp airborne aircraft.
  // (MapLibre requires zoom to be the top-level interpolation; the per-feature case sits inside.)
  const stop = (v: number) => ['case', ['==', ['get', 'gnd'], 1], v * scale * 0.72, v * scale];
  // Icons are drawn at every zoom (never collapsing to invisible dots), just smaller far out.
  return ['interpolate', ['linear'], ['zoom'], 0, stop(0.2), 2, stop(0.27), 3.5, stop(0.36), 6, stop(0.6), 9, stop(0.82), 12, stop(1.05), 15, stop(1.35)];
}

function labelMinZoom(density: string): number {
  return density === 'high' ? 5.5 : density === 'low' ? 9 : density === 'none' ? 24 : 7;
}

/** Adds sources and layers (idempotent; called again after every style swap). */
export function installAircraftLayers(map: MlMap) {
  ensureImages(map);
  const s = getSettings();
  const dark = s.mapStyle !== 'arctic';
  const halo = dark ? 'rgba(3,6,11,0.85)' : 'rgba(255,255,255,0.9)';
  // Icons always get a dark outline: light altitude colours (yellow) need it on light maps too.
  const iconHalo = dark ? 'rgba(3,6,11,0.85)' : 'rgba(16,28,48,0.6)';
  const add = (id: string, spec: Record<string, unknown>) => {
    if (!map.getLayer(id)) map.addLayer({ id, ...spec } as never);
  };
  if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: EMPTY, promoteId: 'id' });
  if (!map.getSource(SRC_SEL)) map.addSource(SRC_SEL, { type: 'geojson', data: EMPTY });
  if (!map.getSource(SRC_SEL_TRAIL)) map.addSource(SRC_SEL_TRAIL, { type: 'geojson', data: EMPTY, lineMetrics: false });
  if (!map.getSource(SRC_TRAILS)) map.addSource(SRC_TRAILS, { type: 'geojson', data: EMPTY });
  if (!map.getSource(SRC_RIBBON)) map.addSource(SRC_RIBBON, { type: 'geojson', data: EMPTY });

  const color = aircraftColorExpression(s.colorMode, s.altitudePalette);

  add('ac-heat', {
    type: 'heatmap',
    source: SRC,
    maxzoom: 10,
    layout: { visibility: s.showHeatmap ? 'visible' : 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 9, 1.6],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 10, 9, 28],
      'heatmap-opacity': 0.55,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(0,0,0,0)',
        0.2,
        'rgba(46,139,255,0.35)',
        0.5,
        'rgba(92,225,255,0.55)',
        0.8,
        'rgba(255,181,71,0.7)',
        1,
        'rgba(255,107,154,0.85)',
      ],
    },
  });
  add('ac-trails', {
    type: 'line',
    source: SRC_TRAILS,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: s.showAllTrails ? 'visible' : 'none' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 1.4, 'line-opacity': ['*', 0.55, ['get', 'o']] },
  });
  // 3-D flight path: a translucent curtain from the ground up to the flown altitude.
  add('ac-sel-ribbon', {
    type: 'fill-extrusion',
    source: SRC_RIBBON,
    layout: { visibility: s.show3dPath ? 'visible' : 'none' },
    paint: {
      'fill-extrusion-color': ['get', 'c'],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': s.path3dOpacity,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  add('ac-sel-trail', {
    type: 'line',
    source: SRC_SEL_TRAIL,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'c'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 3.2, 14, 4.5],
      'line-opacity': ['get', 'o'],
      'line-blur': 0.3,
    },
  });
  add('ac-emergency', {
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'em'], 1],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 8, 12, 22],
      'circle-color': 'rgba(255,93,115,0.12)',
      'circle-stroke-color': '#ff5d73',
      'circle-stroke-width': 1.6,
    },
  });
  add('ac-icons', {
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': ['concat', 'ac-', ['get', 'cls']],
      'icon-size': sizeExpr(s.symbolScale),
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['coalesce', ['get', 'alt'], 0],
    },
    paint: {
      'icon-color': color,
      'icon-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#5ce1ff', iconHalo],
      'icon-halo-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.4, s.highContrast ? 2.2 : 1.3],
      'icon-halo-blur': 0.4,
      'icon-opacity': [
        'case',
        ['==', ['get', 'dim'], 1],
        0.16,
        ['==', ['get', 'st'], 'lost'],
        0.3,
        ['==', ['get', 'st'], 'stale'],
        0.55,
        1,
      ],
      'icon-opacity-transition': { duration: 300 },
    },
  });
  add('ac-labels', {
    type: 'symbol',
    source: SRC,
    minzoom: labelMinZoom(s.labelDensity),
    filter: ['all', ['!=', ['get', 'lbl'], ''], ['!=', ['get', 'dim'], 1]],
    layout: {
      'text-field': ['get', 'lbl'],
      'text-font': ['Noto Sans Bold'],
      'text-size': s.highContrast ? 12 : 10.5,
      'text-offset': [0, 1.55],
      'text-anchor': 'top',
      'text-letter-spacing': 0.06,
      'text-optional': true,
      'text-padding': 4,
      'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'alt'], 0]],
    },
    paint: {
      'text-color': dark ? '#d7e3f2' : '#1b2a40',
      'text-halo-color': halo,
      'text-halo-width': 1.4,
      'text-opacity': ['case', ['==', ['get', 'st'], 'live'], 0.95, 0.55],
    },
  });
  add('ac-sel-glow', {
    type: 'circle',
    source: SRC_SEL,
    filter: ['==', ['get', 'k'], 'ac'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 12, 34],
      'circle-color': '#ffb547',
      'circle-opacity': 0.22,
      'circle-blur': 1,
    },
  });
  add('ac-sel-ring', {
    type: 'circle',
    source: SRC_SEL,
    filter: ['==', ['get', 'k'], 'ac'],
    paint: {
      'circle-radius': 18,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#ffb547',
      'circle-stroke-width': 1.6,
      'circle-stroke-opacity': 0.8,
      'circle-pitch-alignment': 'map',
    },
  });
  add('ac-sel-report', {
    type: 'circle',
    source: SRC_SEL,
    filter: ['==', ['get', 'k'], 'report'],
    paint: {
      'circle-radius': 4,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': dark ? '#f4f8ff' : '#0b1426',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.85,
    },
  });
  add('ac-sel-icon', {
    type: 'symbol',
    source: SRC_SEL,
    filter: ['==', ['get', 'k'], 'ac'],
    layout: {
      'icon-image': ['concat', 'ac-', ['get', 'cls']],
      'icon-size': sizeExpr(s.symbolScale * 1.18),
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-color': '#ffb547',
      'icon-halo-color': dark ? 'rgba(3,6,11,0.95)' : '#ffffff',
      'icon-halo-width': 1.8,
    },
  });
  add('ac-sel-label', {
    type: 'symbol',
    source: SRC_SEL,
    filter: ['==', ['get', 'k'], 'ac'],
    layout: {
      'text-field': ['get', 'lbl'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-offset': [0, 2.1],
      'text-anchor': 'top',
      'text-allow-overlap': true,
      'text-letter-spacing': 0.08,
    },
    paint: { 'text-color': '#ffd28a', 'text-halo-color': halo, 'text-halo-width': 1.6 },
  });
}

/** Re-applies settings-driven paint/layout without rebuilding layers. */
export function applyAircraftSettings(map: MlMap) {
  if (!map.getLayer('ac-icons')) return;
  const s = getSettings();
  const color = aircraftColorExpression(s.colorMode, s.altitudePalette);
  map.setPaintProperty('ac-icons', 'icon-color', color as never);
  map.setLayoutProperty('ac-icons', 'icon-size', sizeExpr(s.symbolScale) as never);
  map.setLayoutProperty('ac-sel-icon', 'icon-size', sizeExpr(s.symbolScale * 1.18) as never);
  map.setLayerZoomRange('ac-labels', labelMinZoom(s.labelDensity), 24);
  map.setLayoutProperty('ac-heat', 'visibility', s.showHeatmap ? 'visible' : 'none');
  map.setLayoutProperty('ac-trails', 'visibility', s.showAllTrails ? 'visible' : 'none');
  map.setLayoutProperty('ac-sel-ribbon', 'visibility', s.show3dPath ? 'visible' : 'none');
  map.setPaintProperty('ac-sel-ribbon', 'fill-extrusion-opacity', s.path3dOpacity);
  map.setPaintProperty('ac-icons', 'icon-halo-width', ['case', ['boolean', ['feature-state', 'hover'], false], 2.4, s.highContrast ? 2.2 : 1.3] as never);
  map.setLayoutProperty('ac-labels', 'text-size', s.highContrast ? 12 : 10.5);
}

// ---------------------------------------------------------------- trail colouring

function trailColor(p: TrailPoint, mode: string, t0: number, t1: number): string {
  const s = getSettings();
  switch (mode) {
    case 'speed':
      return p.gs === undefined ? '#9aa6b2' : scaleColor(SPEED_STOPS, p.gs);
    case 'vertical':
      return p.vr === undefined ? '#9aa6b2' : scaleColor(VERTICAL_STOPS, p.vr);
    case 'time': {
      const k = t1 > t0 ? (p.t - t0) / (t1 - t0) : 1;
      return scaleColor(
        [
          [0, '#2e5a8a'],
          [0.6, '#2e8bff'],
          [1, '#5ce1ff'],
        ],
        k,
      );
    }
    default:
      if (p.alt === 0) return GROUND_COLOR;
      return p.alt === undefined ? '#c3cfdd' : scaleColor(ALTITUDE_STOPS[s.altitudePalette], p.alt);
  }
}

function trailFeatures(points: TrailPoint[], head: [number, number] | null, mode: string, reveal: number) {
  const pts = head ? [...points.slice(0, -1), { ...points[points.length - 1]!, lat: head[1], lon: head[0] }] : points;
  if (pts.length < 2) return [];
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const n = pts.length - 1;
  const shown = Math.max(0, Math.min(n, reveal * n));
  const out: GeoJSON.Feature[] = [];
  for (let i = 1; i <= Math.ceil(shown); i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (b.gap) continue; // never bridge a data gap
    let end: [number, number] = [b.lon, b.lat];
    if (i > shown) {
      const f = shown - (i - 1);
      end = [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
    }
    const age = n > 0 ? i / n : 1;
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], end] },
      properties: { c: trailColor(b, mode, t0, t1), o: 0.35 + 0.65 * age },
    });
  }
  return out;
}

/**
 * 3-D path: one thin extruded quad per trail segment, as tall as the altitude
 * flown there (true scale, metres). Width tracks zoom so it stays a few pixels wide.
 */
function ribbonFeatures(points: TrailPoint[], head: [number, number], zoom: number, mode: string): GeoJSON.Feature[] {
  if (points.length < 2) return [];
  const pts = [...points.slice(0, -1), { ...points[points.length - 1]!, lat: head[1], lon: head[0] }];
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const metresPerPx = (40_075_016 * Math.cos((head[1] * Math.PI) / 180)) / (512 * 2 ** zoom);
  const halfW = Math.max(15, metresPerPx * 1.6);
  const out: GeoJSON.Feature[] = [];
  const step = Math.max(1, Math.floor(pts.length / 220));
  for (let i = step; i < pts.length; i += step) {
    const a = pts[i - step]!;
    const b = pts[i]!;
    if (b.gap || a.alt === undefined || b.alt === undefined) continue;
    const k = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
    const dx = (b.lon - a.lon) * k;
    const dy = b.lat - a.lat;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const off = halfW / 111_320 / len;
    const nx = (-dy * off) / k;
    const ny = dx * off;
    out.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [a.lon + nx, a.lat + ny],
            [b.lon + nx, b.lat + ny],
            [b.lon - nx, b.lat - ny],
            [a.lon - nx, a.lat - ny],
            [a.lon + nx, a.lat + ny],
          ],
        ],
      },
      properties: { c: trailColor(b, mode, t0, t1), h: Math.max(30, ((a.alt + b.alt) / 2) * 0.3048) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- engine

export interface AircraftEngine {
  stop: () => void;
  markDirty: () => void;
  visibleCount: () => number;
}

export function startAircraftEngine(map: MlMap): AircraftEngine {
  let raf = 0;
  let lastFull = 0;
  let dirty = true;
  let visible = 0;
  let hovered: string | null = null;
  let selReveal = { id: '' as string | null, start: 0 };
  let predicate = compileFilter(useFilters.getState().filters);
  let highlight = useFilters.getState().highlightMode;
  let lastFollow = 0;
  let lastRibbon = 0;
  let ribbonId: string | null = null;

  const unsubs: (() => void)[] = [];
  unsubs.push(traffic.subscribe(() => (dirty = true)));
  unsubs.push(
    useFilters.subscribe((s) => {
      predicate = compileFilter(s.filters);
      highlight = s.highlightMode;
      dirty = true;
    }),
  );
  unsubs.push(
    useSettings.subscribe((s, prev) => {
      if (
        s.colorMode !== prev.colorMode ||
        s.altitudePalette !== prev.altitudePalette ||
        s.symbolScale !== prev.symbolScale ||
        s.labelDensity !== prev.labelDensity ||
        s.showHeatmap !== prev.showHeatmap ||
        s.showAllTrails !== prev.showAllTrails ||
        s.show3dPath !== prev.show3dPath ||
        s.path3dOpacity !== prev.path3dOpacity ||
        s.path3dColor !== prev.path3dColor ||
        s.labelContent !== prev.labelContent ||
        s.highContrast !== prev.highContrast
      ) {
        applyAircraftSettings(map);
        dirty = true;
      }
    }),
  );
  unsubs.push(useUI.subscribe((s, prev) => {
    if (s.selectedId !== prev.selectedId || s.replay !== prev.replay) dirty = true;
  }));

  let lastDrawn = 0;
  function interval(): number {
    const zoom = map.getZoom();
    const count = lastDrawn;
    const heavy = count > 6000 ? 3 : count > 1500 ? 2 : count > 700 ? 1.4 : 1;
    if (!traffic.smooth) return 1000;
    if (zoom < 5) return 1000 * heavy;
    if (zoom < 7) return 400 * heavy;
    if (zoom < 9) return 160 * heavy;
    return 66 * heavy;
  }

  const clsCache = new WeakMap<object, AircraftClass>();

  /** Viewport (padded) for culling; null = draw everything (world views, globe). */
  function cullBounds(): [number, number, number, number] | null {
    if (map.getZoom() < 3.2) return null;
    const b = map.getBounds();
    const w = b.getWest();
    const e = b.getEast();
    if (e - w >= 300) return null;
    const padX = (e - w) * 0.25;
    const padY = (b.getNorth() - b.getSouth()) * 0.25;
    return [w - padX, b.getSouth() - padY, e + padX, b.getNorth() + padY];
  }

  function labelFor(a: Track['ac'], id: string): string {
    const r = simRouteCodes(id);
    switch (getSettings().labelContent) {
      case 'callsign':
        return a.callsign ?? '';
      case 'registration':
        return a.registration ?? '';
      case 'type':
        return a.aircraftType ?? '';
      case 'route':
        return r ? `${r[1]}–${r[2]}` : (a.callsign ?? '');
      case 'altitude':
        return a.onGround ? 'GND' : a.altitudeBarometric !== undefined ? (a.altitudeBarometric >= 18000 ? `FL${Math.round(a.altitudeBarometric / 100)}` : `${Math.round(a.altitudeBarometric / 100) * 100}`) : '';
      default:
        return r?.[0] ?? a.callsign ?? '';
    }
  }

  function featureFor(t: Track, now: number): GeoJSON.Feature {
    const pos = traffic.displayPosition(t, now);
    const a = t.ac;
    let cls = clsCache.get(a);
    if (!cls) {
      cls = classifyAircraft(a);
      clsCache.set(a, cls);
    }
    const props: Record<string, unknown> = {
      id: t.id,
      cls,
      rot: pos.trk ?? 0,
      gnd: a.onGround ? 1 : 0,
      st: traffic.stateOf(t, now),
      lbl: labelFor(a, t.id),
    };
    const alt = a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric);
    if (alt !== undefined) props.alt = alt;
    if (a.groundSpeed !== undefined) props.gs = a.groundSpeed;
    if (a.verticalRate !== undefined) props.vr = a.verticalRate;
    if (a.emergency || a.squawk === '7500' || a.squawk === '7600' || a.squawk === '7700') props.em = 1;
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] }, properties: props };
  }

  function replayFeatures(): GeoJSON.Feature[] {
    const { index } = ui().replay;
    const snaps = traffic.snapshots;
    if (!snaps.length) return [];
    const i0 = Math.max(0, Math.min(snaps.length - 1, Math.floor(index)));
    const i1 = Math.min(snaps.length - 1, i0 + 1);
    const f = index - i0;
    const next = new Map(snaps[i1]!.rows.map((r) => [r[0], r]));
    return snaps[i0]!.rows.map((r) => {
      const n = next.get(r[0]);
      // Interpolate only between two RECORDED snapshots of the same aircraft.
      const lat = n ? r[1] + (n[1] - r[1]) * f : r[1];
      const lon = n ? r[2] + (n[2] - r[2]) * f : r[2];
      const t = traffic.get(r[0]);
      const props: Record<string, unknown> = {
        id: r[0],
        cls: t ? classifyAircraft(t.ac) : 'unknown',
        rot: r[4] ?? 0,
        gnd: r[3] === 0 ? 1 : 0,
        st: 'live',
        lbl: t?.ac.callsign ?? '',
      };
      if (r[3] !== null) props.alt = r[3];
      if (r[5] !== null) props.gs = r[5];
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props };
    });
  }

  function rebuild(now: number) {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const replay = ui().replay.active;
    const features: GeoJSON.Feature[] = [];
    const trails: GeoJSON.Feature[] = [];
    const selected = ui().selectedId;
    const showTrails = getSettings().showAllTrails;
    const trailMode = getSettings().trailColorMode;
    visible = 0;
    if (replay) {
      features.push(...replayFeatures());
      visible = features.length;
    } else {
      const bounds = cullBounds();
      // Very large fleets (the simulated world): ground traffic only appears once zoomed in.
      const hideGround = traffic.tracks.size > 3000 && map.getZoom() < 5;
      for (const t of traffic.tracks.values()) {
        const ageSec = traffic.ageMs(t, now) / 1000;
        const match = predicate(t.ac, ageSec);
        if (!match && !highlight && t.id !== selected) continue;
        if (match) visible++;
        if (t.id !== selected) {
          if (hideGround && t.ac.onGround) continue;
          if (bounds) {
            let lon = t.ac.lon;
            if (lon < bounds[0]) lon += 360;
            else if (lon > bounds[2]) lon -= 360;
            if (lon < bounds[0] || lon > bounds[2] || t.ac.lat < bounds[1] || t.ac.lat > bounds[3]) continue;
          }
        }
        const f = featureFor(t, now);
        if (!match) f.properties!.dim = 1;
        features.push(f);
        const trail = showTrails && match ? traffic.trailOf(t) : null;
        if (trail && trail.length > 1) {
          const recent = trail.slice(-12);
          const pos = f.geometry as GeoJSON.Point;
          for (const tf of trailFeatures(recent, pos.coordinates as [number, number], trailMode, 1)) trails.push(tf);
        }
      }
    }
    lastDrawn = features.length;
    src.setData({ type: 'FeatureCollection', features });
    (map.getSource(SRC_TRAILS) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: trails });
  }

  function updateSelected(now: number) {
    const id = ui().selectedId;
    const sel = map.getSource(SRC_SEL) as GeoJSONSource | undefined;
    const trailSrc = map.getSource(SRC_SEL_TRAIL) as GeoJSONSource | undefined;
    if (!sel || !trailSrc) return;
    const t = traffic.get(id);
    const ribbon = map.getSource(SRC_RIBBON) as GeoJSONSource | undefined;
    if (!t || ui().replay.active) {
      sel.setData(EMPTY);
      trailSrc.setData(EMPTY);
      if (ribbonId) ribbon?.setData(EMPTY);
      ribbonId = null;
      return;
    }
    if (selReveal.id !== id) selReveal = { id, start: now };
    const pos = traffic.displayPosition(t, now);
    const feats: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: {
          k: 'ac',
          cls: classifyAircraft(t.ac),
          rot: pos.trk ?? 0,
          lbl: t.ac.callsign ?? t.ac.registration ?? t.ac.icao24.toUpperCase(),
        },
      },
    ];
    if (!pos.settled) {
      // Hollow marker: the newest authoritative report the icon is gliding toward.
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [t.ac.lon, t.ac.lat] }, properties: { k: 'report' } });
    }
    sel.setData({ type: 'FeatureCollection', features: feats });

    const reveal = Math.min(1, (now - selReveal.start) / 1100);
    const eased = 1 - (1 - reveal) ** 3;
    const trail = traffic.trailOf(t);
    trailSrc.setData({
      type: 'FeatureCollection',
      features: trailFeatures(trail, [pos.lon, pos.lat], getSettings().trailColorMode, eased),
    });
    if (ribbon && getSettings().show3dPath && (now - lastRibbon > 400 || ribbonId !== id)) {
      lastRibbon = now;
      ribbonId = id;
      ribbon.setData({ type: 'FeatureCollection', features: map.getPitch() > 8 ? ribbonFeatures(trail, [pos.lon, pos.lat], map.getZoom(), getSettings().path3dColor) : [] });
    }

    // Breathing selection ring (cheap paint update; skipped with reduced motion).
    if (getSettings().motion === 'full') {
      const phase = ((now - selReveal.start) % 2400) / 2400;
      map.setPaintProperty('ac-sel-ring', 'circle-radius', 14 + phase * 16);
      map.setPaintProperty('ac-sel-ring', 'circle-stroke-opacity', 0.85 * (1 - phase));
    }

    // Camera follow.
    const u = ui();
    if (u.following && !u.followPaused && now - lastFollow > 16) {
      lastFollow = now;
      const headingUp = u.chase || getSettings().cameraMode === 'heading-up';
      // Chase view eases the bearing so turns feel like sitting behind the aircraft.
      const bearing = headingUp && pos.trk !== undefined ? (u.chase ? map.getBearing() + (((pos.trk - map.getBearing() + 540) % 360) - 180) * 0.08 : pos.trk) : map.getBearing();
      map.jumpTo({ center: [pos.lon, pos.lat], bearing, padding: viewPadding() });
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const now = Date.now();
    if (dirty || now - lastFull >= interval()) {
      dirty = false;
      lastFull = now;
      rebuild(now);
    }
    updateSelected(now);
  }
  raf = requestAnimationFrame(frame);

  // ---------------------------------------------------------------- interaction
  const interactive = ['ac-icons'];
  let hoverRaf = 0;
  const onMove = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    const id = (f?.properties?.id as string | undefined) ?? null;
    if (id && !hoverRaf) {
      const pt = { x: e.point.x, y: e.point.y };
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        ui().setHoverPoint(pt);
      });
    }
    if (id === hovered) return;
    if (hovered) map.setFeatureState({ source: SRC, id: hovered }, { hover: false });
    hovered = id;
    if (id) map.setFeatureState({ source: SRC, id }, { hover: true });
    map.getCanvas().style.cursor = id ? 'pointer' : '';
    ui().setHovered(id);
  };
  const onLeave = () => {
    if (hovered) map.setFeatureState({ source: SRC, id: hovered }, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = '';
    ui().setHovered(null);
    ui().setHoverPoint(null);
  };
  const onClick = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (!id) return;
    e.preventDefault();
    if (ui().measure.active) return;
    ui().select(id);
  };
  for (const l of interactive) {
    map.on('mousemove', l, onMove);
    map.on('mouseleave', l, onLeave);
    map.on('click', l, onClick);
  }

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      unsubs.forEach((u) => u());
      for (const l of interactive) {
        map.off('mousemove', l, onMove);
        map.off('mouseleave', l, onLeave);
        map.off('click', l, onClick);
      }
    },
    markDirty: () => (dirty = true),
    visibleCount: () => visible,
  };
}
