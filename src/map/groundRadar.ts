// Ground radar mode (surface movement radar / ASDE-X style): the airport in view on a dark
// surface map — runways, taxiways and stands — with every simulated aircraft on the ground as
// a radar target carrying a data tag: callsign, type and its current taxi clearance
// ("Taxi to holding point A1 via A B", "Holding short at S4", "Push-back approved").
// Loaded on demand when the setting is switched on; all traffic is simulated.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { api } from '@/lib/api';
import { loadGround, simGroundTraffic, simNearestGroundAirport, useSim, type GroundTraffic } from '@/data/world';
import { getSettings, useSettings } from '@/state/settings';
import { ui } from '@/state/ui';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const SRC_BG = 'gr-bg';
const SRC_NET = 'gr-net';
const SRC_TGT = 'gr-targets';
const LAYERS = ['gr-dim', 'gr-runway', 'gr-runway-id', 'gr-taxi', 'gr-tgt-trail', 'gr-tgt', 'gr-tag'];
const MIN_ZOOM = 12.2;

let current = '';
let installed = false;

/** A square of `nm` around a point (for the dimming backdrop). */
function box(lat: number, lon: number, nm: number): GeoJSON.Polygon {
  const dLat = nm / 60;
  const dLon = nm / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { type: 'Polygon', coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] };
}

/** Short data-tag text for a target. */
export function tagText(t: Pick<GroundTraffic, 'callsign' | 'type' | 'clearance' | 'via' | 'gs' | 'outbound'>): string {
  const via = t.via.length && /^Taxi/.test(t.clearance) ? ` via ${t.via.slice(0, 4).join(' ')}` : '';
  const spd = t.gs >= 1 ? ` ${Math.round(t.gs)}kt` : '';
  return `${t.callsign} ${t.type}${spd}\n${t.clearance}${via}`;
}

export function installGroundRadar(map: MlMap) {
  installed = true;
  for (const id of [SRC_BG, SRC_NET, SRC_TGT]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  // Above the base map and its buildings, below every aircraft layer.
  const below = map.getStyle().layers?.find((l) => l.id.startsWith('ac-'))?.id;
  const add = (spec: Parameters<MlMap['addLayer']>[0]) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec, below);
  };
  add({ id: 'gr-dim', type: 'fill', source: SRC_BG, minzoom: MIN_ZOOM - 0.5, paint: { 'fill-color': '#020806', 'fill-opacity': 0.9 } });
  add({
    id: 'gr-runway',
    type: 'line',
    source: SRC_NET,
    minzoom: MIN_ZOOM - 0.5,
    filter: ['==', ['get', 'k'], 'rwy'],
    layout: { 'line-cap': 'butt' },
    // ~45–60 m wide runways at true scale (a radar map shows them as solid grey bands).
    paint: { 'line-color': '#4a5d57', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 2, 14, 11, 16, 45, 18, 180] },
  });
  add({
    id: 'gr-taxi',
    type: 'line',
    source: SRC_NET,
    minzoom: MIN_ZOOM - 0.5,
    filter: ['==', ['get', 'k'], 'twy'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1f5c4b', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2.2, 18, 5], 'line-opacity': 0.9 },
  });
  add({
    id: 'gr-runway-id',
    type: 'symbol',
    source: SRC_NET,
    minzoom: MIN_ZOOM,
    filter: ['==', ['get', 'k'], 'rwy-end'],
    layout: { 'text-field': ['get', 'id'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#9fe0c8', 'text-halo-color': '#020806', 'text-halo-width': 1.5 },
  });
  add({
    id: 'gr-tgt-trail',
    type: 'line',
    source: SRC_TGT,
    minzoom: MIN_ZOOM,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['case', ['get', 'out'], '#5ce1ff', '#ffd166'], 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [2, 2] },
  });
  add({
    id: 'gr-tgt',
    type: 'circle',
    source: SRC_TGT,
    minzoom: MIN_ZOOM,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6, 18, 10],
      'circle-color': ['case', ['get', 'out'], '#5ce1ff', '#ffd166'],
      'circle-opacity': ['case', ['get', 'moving'], 1, 0.55],
      'circle-stroke-color': '#020806',
      'circle-stroke-width': 1.5,
    },
  });
  add({
    id: 'gr-tag',
    type: 'symbol',
    source: SRC_TGT,
    minzoom: MIN_ZOOM + 0.6,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'tag'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 17, 11.5],
      'text-justify': 'left',
      'text-variable-anchor': ['top-left', 'bottom-left', 'top-right', 'bottom-right'],
      'text-radial-offset': 0.9,
      'text-max-width': 30,
      'text-line-height': 1.15,
      'symbol-sort-key': ['case', ['get', 'moving'], 0, 1],
    },
    paint: { 'text-color': ['case', ['get', 'out'], '#bff3ff', '#ffe7a8'], 'text-halo-color': 'rgba(2,8,6,0.95)', 'text-halo-width': 2 },
  });
  applyVisibility(map);
}

