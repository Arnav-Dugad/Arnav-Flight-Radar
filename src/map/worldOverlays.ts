// Map overlays for the simulated world's structure:
//   • North Atlantic tracks — the day's simulated organised track system (westbound by
//     day, eastbound by night) with track letters and how many flights are on each.
//   • Terminals — OpenStreetMap terminal outlines and names at the airport in view.
//   • 3D buildings — OpenStreetMap buildings (OpenFreeMap tiles) extruded to their
//     mapped heights when the map is tilted.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { loadGround, simNatTracks, simNearestGroundAirport, useSim } from '@/data/world';
import { getSettings, useSettings } from '@/state/settings';
import { ui } from '@/state/ui';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const WEST = '#5ce1ff';
const EAST = '#c4a3ff';

/** Great-circle-ish densified line (linear in lon/lat is fine over 10° steps at these latitudes). */
function densify(pts: [number, number][], ends: [[number, number], [number, number]]): [number, number][] {
  const out: [number, number][] = [ends[0]];
  for (const p of pts) out.push([p[1], p[0]]);
  out.push(ends[1]);
  return out;
}

export function installWorldOverlays(map: MlMap) {
  const dark = getSettings().mapStyle !== 'arctic';
  const halo = dark ? 'rgba(3,6,11,0.85)' : 'rgba(255,255,255,0.92)';
  for (const id of ['nat', 'nat-pts', 'terminals']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const natVis = getSettings().showNatTracks ? 'visible' : 'none';
  if (!map.getLayer('nat-line'))
    map.addLayer({
      id: 'nat-line',
      type: 'line',
      source: 'nat',
      maxzoom: 8,
      layout: { visibility: natVis, 'line-cap': 'round' },
      paint: {
        'line-color': ['case', ['get', 'east'], EAST, WEST],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 6, 2.2],
        'line-opacity': ['case', ['get', 'active'], 0.8, 0.35],
        'line-dasharray': [2, 1.5],
      },
    });
  if (!map.getLayer('nat-label'))
    map.addLayer({
      id: 'nat-label',
      type: 'symbol',
      source: 'nat',
      maxzoom: 8,
      layout: {
        visibility: natVis,
        'symbol-placement': 'line',
        'symbol-spacing': 260,
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-keep-upright': true,
      },
      paint: { 'text-color': ['case', ['get', 'east'], EAST, WEST], 'text-halo-color': halo, 'text-halo-width': 1.4 },
    });
  if (!map.getLayer('nat-pt'))
    map.addLayer({
      id: 'nat-pt',
      type: 'circle',
      source: 'nat-pts',
      minzoom: 3,
      maxzoom: 8,
      layout: { visibility: natVis },
      paint: { 'circle-radius': 2.2, 'circle-color': ['case', ['get', 'east'], EAST, WEST], 'circle-stroke-color': halo, 'circle-stroke-width': 1 },
    });
  if (!map.getLayer('terminal-fill'))
    map.addLayer(
      {
        id: 'terminal-fill',
        type: 'fill',
        source: 'terminals',
        minzoom: 13,
        paint: { 'fill-color': dark ? '#5ce1ff' : '#1d6fa5', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, dark ? 0.08 : 0.1], 'fill-outline-color': dark ? 'rgba(92,225,255,0.5)' : 'rgba(29,111,165,0.6)' },
      },
      map.getLayer('stands-dot') ? 'stands-dot' : undefined,
    );
  if (!map.getLayer('terminal-label'))
    map.addLayer({
      id: 'terminal-label',
      type: 'symbol',
      source: 'terminals',
      minzoom: 13.5,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 17, 14], 'text-letter-spacing': 0.04, 'text-optional': true },
      paint: { 'text-color': dark ? '#bdeeff' : '#0f4a73', 'text-halo-color': halo, 'text-halo-width': 1.5 },
    });
  // 3D buildings from the base map's vector tiles (not on satellite imagery).
  if (map.getSource('openmaptiles') && map.getLayer('building') && !map.getLayer('building-3d')) {
    const color = (map.getPaintProperty('building', 'fill-color') as string | undefined) ?? (dark ? '#1b222d' : '#e1e5eb');
    map.addLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        layout: { visibility: getSettings().show3dBuildings ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': color,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.85],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      map.getLayer('stands-dot') ? 'stands-dot' : undefined,
    );
  }
  syncBuildings(map);
}

/** Flat footprints when the map is flat, extruded ones when tilted. */
function syncBuildings(map: MlMap) {
  if (!map.getLayer('building-3d')) return;
  const on = getSettings().show3dBuildings && map.getPitch() > 15;
  map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none');
}

function renderNat(map: MlMap) {
  if (!getSettings().showNatTracks || useSim.getState().loading) return;
  const tracks = simNatTracks();
  const lines: GeoJSON.Feature[] = [];
  const pts: GeoJSON.Feature[] = [];
  for (const t of tracks) {
    // Oceanic entry/exit roughly 5° beyond the track's end longitudes.
    const first = t.pts[0]!;
    const last = t.pts[t.pts.length - 1]!;
    const coords = densify(t.pts, [
      [first[1] + 5, first[0]],
      [last[1] - 5, last[0]],
    ]);
    const active = t.flights > 0;
    lines.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { east: t.eastbound, active, label: `NAT ${t.letter}${t.flights ? ` · ${t.flights}` : ''}` },
    });
    for (const p of t.pts) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[1], p[0]] }, properties: { east: t.eastbound } });
  }
  (map.getSource('nat') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lines });
  (map.getSource('nat-pts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pts });
}

let terminalsFor = '';
function renderTerminals(map: MlMap) {
  if (map.getZoom() < 12.5 || useSim.getState().loading) return;
  const c = map.getCenter();
  const ident = ui().selectedAirport ?? simNearestGroundAirport(c.lat, c.lng, 6);
  if (!ident || ident === terminalsFor) return;
  terminalsFor = ident;
  void loadGround(ident).then((g) => {
    if (!g?.terminals || terminalsFor !== ident) return;
    (map.getSource('terminals') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: g.terminals
        .filter((t, i, all) => t.ring.length >= 4 && all.findIndex((x) => x.name === t.name) === i)
        .map((t) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [t.ring.map(([la, lo]) => [lo, la])] }, properties: { name: t.name } })),
    });
  });
}

export function bindWorldOverlays(map: MlMap): () => void {
  const nat = setInterval(() => renderNat(map), 60_000);
  const onMove = () => renderTerminals(map);
  const onPitch = () => syncBuildings(map);
  map.on('moveend', onMove);
  map.on('pitchend', onPitch);
  map.on('pitch', onPitch);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showNatTracks !== p.showNatTracks) {
      for (const id of ['nat-line', 'nat-label', 'nat-pt']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s.showNatTracks ? 'visible' : 'none');
      renderNat(map);
    }
    if (s.show3dBuildings !== p.show3dBuildings) syncBuildings(map);
  });
  const unsubSim = useSim.subscribe((s, p) => {
    if (!s.loading && p.loading) {
      renderNat(map);
      renderTerminals(map);
    }
  });
  renderNat(map);
  renderTerminals(map);
  return () => {
    clearInterval(nat);
    map.off('moveend', onMove);
    map.off('pitchend', onPitch);
    map.off('pitch', onPitch);
    unsub();
    unsubSim();
    terminalsFor = '';
  };
}

/** Called after a style change so overlays re-render into the fresh sources. */
export function resetWorldOverlays() {
  terminalsFor = '';
}
