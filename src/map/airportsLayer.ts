// Airports (OurAirports, public domain): large airports always visible, others
// clustered at low zoom; the selected airport gets a runway overlay drawn from
// the published runway threshold coordinates.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import type { AirportDetail, AirportIndexEntry } from '@shared/types';
import { loadMajorAirports } from '@/data/airports';
import { getSettings, useSettings } from '@/state/settings';
import { ui, useUI } from '@/state/ui';
import { drawSdf } from './sdf';

const SRC_LARGE = 'apt-large';
const SRC_OTHER = 'apt-other';
const SRC_SEL = 'apt-sel';
const SRC_RWY = 'apt-rwy';

export const AIRPORT_LAYERS = [
  'apt-cluster',
  'apt-cluster-count',
  'apt-rwy-line',
  'apt-rwy-label',
  'apt-other-icon',
  'apt-large-icon',
  'apt-sel-ring',
] as const;

let data: { large: GeoJSON.FeatureCollection; other: GeoJSON.FeatureCollection } | null = null;
let selectedDetail: AirportDetail | null = null;

function toFeature(a: AirportIndexEntry): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    properties: {
      ident: a.ident,
      code: a.iata ?? a.icao ?? a.ident,
      name: a.name,
      t: a.type === 'large_airport' ? 0 : a.type === 'medium_airport' ? 1 : 2,
    },
  };
}

function ensureIcon(map: MlMap) {
  if (map.hasImage('apt-icon')) return;
  // Original airport glyph: a ring with two crossing runways.
  const img = drawSdf((ctx) => {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.rotate((-35 * Math.PI) / 180);
    ctx.fillRect(-3.5, -15, 7, 30);
    ctx.restore();
    ctx.save();
    ctx.rotate((40 * Math.PI) / 180);
    ctx.fillRect(-3.5, -12, 7, 24);
    ctx.restore();
  }, 40, 6);
  map.addImage('apt-icon', img, { sdf: true, pixelRatio: 2 });
}

export async function installAirportLayers(map: MlMap) {
  ensureIcon(map);
  const dark = getSettings().mapStyle !== 'arctic';
  const halo = dark ? 'rgba(3,6,11,0.9)' : 'rgba(255,255,255,0.95)';
  const text = dark ? '#cfe0f5' : '#13233a';
  const visibility = getSettings().showAirports ? 'visible' : 'none';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  const add = (id: string, spec: Record<string, unknown>) => {
    if (!map.getLayer(id)) map.addLayer({ id, ...spec, layout: { visibility, ...(spec.layout as object) } } as never, before);
  };
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (!map.getSource(SRC_LARGE)) map.addSource(SRC_LARGE, { type: 'geojson', data: data?.large ?? empty });
  if (!map.getSource(SRC_OTHER))
    map.addSource(SRC_OTHER, {
      type: 'geojson',
      data: data?.other ?? empty,
      cluster: true,
      clusterMaxZoom: 7,
      clusterRadius: 42,
    });
  if (!map.getSource(SRC_SEL)) map.addSource(SRC_SEL, { type: 'geojson', data: empty });
  if (!map.getSource(SRC_RWY)) map.addSource(SRC_RWY, { type: 'geojson', data: empty });

  add('apt-cluster', {
    type: 'circle',
    source: SRC_OTHER,
    minzoom: 4, // world views stay clean: only large airports there
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': dark ? 'rgba(20,34,56,0.85)' : 'rgba(255,255,255,0.9)',
      'circle-stroke-color': dark ? 'rgba(92,225,255,0.35)' : 'rgba(10,132,214,0.35)',
      'circle-stroke-width': 1,
      'circle-radius': ['step', ['get', 'point_count'], 9, 20, 12, 80, 15],
    },
  });
  add('apt-cluster-count', {
    type: 'symbol',
    source: SRC_OTHER,
    minzoom: 4,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 9.5,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': dark ? '#9fb3cc' : '#33445c' },
  });
  add('apt-rwy-line', {
    type: 'line',
    source: SRC_RWY,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'butt' },
    paint: {
      'line-color': dark ? 'rgba(92,225,255,0.85)' : 'rgba(10,132,214,0.9)',
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 2, 12, 5, 15, 24],
      'line-opacity': 0.75,
    },
  });
  add('apt-rwy-label', {
    type: 'symbol',
    source: SRC_RWY,
    minzoom: 11,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'id'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10,132,214,0.9)', 'text-halo-width': 2 },
  });
  add('apt-other-icon', {
    type: 'symbol',
    source: SRC_OTHER,
    minzoom: 5,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': 'apt-icon',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.38, 10, 0.55],
      'icon-allow-overlap': false,
      'text-field': ['step', ['zoom'], '', 8, ['get', 'code'], 11, ['concat', ['get', 'code'], '\n', ['get', 'name']]],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
      'text-max-width': 10,
    },
    paint: {
      'icon-color': dark ? '#8fa6c2' : '#4a5d78',
      'icon-halo-color': halo,
      'icon-halo-width': 1,
      'text-color': text,
      'text-halo-color': halo,
      'text-halo-width': 1.3,
      'text-opacity': 0.85,
    },
  });
  add('apt-large-icon', {
    type: 'symbol',
    source: SRC_LARGE,
    minzoom: 2.5,
    layout: {
      'icon-image': 'apt-icon',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2.5, 0.42, 8, 0.72, 12, 0.85],
      'icon-allow-overlap': ['step', ['zoom'], false, 6, true],
      'text-field': ['step', ['zoom'], '', 4, ['get', 'code'], 10, ['concat', ['get', 'code'], '\n', ['get', 'name']]],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9.5, 10, 11.5],
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
      'text-optional': true,
      'text-letter-spacing': 0.04,
      'text-max-width': 10,
    },
    paint: {
      'icon-color': dark ? '#5ce1ff' : '#0a84d6',
      'icon-halo-color': halo,
      'icon-halo-width': 1.2,
      'text-color': text,
      'text-halo-color': halo,
      'text-halo-width': 1.4,
    },
  });
  add('apt-sel-ring', {
    type: 'circle',
    source: SRC_SEL,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 12, 26],
      'circle-color': 'rgba(255,181,71,0.12)',
      'circle-stroke-color': '#ffb547',
      'circle-stroke-width': 2,
    },
  });

  if (!data) {
    try {
      const list = await loadMajorAirports();
      data = {
        large: { type: 'FeatureCollection', features: list.filter((a) => a.type === 'large_airport').map(toFeature) },
        other: { type: 'FeatureCollection', features: list.filter((a) => a.type !== 'large_airport').map(toFeature) },
      };
    } catch (e) {
      console.warn('airports unavailable', e);
      ui().toast({ kind: 'warning', title: 'Airport data unavailable', body: 'Airport markers could not be loaded.' });
      return;
    }
  }
  (map.getSource(SRC_LARGE) as GeoJSONSource | undefined)?.setData(data.large);
  (map.getSource(SRC_OTHER) as GeoJSONSource | undefined)?.setData(data.other);
  renderSelected(map);
}