function applyVisibility(map: MlMap) {
  const on = getSettings().groundRadar;
  for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

async function loadNetwork(map: MlMap, ident: string) {
  const [g, detail] = await Promise.all([loadGround(ident).catch(() => null), api.airport(ident).catch(() => null)]);
  if (current !== ident) return;
  const feats: GeoJSON.Feature[] = [];
  if (g) {
    for (const [a, b] of g.edges) {
      const p = g.nodes[a];
      const q = g.nodes[b];
      if (p && q) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[p[1], p[0]], [q[1], q[0]]] }, properties: { k: 'twy' } });
    }
  }
  for (const r of detail?.runways ?? []) {
    if (r.closed || r.leLat === undefined || r.leLon === undefined || r.heLat === undefined || r.heLon === undefined) continue;
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[r.leLon, r.leLat], [r.heLon, r.heLat]] }, properties: { k: 'rwy', w: Math.max(18, (r.widthFt ?? 150) * 0.3048) / 6 } });
    if (r.leIdent) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.leLon, r.leLat] }, properties: { k: 'rwy-end', id: r.leIdent } });
    if (r.heIdent) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.heLon, r.heLat] }, properties: { k: 'rwy-end', id: r.heIdent } });
  }
  (map.getSource(SRC_NET) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
  const lat = detail?.lat ?? g?.nodes[0]?.[0];
  const lon = detail?.lon ?? g?.nodes[0]?.[1];
  if (lat !== undefined && lon !== undefined) (map.getSource(SRC_BG) as GeoJSONSource | undefined)?.setData({ type: 'Feature', geometry: box(lat, lon, 6), properties: {} });
}

function renderTargets(map: MlMap) {
  if (!getSettings().groundRadar || map.getZoom() < MIN_ZOOM - 0.5) return;
  const c = map.getCenter();
  const ident = ui().selectedAirport ?? simNearestGroundAirport(c.lat, c.lng, 6);
  if (!ident) return;
  if (ident !== current) {
    current = ident;
    void loadNetwork(map, ident);
  }
  const traffic = simGroundTraffic(ident);
  if (!traffic) return;
  const features: GeoJSON.Feature[] = [];
  for (const t of traffic) {
    const moving = t.gs >= 1;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [t.lon, t.lat] }, properties: { tag: tagText(t), out: t.outbound, moving, id: t.id } });
    if (moving) {
      // A short history-style vector ahead of the target (8 s at current speed).
      const d = (t.gs * 8) / 3600 / 60;
      const r = (t.trk * Math.PI) / 180;
      const ahead = [t.lon + (d * Math.sin(r)) / Math.cos((t.lat * Math.PI) / 180), t.lat + d * Math.cos(r)];
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[t.lon, t.lat], ahead] }, properties: { out: t.outbound } });
    }
  }
  (map.getSource(SRC_TGT) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
}

export function bindGroundRadar(map: MlMap): () => void {
  installGroundRadar(map);
  // A style swap removes custom layers: put them back.
  const onStyle = () => {
    current = '';
    installGroundRadar(map);
    renderTargets(map);
  };
  map.on('style.load', onStyle);
  const unsubSim = useSim.subscribe((s, p) => {
    if (s.rev !== p.rev) renderTargets(map);
  });
  const unsubSet = useSettings.subscribe((s, p) => {
    if (s.groundRadar !== p.groundRadar) {
      applyVisibility(map);
      if (!s.groundRadar) current = '';
      renderTargets(map);
    }
  });
  const onMove = () => renderTargets(map);
  map.on('moveend', onMove);
  renderTargets(map);
  return () => {
    unsubSim();
    unsubSet();
    map.off('moveend', onMove);
    map.off('style.load', onStyle);
  };
}

/** True once the layers exist on the current style. */
export const groundRadarInstalled = () => installed;
