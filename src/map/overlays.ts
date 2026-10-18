// Secondary map overlays:
//   • Coverage — the region actually queried for live aircraft (and recent ones).
//   • Weather  — METAR stations in view (flight category + reported wind). These are
//                real station observations; nothing is interpolated into a fake field.
//   • Measure  — great-circle distance / bearing between user-placed points.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { Metar } from '@shared/types';
import { bearingDeg, circlePolygon, destination, distanceNm } from '@shared/geo';
import { airportByCode } from '@/data/airports';
import { api } from '@/lib/api';
import { getSettings, useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui, useUI } from '@/state/ui';
import { drawSdf } from './sdf';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const FLIGHT_CAT_COLOR: Record<string, string> = {
  VFR: '#3ddc97',
  MVFR: '#4aa3ff',
  IFR: '#ff5d73',
  LIFR: '#d36bff',
};

// ---------------------------------------------------------------- coverage

export function installCoverage(map: MlMap) {
  if (!map.getSource('coverage')) map.addSource('coverage', { type: 'geojson', data: EMPTY });
  const dark = getSettings().mapStyle !== 'arctic';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  const vis = getSettings().showCoverage ? 'visible' : 'none';
  if (!map.getLayer('coverage-fill'))
    map.addLayer(
      {
        id: 'coverage-fill',
        type: 'fill',
        source: 'coverage',
        filter: ['==', ['get', 'current'], 1],
        layout: { visibility: vis },
        paint: { 'fill-color': dark ? '#5ce1ff' : '#0a84d6', 'fill-opacity': 0.025 },
      },
      before,
    );
  if (!map.getLayer('coverage-line'))
    map.addLayer(
      {
        id: 'coverage-line',
        type: 'line',
        source: 'coverage',
        layout: { visibility: vis },
        paint: {
          'line-color': dark ? '#5ce1ff' : '#0a84d6',
          'line-opacity': ['case', ['==', ['get', 'current'], 1], 0.55, 0.16],
          'line-width': ['case', ['==', ['get', 'current'], 1], 1.4, 1],
          'line-dasharray': [3, 3],
        },
      },
      before,
    );
  updateCoverage(map);
}

export function updateCoverage(map: MlMap) {
  const src = map.getSource('coverage') as GeoJSONSource | undefined;
  if (!src) return;
  const current = traffic.meta?.provider === 'demo' ? undefined : traffic.meta?.region;
  const features: GeoJSON.Feature[] = traffic.regionsQueried.map(({ region }) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circlePolygon(region.lat, region.lon, region.radiusNm)] },
    properties: {
      current: current && current.lat === region.lat && current.lon === region.lon && current.radiusNm === region.radiusNm ? 1 : 0,
    },
  }));
  src.setData({ type: 'FeatureCollection', features });
}

// ---------------------------------------------------------------- weather

let metars: Metar[] = [];
let weatherAbort: AbortController | null = null;
let weatherKey = '';
export let weatherNotice: string | null = null;
const weatherListeners = new Set<() => void>();
export const onWeatherChange = (fn: () => void) => {
  weatherListeners.add(fn);
  return () => weatherListeners.delete(fn);
};
const emitWeather = () => weatherListeners.forEach((f) => f());

function ensureWindIcon(map: MlMap) {
  if (map.hasImage('wind-arrow')) return;
  // Arrow pointing north (direction the wind blows TOWARD after rotation).
  const img = drawSdf((ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(9, -8);
    ctx.lineTo(2.6, -9);
    ctx.lineTo(2.6, 22);
    ctx.lineTo(-2.6, 22);
    ctx.lineTo(-2.6, -9);
    ctx.lineTo(-9, -8);
    ctx.closePath();
    ctx.fill();
  }, 40, 6);
  map.addImage('wind-arrow', img, { sdf: true, pixelRatio: 2 });
}

