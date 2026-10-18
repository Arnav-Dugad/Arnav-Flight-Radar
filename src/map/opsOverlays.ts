// Airport-operations overlays for the simulated world:
//   • Stands — every OpenStreetMap stand at the airport in view, green when free and
//     amber when an aircraft is parked on it (zoom ≥ 14).
//   • Ground services — catering, fuel, stairs, baggage, push-back tugs and de-icing trucks
//     around aircraft in their turnaround (zoom ≥ 15.5). With 3D models on, true-scale 3D
//     vehicles (vehicles3d.ts) take over from their zoom and these dots stop there.
//   • Disruptions — airports coloured by a 0–5 disruption index (delays, holding,
//     diversions, cancellations), like a flight tracker's disruption map.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { simNearestGroundAirport, simServiceVehicles, simStands, simWidgets, useSim } from '@/data/world';
import { getSettings, useSettings } from '@/state/settings';
import { ui } from '@/state/ui';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const DISRUPTION_COLOR = ['interpolate', ['linear'], ['get', 'd'], 0, '#3ddc97', 1, '#9be15d', 2, '#ffd166', 3, '#ffb547', 4, '#ff8a5c', 5, '#ff5d73'];

export function installOpsOverlays(map: MlMap) {
  const dark = getSettings().mapStyle !== 'arctic';
  const halo = dark ? 'rgba(3,6,11,0.85)' : 'rgba(255,255,255,0.9)';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  for (const id of ['stands', 'svc', 'disruption']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  if (!map.getLayer('stands-dot'))
    map.addLayer(
      {
        id: 'stands-dot',
        type: 'circle',
        source: 'stands',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 6],
          'circle-color': ['case', ['==', ['get', 'occ'], 1], '#ffb547', '#3ddc97'],
          'circle-opacity': ['case', ['==', ['get', 'occ'], 1], 0.35, 0.6],
          'circle-stroke-color': ['case', ['==', ['get', 'occ'], 1], '#ffb547', '#3ddc97'],
          'circle-stroke-width': 1,
        },
      },
      before,
    );
  if (!map.getLayer('stands-label'))
    map.addLayer({
      id: 'stands-label',
      type: 'symbol',
      source: 'stands',
      minzoom: 15.3,
      filter: ['!=', ['get', 'ref'], ''],
      layout: { 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': 9.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#9fe8c4' : '#14724a', 'text-halo-color': halo, 'text-halo-width': 1.2 },
    });
  if (!map.getLayer('svc-dot'))
    map.addLayer({
      id: 'svc-dot',
      type: 'circle',
      source: 'svc',
      minzoom: 15.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 2, 18, 4.5],
        'circle-color': ['match', ['get', 'k'], 'fuel', '#ff8a5c', 'catering', '#c4b5fd', 'stairs', '#ffd166', 'tug', '#5ce1ff', 'deice', '#ff9f1c', 'baggage', '#7dd3a8', '#9aa6b2'],
        'circle-stroke-color': halo,
        'circle-stroke-width': 1,
      },
    });
  if (!map.getLayer('svc-label'))
    map.addLayer({
      id: 'svc-label',
      type: 'symbol',
      source: 'svc',
      minzoom: 16.8,
      layout: { 'text-field': ['get', 'k'], 'text-font': ['Noto Sans Bold'], 'text-size': 9, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#cfe0f5' : '#13233a', 'text-halo-color': halo, 'text-halo-width': 1.1 },
    });
  const vis = getSettings().showDisruptions ? 'visible' : 'none';
  if (!map.getLayer('disruption'))
    map.addLayer(
      {
        id: 'disruption',
        type: 'circle',
        source: 'disruption',
        maxzoom: 9,
        layout: { visibility: vis },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['+', 4, ['*', 2, ['get', 'd']]], 8, ['+', 10, ['*', 4, ['get', 'd']]]],
          'circle-color': DISRUPTION_COLOR as never,
          'circle-opacity': 0.28,
          'circle-stroke-color': DISRUPTION_COLOR as never,
          'circle-stroke-width': 1.5,
        },
      },
      before,
    );
  if (!map.getLayer('disruption-label'))
    map.addLayer({
      id: 'disruption-label',
      type: 'symbol',
      source: 'disruption',
      minzoom: 3,
      maxzoom: 9,
      layout: {
        visibility: vis,
        'text-field': ['concat', ['get', 'code'], ' ', ['get', 'dl']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': DISRUPTION_COLOR as never, 'text-halo-color': halo, 'text-halo-width': 1.3 },
    });
  for (const id of ['disruption', 'disruption-label']) map.setLayoutProperty(id, 'visibility', vis);
  applyVehicles3d(map);
}

// Zoom from which 3D service vehicles are drawn instead of the dots (null: 3D vehicles off).
let vehicles3dZoom: number | null = null;

function applyVehicles3d(map: MlMap) {
  try {
    if (map.getLayer('svc-dot')) map.setLayerZoomRange('svc-dot', 15.5, vehicles3dZoom ?? 24);
    // the labels only start at 16.8, past the 3D vehicles' zoom: hide them while 3D is on
    if (map.getLayer('svc-label')) map.setLayoutProperty('svc-label', 'visibility', vehicles3dZoom !== null && vehicles3dZoom <= 16.8 ? 'none' : 'visible');
  } catch {
    /* style not ready */
  }
}

/** Called by the 3D models bridge: 3D vehicles are drawn from `minZoom` (null = not drawn). */
export function setServiceVehicles3d(map: MlMap, minZoom: number | null) {
  if (minZoom === vehicles3dZoom) return;
  vehicles3dZoom = minZoom;
  applyVehicles3d(map);
}

function renderGround(map: MlMap) {
  if (useSim.getState().loading) return;
  const z = map.getZoom();
  const stands = map.getSource('stands') as GeoJSONSource | undefined;
  const svc = map.getSource('svc') as GeoJSONSource | undefined;
  if (z < 14) {
    stands?.setData(EMPTY);
    svc?.setData(EMPTY);
    return;
  }
  const c = map.getCenter();
  const ident = ui().selectedAirport ?? simNearestGroundAirport(c.lat, c.lng);
  stands?.setData({
    type: 'FeatureCollection',
    features: (ident ? simStands(ident) : []).map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { ref: s.ref, occ: s.occupied ? 1 : 0 } })),
  });
  if (z < 15.5) {
    svc?.setData(EMPTY);
    return;
  }
  const b = map.getBounds();
  svc?.setData({
    type: 'FeatureCollection',
    features: simServiceVehicles([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: { k: v.kind },
    })),
  });
}

function renderDisruption(map: MlMap) {
  if (!getSettings().showDisruptions || useSim.getState().loading) return;
  const w = simWidgets();
  if (!w) return;
  (map.getSource('disruption') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: w.airports
      .filter((a) => a.disruption >= 0.5 || a.movements >= 25)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.airport.lon, a.airport.lat] },
        properties: { d: a.disruption, dl: a.disruption.toFixed(1), code: a.airport.iata ?? a.airport.ident },
      })),
  });
}

export function bindOpsOverlays(map: MlMap): () => void {
  const ground = setInterval(() => renderGround(map), 3000);
  const disruption = setInterval(() => renderDisruption(map), 30_000);
  const onMove = () => renderGround(map);
  map.on('moveend', onMove);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showDisruptions === p.showDisruptions) return;
    for (const id of ['disruption', 'disruption-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s.showDisruptions ? 'visible' : 'none');
    renderDisruption(map);
  });
  const unsubSim = useSim.subscribe((s, p) => {
    if (!s.loading && p.loading) {
      renderGround(map);
      renderDisruption(map);
    }
  });
  return () => {
    clearInterval(ground);
    clearInterval(disruption);
    map.off('moveend', onMove);
    unsub();
    unsubSim();
  };
}
