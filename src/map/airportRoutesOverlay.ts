// Airport-panel map overlay (lazy chunk, installed by controller.ts):
//   • Routes — great-circle arcs from the selected airport to every destination of its
//     SIMULATED network, thicker for more weekly flights; clicking a destination opens it.
//   • Procedure — one departure (SID) or arrival (STAR) drawn fix by fix from the airport,
//     with fix names and altitude constraints where published.
// What to draw comes from `ui.airportOverlay`, set by the airport panel; it is only shown
// while that airport's panel is open.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { intermediatePoint, distanceNm } from '@shared/geo';
import { getSettings } from '@/state/settings';
import { ui, useUI, type AirportOverlay } from '@/state/ui';
import { viewPadding } from './camera';

const SRC_LINES = 'apr-lines';
const SRC_PTS = 'apr-pts';
const LAYERS = ['apr-route', 'apr-route-focus', 'apr-proc-casing', 'apr-proc', 'apr-proc-sim', 'apr-dest', 'apr-dest-label', 'apr-fix', 'apr-fix-label', 'apr-origin'];
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Great-circle polyline [lon, lat] from a to b, longitudes unwrapped so it never jumps across the antimeridian. */
export function greatCircle(a: [number, number], b: [number, number]): [number, number][] {
  const d = distanceNm(a[1], a[0], b[1], b[0]);
  const n = Math.max(2, Math.min(96, Math.ceil(d / 90)));
  const out: [number, number][] = [];
  let prev = a[0];
  for (let i = 0; i <= n; i++) {
    const [lat, lon0] = i === 0 ? [a[1], a[0]] : i === n ? [b[1], b[0]] : intermediatePoint(a[1], a[0], b[1], b[0], i / n);
    let lon = lon0;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, lat]);
    prev = lon;
  }
  return out;
}

