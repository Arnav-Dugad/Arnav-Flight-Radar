// More map overlays:
//   • Day / night — the solar terminator with civil, nautical and astronomical
//     twilight bands, computed locally from the date (no data source needed).
//   • Airspace  — FAA Class B/C/D airspace (United States only; FAA ADDS open data,
//     public domain), loaded for the viewport from zoom 6.
//   • Lightning — NASA GIBS LIS/OTD lightning CLIMATOLOGY (long-term average flash
//     rate). It is not live lightning, and the UI says so.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { demoNow, useDemo } from '@/data/demo';
import { getSettings, useSettings } from '@/state/settings';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const D2R = Math.PI / 180;

/** Below the aircraft and airports, above the base map. */
function beforeId(map: MlMap) {
  return ['coverage-fill', 'wx-station', 'apt-cluster', 'ac-heat'].find((l) => map.getLayer(l));
}

// ---------------------------------------------------------------- day / night

/** Sub-solar point (declination, longitude) — NOAA low-precision algorithm, ±0.1°. */
export function subsolarPoint(t: number): { lat: number; lon: number } {
  const d = t / 86_400_000 - 10_957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / D2R;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / D2R;
  const eqTime = (q - ra) / 15; // hours, wrapped below
  const wrapped = ((((eqTime + 12) % 24) + 24) % 24) - 12;
  const utcHours = (t % 86_400_000) / 3_600_000;
  const lon = -15 * (utcHours - 12 + wrapped);
  return { lat: dec, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

/** Solar elevation (degrees) at a point. */
export function solarElevation(lat: number, lon: number, sun: { lat: number; lon: number }) {
  const h = (lon - sun.lon) * D2R;
  return Math.asin(Math.sin(lat * D2R) * Math.sin(sun.lat * D2R) + Math.cos(lat * D2R) * Math.cos(sun.lat * D2R) * Math.cos(h)) / D2R;
}

const BANDS = [0, -6, -12, -18]; // sunset, civil, nautical, astronomical twilight

/** Night polygons: one feature per band, built as 1°-wide latitude runs per longitude column. */
export function nightFeatures(t: number): GeoJSON.Feature[] {
  const sun = subsolarPoint(t);
  const out: GeoJSON.Feature[] = [];
  const STEP_LON = 1;
  const STEP_LAT = 0.5;
  const lats: number[] = [];
  for (let la = -85; la <= 85; la += STEP_LAT) lats.push(la);
  const polys: GeoJSON.Position[][][][] = BANDS.map(() => []);
  for (let lo = -180; lo < 180; lo += STEP_LON) {
    const elev = lats.map((la) => solarElevation(la, lo + STEP_LON / 2, sun));
    BANDS.forEach((band, bi) => {
      let start: number | null = null;
      for (let i = 0; i <= lats.length; i++) {
        const dark = i < lats.length && elev[i]! < band;
        if (dark && start === null) {
          // Refine the edge by linear interpolation between samples.
          start = i === 0 ? -85 : lats[i - 1]! + ((band - elev[i - 1]!) / (elev[i]! - elev[i - 1]!)) * STEP_LAT;
        } else if (!dark && start !== null) {
          const end = i === lats.length ? 85 : lats[i - 1]! + ((band - elev[i - 1]!) / (elev[i]! - elev[i - 1]!)) * STEP_LAT;
          polys[bi]!.push([
            [
              [lo, start],
              [lo + STEP_LON, start],
              [lo + STEP_LON, end],
              [lo, end],
              [lo, start],
            ],
          ]);
          start = null;
        }
      }
    });
  }
  BANDS.forEach((band, i) => {
    out.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys[i]! }, properties: { band } });
  });
  return out;
}

function dayNightTime() {
  return useDemo.getState().active ? demoNow() : Date.now();
}

export function installDayNight(map: MlMap) {
  if (!map.getSource('daynight')) map.addSource('daynight', { type: 'geojson', data: EMPTY, tolerance: 0.6 });
  if (!map.getLayer('daynight')) {
    const light = getSettings().mapStyle === 'arctic';
    map.addLayer(
      {
        id: 'daynight',
        type: 'fill',
        source: 'daynight',
        layout: { visibility: getSettings().showDayNight ? 'visible' : 'none' },
        paint: {
          'fill-color': light ? '#1b2a4a' : '#00030a',
          'fill-opacity': light ? 0.08 : 0.2,
          'fill-antialias': false,
        },
      },
      beforeId(map),
    );
  }
  map.setLayoutProperty('daynight', 'visibility', getSettings().showDayNight ? 'visible' : 'none');
  renderDayNight(map);
}