export function installWeather(map: MlMap) {
  ensureWindIcon(map);
  if (!map.getSource('wx')) map.addSource('wx', { type: 'geojson', data: EMPTY });
  const dark = getSettings().mapStyle !== 'arctic';
  const vis = getSettings().showWeather ? 'visible' : 'none';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  if (!map.getLayer('wx-station'))
    map.addLayer(
      {
        id: 'wx-station',
        type: 'circle',
        source: 'wx',
        layout: { visibility: vis },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 9, 6],
          'circle-color': ['coalesce', ['get', 'col'], '#9aa6b2'],
          'circle-stroke-color': dark ? '#03060b' : '#ffffff',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.9,
        },
      },
      before,
    );
  if (!map.getLayer('wx-wind'))
    map.addLayer(
      {
        id: 'wx-wind',
        type: 'symbol',
        source: 'wx',
        filter: ['has', 'wdir'],
        layout: {
          visibility: vis,
          'icon-image': 'wind-arrow',
          // Wind is reported FROM a direction; the arrow points where the air goes.
          'icon-rotate': ['+', ['get', 'wdir'], 180],
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['get', 'wspd'], 0, 0.35, 15, 0.6, 35, 0.95],
          'icon-offset': [0, -26],
          'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 6, ['get', 'lbl']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 10,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'icon-color': dark ? '#dbe8f7' : '#22344d',
          'icon-halo-color': dark ? 'rgba(3,6,11,0.85)' : '#ffffff',
          'icon-halo-width': 1,
          'text-color': dark ? '#dbe8f7' : '#22344d',
          'text-halo-color': dark ? 'rgba(3,6,11,0.9)' : '#ffffff',
          'text-halo-width': 1.2,
        },
      },
      before,
    );
  renderWeather(map);
}

function renderWeather(map: MlMap) {
  const src = map.getSource('wx') as GeoJSONSource | undefined;
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: metars
      .filter((m) => m.lat !== undefined && m.lon !== undefined)
      .map((m) => {
        const props: Record<string, unknown> = {
          station: m.station,
          col: m.flightCategory ? FLIGHT_CAT_COLOR[m.flightCategory] : null,
          lbl: `${m.station} ${m.windVariable ? 'VRB' : m.windDirDeg !== undefined ? String(m.windDirDeg).padStart(3, '0') : '—'}/${m.windSpeedKt ?? '—'}${m.windGustKt ? `G${m.windGustKt}` : ''}`,
        };
        if (m.windDirDeg !== undefined && (m.windSpeedKt ?? 0) > 0) {
          props.wdir = m.windDirDeg;
          props.wspd = m.windSpeedKt ?? 0;
        }
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon!, m.lat!] }, properties: props };
      }),
  });
}

export async function refreshWeather(map: MlMap) {
  if (!getSettings().showWeather) return;
  const b = map.getBounds();
  const s = b.getSouth();
  const n = b.getNorth();
  let w = b.getWest();
  let e = b.getEast();
  if (e - w > 360) {
    w = -180;
    e = 180;
  }
  if (n - s > 12 || e - w > 16 || w < -180 || e > 180) {
    weatherNotice = 'Zoom in to load METAR stations (view must be smaller than about 12° × 16°).';
    emitWeather();
    return;
  }
  const key = [Math.floor(s), Math.floor(w), Math.ceil(n), Math.ceil(e)].join(',');
  if (key === weatherKey) return;
  weatherKey = key;
  weatherAbort?.abort();
  weatherAbort = new AbortController();
  weatherNotice = 'Loading METAR stations…';
  emitWeather();
  try {
    const r = await api.metarBbox(s, w, n, e, weatherAbort.signal);
    metars = r.data;
    weatherNotice = metars.length ? null : 'No METAR stations reported in this area.';
    renderWeather(map);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    weatherKey = '';
    weatherNotice = `Weather unavailable: ${(err as Error).message}`;
  }
  emitWeather();
}

export function getMetarsInView() {
  return metars;
}

export function bindWeather(map: MlMap): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const onMove = () => {
    clearTimeout(t);
    t = setTimeout(() => void refreshWeather(map), 700);
  };
  map.on('moveend', onMove);
  const onClick = (e: MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
    const st = e.features?.[0]?.properties?.station as string | undefined;
    if (st && !ui().measure.active) ui().selectAirport(st);
  };
  map.on('click', 'wx-station', onClick as never);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showWeather !== p.showWeather) {
      for (const l of ['wx-station', 'wx-wind']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', s.showWeather ? 'visible' : 'none');
      if (s.showWeather) {
        weatherKey = '';
        void refreshWeather(map);
      } else {
        weatherNotice = null;
        emitWeather();
      }
    }
    if (s.showCoverage !== p.showCoverage)
      for (const l of ['coverage-fill', 'coverage-line'])
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', s.showCoverage ? 'visible' : 'none');
  });
  return () => {
    clearTimeout(t);
    map.off('moveend', onMove);
    map.off('click', 'wx-station', onClick as never);
    unsub();
  };
}

// ---------------------------------------------------------------- measure