function install(map: MlMap) {
  const dark = getSettings().mapStyle !== 'arctic';
  const accent = dark ? '#5ce1ff' : '#0a7fb8';
  const proc = dark ? '#c4b5fd' : '#6d4fd8';
  const halo = dark ? 'rgba(3,6,11,0.88)' : 'rgba(255,255,255,0.92)';
  const text = dark ? '#e6f1ff' : '#0f1d30';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  for (const id of [SRC_LINES, SRC_PTS]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const add = (spec: Parameters<MlMap['addLayer']>[0], below = before) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec, below);
  };
  const width = ['interpolate', ['linear'], ['get', 'w'], 1, 0.7, 7, 1.3, 21, 2.2, 70, 3.6, 200, 5.5];
  add({
    id: 'apr-route',
    type: 'line',
    source: SRC_LINES,
    filter: ['==', ['get', 'k'], 'route'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': width as never, 'line-opacity': ['case', ['==', ['get', 'f'], 1], 0, 0.55] },
  });
  add({
    id: 'apr-route-focus',
    type: 'line',
    source: SRC_LINES,
    filter: ['all', ['==', ['get', 'k'], 'route'], ['==', ['get', 'f'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffd166', 'line-width': ['+', width as never, 1.6], 'line-opacity': 0.95 },
  });
  add({
    id: 'apr-proc-casing',
    type: 'line',
    source: SRC_LINES,
    filter: ['==', ['get', 'k'], 'proc'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': halo, 'line-width': 6, 'line-opacity': 0.8 },
  });
  add({
    id: 'apr-proc',
    type: 'line',
    source: SRC_LINES,
    filter: ['all', ['==', ['get', 'k'], 'proc'], ['==', ['get', 'pub'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': proc, 'line-width': 3 },
  });
  // Simulator-generated procedures (a single exit / entry fix) are dashed.
  add({
    id: 'apr-proc-sim',
    type: 'line',
    source: SRC_LINES,
    filter: ['all', ['==', ['get', 'k'], 'proc'], ['==', ['get', 'pub'], 0]],
    paint: { 'line-color': proc, 'line-width': 3, 'line-dasharray': [2, 1.4] },
  });
  add({
    id: 'apr-dest',
    type: 'circle',
    source: SRC_PTS,
    filter: ['==', ['get', 'k'], 'dest'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 1, 2.6, 21, 3.6, 200, 5.5],
      'circle-color': ['case', ['==', ['get', 'f'], 1], '#ffd166', accent],
      'circle-stroke-color': halo,
      'circle-stroke-width': 1.4,
    },
  });
  add({
    id: 'apr-fix',
    type: 'circle',
    source: SRC_PTS,
    filter: ['==', ['get', 'k'], 'fix'],
    paint: { 'circle-radius': 4, 'circle-color': halo, 'circle-stroke-color': proc, 'circle-stroke-width': 2 },
  });
  add({
    id: 'apr-origin',
    type: 'circle',
    source: SRC_PTS,
    filter: ['==', ['get', 'k'], 'origin'],
    paint: { 'circle-radius': 6, 'circle-color': accent, 'circle-stroke-color': halo, 'circle-stroke-width': 2.5 },
  });
  // Labels sit above the aircraft so they stay readable.
  add(
    {
      id: 'apr-dest-label',
      type: 'symbol',
      source: SRC_PTS,
      filter: ['==', ['get', 'k'], 'dest'],
      layout: {
        'text-field': ['get', 'code'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['case', ['==', ['get', 'f'], 1], 13, 10.5],
        'text-offset': [0, 0.85],
        'text-anchor': 'top',
        'text-optional': true,
        'symbol-sort-key': ['-', 0, ['get', 'w']],
      },
      paint: { 'text-color': ['case', ['==', ['get', 'f'], 1], '#ffd166', text], 'text-halo-color': halo, 'text-halo-width': 1.4 },
    },
    undefined,
  );
  add(
    {
      id: 'apr-fix-label',
      type: 'symbol',
      source: SRC_PTS,
      filter: ['==', ['get', 'k'], 'fix'],
      layout: {
        'text-field': ['case', ['has', 'alt'], ['format', ['get', 'id'], { 'font-scale': 1 }, '\n', {}, ['get', 'alt'], { 'font-scale': 0.82 }], ['get', 'id']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: { 'text-color': dark ? '#ddd3ff' : '#3f2a9e', 'text-halo-color': halo, 'text-halo-width': 1.5 },
    },
    undefined,
  );
}

function visibleOverlay(): AirportOverlay | null {
  const u = ui();
  const o = u.airportOverlay;
  if (!o || u.panel !== 'airport' || u.selectedAirport !== o.airport) return null;
  return o;
}

function render(map: MlMap) {
  const lines = map.getSource(SRC_LINES) as GeoJSONSource | undefined;
  const pts = map.getSource(SRC_PTS) as GeoJSONSource | undefined;
  if (!lines || !pts) return;
  const o = visibleOverlay();
  if (!o) {
    lines.setData(EMPTY);
    pts.setData(EMPTY);
    return;
  }
  const lf: GeoJSON.Feature[] = [];
  const pf: GeoJSON.Feature[] = [{ type: 'Feature', geometry: { type: 'Point', coordinates: o.origin }, properties: { k: 'origin' } }];
  if (o.kind === 'routes') {
    // Thin, rare routes first so the busy ones draw on top.
    for (const d of [...o.dests].sort((x, y) => x.perWeek - y.perWeek)) {
      const f = o.focus === d.ident ? 1 : 0;
      const line = greatCircle(o.origin, [d.lon, d.lat]);
      lf.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { k: 'route', w: d.perWeek, f } });
      pf.push({ type: 'Feature', geometry: { type: 'Point', coordinates: line[line.length - 1]! }, properties: { k: 'dest', id: d.ident, code: d.code, name: d.name, w: d.perWeek, f } });
    }
  } else {
    const path: [number, number][] = o.fixes.map((f) => [f.lon, f.lat]);
    if (o.proc === 'sid') path.unshift(o.origin);
    else path.push(o.origin);
    lf.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: { k: 'proc', pub: o.published ? 1 : 0 } });
    for (const f of o.fixes) pf.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { k: 'fix', id: f.ident, ...(f.alt ? { alt: f.alt } : {}) } });
  }
  lines.setData({ type: 'FeatureCollection', features: lf });
  pts.setData({ type: 'FeatureCollection', features: pf });
}

/** Frames the current overlay in the part of the map the panel leaves visible. */
function fit(map: MlMap) {
  const o = visibleOverlay();
  if (!o) return;
  const coords: [number, number][] = [o.origin];
  if (o.kind === 'routes') {
    for (const d of o.dests) {
      const g = greatCircle(o.origin, [d.lon, d.lat]);
      coords.push(g[g.length - 1]!);
    }
  } else for (const f of o.fixes) coords.push([f.lon, f.lat]);
  if (coords.length < 2) return;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of coords) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  const p = viewPadding();
  const reduce = getSettings().motion !== 'full';
  try {
    map.fitBounds(
      [
        [w, Math.max(-80, s)],
        [e, Math.min(84, n)],
      ],
      {
        // Clear of the top bar and the status bar as well as the panel.
        padding: { top: p.top + 100, bottom: p.bottom + 80, left: p.left + 90, right: p.right + 50 },
        maxZoom: o.kind === 'procedure' ? 9.5 : 7,
        duration: reduce ? 0 : 1400,
        essential: false,
      },
    );
  } catch {
    /* bounds can be degenerate while the map is resizing */
  }
}

/** Installs the overlay and keeps it in sync with the airport panel. */
export function bindAirportRoutesOverlay(map: MlMap): () => void {
  const reinstall = () => {
    install(map);
    render(map);
  };
  reinstall();
  map.on('style.load', reinstall);
  const unsub = useUI.subscribe((s, p) => {
    if (s.airportOverlay === p.airportOverlay && s.panel === p.panel && s.selectedAirport === p.selectedAirport) return;
    render(map);
    const o = s.airportOverlay;
    const po = p.airportOverlay;
    // Frame a newly drawn network or procedure (not every refresh of the same one).
    if (o && (!po || po.kind !== o.kind || po.airport !== o.airport || po.fit !== o.fit)) fit(map);
  });
  const onClick = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (!id) return;
    ui().selectAirport(id);
  };
  const enter = () => (map.getCanvas().style.cursor = 'pointer');
  const leave = () => (map.getCanvas().style.cursor = '');
  map.on('click', 'apr-dest', onClick);
  map.on('mouseenter', 'apr-dest', enter);
  map.on('mouseleave', 'apr-dest', leave);
  return () => {
    unsub();
    map.off('style.load', reinstall);
    map.off('click', 'apr-dest', onClick);
    map.off('mouseenter', 'apr-dest', enter);
    map.off('mouseleave', 'apr-dest', leave);
    for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of [SRC_LINES, SRC_PTS]) if (map.getSource(s)) map.removeSource(s);
  };
}