function renderDayNight(map: MlMap) {
  if (!getSettings().showDayNight) return;
  (map.getSource('daynight') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: nightFeatures(dayNightTime()) });
}

export function bindDayNight(map: MlMap): () => void {
  const timer = setInterval(() => renderDayNight(map), 60_000);
  const unsubDemo = useDemo.subscribe((s, p) => {
    if (s.active !== p.active || s.speed !== p.speed) renderDayNight(map);
  });
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showDayNight === p.showDayNight) return;
    if (map.getLayer('daynight')) map.setLayoutProperty('daynight', 'visibility', s.showDayNight ? 'visible' : 'none');
    renderDayNight(map);
  });
  // Time-lapse moves the terminator faster.
  const fast = setInterval(() => {
    if (useDemo.getState().active && useDemo.getState().speed > 1) renderDayNight(map);
  }, 5_000);
  return () => {
    clearInterval(timer);
    clearInterval(fast);
    unsub();
    unsubDemo();
  };
}

// ---------------------------------------------------------------- FAA airspace

const AIRSPACE_URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';
export const AIRSPACE_MIN_ZOOM = 6;
export const airspaceState: { status: 'idle' | 'loading' | 'ok' | 'outside' | 'zoom' | 'error'; count: number } = { status: 'idle', count: 0 };
const airspaceListeners = new Set<() => void>();
export const onAirspaceChange = (fn: () => void) => {
  airspaceListeners.add(fn);
  return () => airspaceListeners.delete(fn);
};
const setAirspace = (status: (typeof airspaceState)['status'], count = airspaceState.count) => {
  airspaceState.status = status;
  airspaceState.count = count;
  airspaceListeners.forEach((f) => f());
};

const CLASS_COLOR = ['match', ['get', 'CLASS'], 'B', '#4f8dff', 'C', '#d65cff', 'D', '#5aa9ff', '#9aa6b2'];

export function installAirspace(map: MlMap) {
  if (!map.getSource('airspace')) map.addSource('airspace', { type: 'geojson', data: lastAirspace ?? EMPTY });
  const vis = getSettings().showAirspace ? 'visible' : 'none';
  const before = beforeId(map);
  if (!map.getLayer('airspace-fill'))
    map.addLayer(
      {
        id: 'airspace-fill',
        type: 'fill',
        source: 'airspace',
        minzoom: AIRSPACE_MIN_ZOOM - 0.5,
        layout: { visibility: vis },
        paint: { 'fill-color': CLASS_COLOR as never, 'fill-opacity': ['match', ['get', 'CLASS'], 'B', 0.06, 'C', 0.06, 0.035] as never },
      },
      before,
    );
  if (!map.getLayer('airspace-line'))
    map.addLayer(
      {
        id: 'airspace-line',
        type: 'line',
        source: 'airspace',
        minzoom: AIRSPACE_MIN_ZOOM - 0.5,
        layout: { visibility: vis },
        paint: {
          'line-color': CLASS_COLOR as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 1.8],
          'line-opacity': 0.75,
          'line-dasharray': ['match', ['get', 'CLASS'], 'D', ['literal', [3, 2]], ['literal', [1, 0]]] as never,
        },
      },
      before,
    );
  if (!map.getLayer('airspace-label'))
    map.addLayer(
      {
        id: 'airspace-label',
        type: 'symbol',
        source: 'airspace',
        minzoom: 8,
        layout: {
          visibility: vis,
          'symbol-placement': 'line',
          'text-field': ['get', 'lbl'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 10,
          'symbol-spacing': 320,
          'text-keep-upright': true,
        },
        paint: { 'text-color': CLASS_COLOR as never, 'text-halo-color': 'rgba(3,6,11,0.85)', 'text-halo-width': 1.2 },
      },
      before,
    );
  for (const id of ['airspace-fill', 'airspace-line', 'airspace-label']) map.setLayoutProperty(id, 'visibility', vis);
}