export function installMeasure(map: MlMap) {
  if (!map.getSource('measure')) map.addSource('measure', { type: 'geojson', data: EMPTY });
  if (!map.getLayer('measure-line'))
    map.addLayer({
      id: 'measure-line',
      type: 'line',
      source: 'measure',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#ffb547', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    });
  if (!map.getLayer('measure-point'))
    map.addLayer({
      id: 'measure-point',
      type: 'circle',
      source: 'measure',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': '#ffb547', 'circle-stroke-color': '#03060b', 'circle-stroke-width': 2 },
    });
  if (!map.getLayer('measure-label'))
    map.addLayer({
      id: 'measure-label',
      type: 'symbol',
      source: 'measure',
      filter: ['has', 'lbl'],
      layout: {
        'text-field': ['get', 'lbl'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, -1.2],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffd28a', 'text-halo-color': 'rgba(3,6,11,0.9)', 'text-halo-width': 1.6 },
    });
  renderMeasure(map);
}

export function measureLegs(points: [number, number][]) {
  const legs: { dist: number; brg: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1]!;
    const [lon2, lat2] = points[i]!;
    legs.push({ dist: distanceNm(lat1, lon1, lat2, lon2), brg: bearingDeg(lat1, lon1, lat2, lon2) });
  }
  return legs;
}

function renderMeasure(map: MlMap) {
  const src = map.getSource('measure') as GeoJSONSource | undefined;
  if (!src) return;
  const pts = ui().measure.points;
  const feats: GeoJSON.Feature[] = pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
  const legs = measureLegs(pts);
  legs.forEach((leg, i) => {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a, b] }, properties: {} });
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
      properties: { lbl: `${leg.dist.toFixed(1)} NM · ${String(Math.round(leg.brg)).padStart(3, '0')}°` },
    });
  });
  src.setData({ type: 'FeatureCollection', features: feats });
}

export function bindMeasure(map: MlMap): () => void {
  const onClick = (e: MapMouseEvent) => {
    const m = ui().measure;
    if (!m.active) return;
    ui().setMeasure({ points: [...m.points, [e.lngLat.lng, e.lngLat.lat]] });
  };
  map.on('click', onClick);
  const unsub = useUI.subscribe((s, p) => {
    if (s.measure !== p.measure) {
      renderMeasure(map);
      map.getCanvas().style.cursor = s.measure.active ? 'crosshair' : '';
    }
  });
  return () => {
    map.off('click', onClick);
    unsub();
  };
}

// ---------------------------------------------------------------- range rings

const RING_SETS: Record<'nm' | 'km' | 'mi', { values: number[]; toNm: number; unit: string }> = {
  nm: { values: [5, 10, 25, 50, 100], toNm: 1, unit: 'NM' },
  km: { values: [10, 25, 50, 100, 200], toNm: 1 / 1.852, unit: 'km' },
  mi: { values: [5, 10, 25, 50, 100], toNm: 1 / 1.150779, unit: 'mi' },
};

/** Rings centre: selected aircraft → selected/spotter airport → map centre. */
function ringCentre(map: MlMap): { lat: number; lon: number } {
  const u = ui();
  const t = traffic.get(u.selectedId);
  if (t) {
    const p = traffic.displayPosition(t);
    return { lat: p.lat, lon: p.lon };
  }
  const apt = u.selectedAirport ?? u.spotterAirport;
  const a = apt ? airportByCode(apt) : undefined;
  if (a) return { lat: a.lat, lon: a.lon };
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng };
}

export function installRings(map: MlMap) {
  if (!map.getSource('rings')) map.addSource('rings', { type: 'geojson', data: EMPTY });
  const dark = getSettings().mapStyle !== 'arctic';
  const vis = getSettings().showRangeRings ? 'visible' : 'none';
  const before = map.getLayer('ac-heat') ? 'ac-heat' : undefined;
  if (!map.getLayer('rings-line'))
    map.addLayer(
      {
        id: 'rings-line',
        type: 'line',
        source: 'rings',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { visibility: vis },
        paint: { 'line-color': dark ? 'rgba(255,181,71,0.55)' : 'rgba(200,110,0,0.6)', 'line-width': 1.2, 'line-dasharray': [4, 3] },
      },
      before,
    );
  if (!map.getLayer('rings-label'))
    map.addLayer(
      {
        id: 'rings-label',
        type: 'symbol',
        source: 'rings',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: vis, 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-allow-overlap': true },
        paint: { 'text-color': dark ? '#ffd28a' : '#9a5a00', 'text-halo-color': dark ? 'rgba(3,6,11,0.9)' : '#ffffff', 'text-halo-width': 1.4 },
      },
      before,
    );
  renderRings(map);
}