export function setAirportsVisible(map: MlMap, on: boolean) {
  for (const l of AIRPORT_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
}

export function showAirportDetail(map: MlMap, detail: AirportDetail | null) {
  selectedDetail = detail;
  renderSelected(map);
}

function renderSelected(map: MlMap) {
  const sel = map.getSource(SRC_SEL) as GeoJSONSource | undefined;
  const rwy = map.getSource(SRC_RWY) as GeoJSONSource | undefined;
  if (!sel || !rwy) return;
  const d = selectedDetail;
  if (!d) {
    sel.setData({ type: 'FeatureCollection', features: [] });
    rwy.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  sel.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: {} }],
  });
  const feats: GeoJSON.Feature[] = [];
  for (const r of d.runways) {
    if (r.closed || r.leLat === undefined || r.leLon === undefined || r.heLat === undefined || r.heLon === undefined) continue;
    feats.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[r.leLon, r.leLat], [r.heLon, r.heLat]] },
      properties: {},
    });
    if (r.leIdent)
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.leLon, r.leLat] },
        properties: { id: r.leIdent, rot: r.leHeadingDegT ?? 0 },
      });
    if (r.heIdent)
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.heLon, r.heLat] },
        properties: { id: r.heIdent, rot: r.heHeadingDegT ?? 0 },
      });
  }
  rwy.setData({ type: 'FeatureCollection', features: feats });
}

export function bindAirportInteraction(map: MlMap): () => void {
  const layers = ['apt-large-icon', 'apt-other-icon'];
  const onClick = (e: MapLayerMouseEvent) => {
    if (ui().measure.active) return;
    // Aircraft take priority when both are under the pointer.
    const ac = map.queryRenderedFeatures(e.point, { layers: ['ac-icons', 'ac-dots'].filter((l) => map.getLayer(l)) });
    if (ac.length) return;
    const ident = e.features?.[0]?.properties?.ident as string | undefined;
    if (ident) ui().selectAirport(ident);
  };
  const onClusterClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const src = map.getSource(SRC_OTHER) as GeoJSONSource;
    const id = f.properties?.cluster_id as number;
    void src.getClusterExpansionZoom(id).then((zoom) => {
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.2, duration: 700 });
    });
  };
  const enter = () => (map.getCanvas().style.cursor = 'pointer');
  const leave = () => (map.getCanvas().style.cursor = '');
  for (const l of layers) {
    map.on('click', l, onClick);
    map.on('mouseenter', l, enter);
    map.on('mouseleave', l, leave);
  }
  map.on('click', 'apt-cluster', onClusterClick);
  map.on('mouseenter', 'apt-cluster', enter);
  map.on('mouseleave', 'apt-cluster', leave);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showAirports !== p.showAirports) setAirportsVisible(map, s.showAirports);
  });
  const unsubSel = useUI.subscribe((s, p) => {
    if (s.selectedAirport !== p.selectedAirport && !s.selectedAirport) showAirportDetail(map, null);
  });
  return () => {
    for (const l of layers) {
      map.off('click', l, onClick);
      map.off('mouseenter', l, enter);
      map.off('mouseleave', l, leave);
    }
    map.off('click', 'apt-cluster', onClusterClick);
    unsub();
    unsubSel();
  };
}