let lastAirspace: GeoJSON.FeatureCollection | null = null;
let lastKey = '';
let controller: AbortController | null = null;

const inUS = (w: number, s: number, e: number, n: number) => e > -180 && w < -64 && n > 17 && s < 72;

function fmtLimit(v: unknown, code: unknown): string {
  if (code === 'SFC' || v === 0) return 'SFC';
  if (typeof v !== 'number') return '?';
  return String(Math.round(v / 100));
}

async function refreshAirspace(map: MlMap) {
  if (!getSettings().showAirspace) return;
  if (map.getZoom() < AIRSPACE_MIN_ZOOM) return setAirspace('zoom');
  const b = map.getBounds();
  const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  if (!inUS(w, s, e, n)) return setAirspace('outside', 0);
  // Snap to a 1° grid so small pans reuse the last response.
  const key = [Math.floor(w), Math.floor(s), Math.ceil(e), Math.ceil(n)].join(',');
  if (key === lastKey) return;
  lastKey = key;
  controller?.abort();
  controller = new AbortController();
  setAirspace('loading');
  const params = new URLSearchParams({
    where: "CLASS IN ('B','C','D')",
    geometry: key,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME,CLASS,LOWER_VAL,LOWER_CODE,UPPER_VAL',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '4',
    maxAllowableOffset: '0.002',
    resultRecordCount: '1500',
    f: 'geojson',
  });
  try {
    const res = await fetch(`${AIRSPACE_URL}?${params}`, { signal: controller.signal, headers: { Accept: 'application/geo+json, application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as GeoJSON.FeatureCollection;
    if (!Array.isArray(j.features)) throw new Error('unexpected response');
    for (const f of j.features) {
      const p = (f.properties ??= {});
      p.lbl = `${p.CLASS ?? ''} ${fmtLimit(p.UPPER_VAL, null)}/${fmtLimit(p.LOWER_VAL, p.LOWER_CODE)}`;
    }
    lastAirspace = j;
    (map.getSource('airspace') as GeoJSONSource | undefined)?.setData(j);
    setAirspace('ok', j.features.length);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    lastKey = '';
    setAirspace('error');
  }
}

export function bindAirspace(map: MlMap): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const onMove = () => {
    clearTimeout(t);
    t = setTimeout(() => void refreshAirspace(map), 450);
  };
  map.on('moveend', onMove);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showAirspace === p.showAirspace) return;
    for (const id of ['airspace-fill', 'airspace-line', 'airspace-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s.showAirspace ? 'visible' : 'none');
    if (s.showAirspace) void refreshAirspace(map);
    else setAirspace('idle', 0);
  });
  void refreshAirspace(map);
  return () => {
    clearTimeout(t);
    map.off('moveend', onMove);
    unsub();
  };
}

// ---------------------------------------------------------------- lightning climatology

const GIBS_LIGHTNING =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/LIS_Very_High_Resolution_Lightning_Full_Climatology_LIS_Mean_Flash_Rate/default/1998-01-01/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';

export function installLightning(map: MlMap) {
  const on = getSettings().showLightning;
  if (!on) {
    if (map.getLayer('lightning')) map.removeLayer('lightning');
    if (map.getSource('lightning')) map.removeSource('lightning');
    return;
  }
  if (!map.getSource('lightning'))
    map.addSource('lightning', {
      type: 'raster',
      tiles: [GIBS_LIGHTNING],
      tileSize: 256,
      maxzoom: 6,
      attribution: '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> lightning climatology (LIS)',
    });
  if (!map.getLayer('lightning')) map.addLayer({ id: 'lightning', type: 'raster', source: 'lightning', paint: { 'raster-opacity': 0.5, 'raster-saturation': 0.35, 'raster-contrast': 0.15, 'raster-fade-duration': 200 } }, beforeId(map));
}

export function bindLightning(map: MlMap): () => void {
  return useSettings.subscribe((s, p) => {
    if (s.showLightning !== p.showLightning) installLightning(map);
  });
}

export function installExtraOverlays(map: MlMap) {
  installDayNight(map);
  installAirspace(map);
  installLightning(map);
}

export function bindExtraOverlays(map: MlMap): () => void {
  const a = bindDayNight(map);
  const b = bindAirspace(map);
  const c = bindLightning(map);
  return () => {
    a();
    b();
    c();
  };
}