function renderRings(map: MlMap) {
  const src = map.getSource('rings') as GeoJSONSource | undefined;
  if (!src) return;
  if (!getSettings().showRangeRings) {
    src.setData(EMPTY);
    return;
  }
  const c = ringCentre(map);
  const set = RING_SETS[getSettings().units.distance];
  const features: GeoJSON.Feature[] = [];
  // Only rings that are legible at this zoom (≥ 28 px radius, ≤ 2.5 screens).
  const mPerPx = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const screen = Math.max(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  for (const v of set.values) {
    const nm = v * set.toNm;
    const px = (nm * 1852) / mPerPx;
    if (px < 28 || px > screen * 2.5) continue;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: circlePolygon(c.lat, c.lon, nm, 120) }, properties: {} });
    const [la, lo] = destination(c.lat, c.lon, 0, nm);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: { lbl: `${v} ${set.unit}` } });
  }
  src.setData({ type: 'FeatureCollection', features });
}

export function bindRings(map: MlMap): () => void {
  const timer = setInterval(() => {
    if (getSettings().showRangeRings && ui().selectedId) renderRings(map);
  }, 1000);
  const onMove = () => {
    if (getSettings().showRangeRings) renderRings(map);
  };
  map.on('moveend', onMove);
  const u1 = useUI.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId || s.selectedAirport !== p.selectedAirport || s.spotterAirport !== p.spotterAirport) renderRings(map);
  });
  const u2 = useSettings.subscribe((s, p) => {
    if (s.showRangeRings !== p.showRangeRings || s.units.distance !== p.units.distance) {
      for (const l of ['rings-line', 'rings-label']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', s.showRangeRings ? 'visible' : 'none');
      renderRings(map);
    }
  });
  return () => {
    clearInterval(timer);
    map.off('moveend', onMove);
    u1();
    u2();
  };
}

// ---------------------------------------------------------------- precipitation radar (RainViewer)
// Free tier for personal/educational use with attribution; max zoom 7; latest
// past frame only (well inside the 100 requests/minute/IP limit). Tiles are
// requested by the viewer's browser and never stored by us.

export const radarState: { time: number | null; error: string | null } = { time: null, error: null };
const radarListeners = new Set<() => void>();
export const onRadarChange = (fn: () => void) => {
  radarListeners.add(fn);
  return () => radarListeners.delete(fn);
};
export const getRadarState = () => radarState.time ?? radarState.error;
let radarTiles: string | null = null;
let radarFetchedAt = 0;

async function loadRadarFrame(): Promise<string | null> {
  if (radarTiles && Date.now() - radarFetchedAt < 10 * 60_000) return radarTiles;
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { host?: string; radar?: { past?: { time: number; path: string }[] } };
    const last = j.radar?.past?.at(-1);
    // Only accept the documented host/path shapes; never build URLs from arbitrary data.
    if (!j.host || !last || !/^https:\/\/[a-z0-9.-]+\.rainviewer\.com$/.test(j.host) || !/^\/v2\/radar\/[A-Za-z0-9]+$/.test(last.path))
      throw new Error('unexpected response');
    radarTiles = `${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`;
    radarFetchedAt = Date.now();
    radarState.time = last.time * 1000;
    radarState.error = null;
  } catch (e) {
    radarState.error = `Radar unavailable (${(e as Error).message}).`;
  }
  radarListeners.forEach((f) => f());
  return radarTiles;
}

export async function installRadar(map: MlMap) {
  if (!getSettings().showRadar) {
    if (map.getLayer('radar')) map.removeLayer('radar');
    if (map.getSource('radar')) map.removeSource('radar');
    return;
  }
  const tiles = await loadRadarFrame();
  if (!tiles || !getSettings().showRadar) return;
  const src = map.getSource('radar') as { setTiles?: (t: string[]) => void } | undefined;
  if (src) src.setTiles?.([tiles]);
  else
    map.addSource('radar', {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      maxzoom: 7,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">Weather data by Rain Viewer</a>',
    });
  if (!map.getLayer('radar')) {
    const before = ['coverage-fill', 'wx-station', 'apt-cluster', 'ac-heat'].find((l) => map.getLayer(l));
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 300 } }, before);
  }
}

export function bindRadar(map: MlMap): () => void {
  const timer = setInterval(() => {
    if (getSettings().showRadar) void installRadar(map);
  }, 10 * 60_000);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showRadar !== p.showRadar) void installRadar(map);
  });
  return () => {
    clearInterval(timer);
    unsub();
  };
}
