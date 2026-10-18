// More map overlays:
//   • Day / night — the solar terminator with civil, nautical and astronomical
//     twilight bands, computed locally from the date (no data source needed).
//   • Airspace  — FAA Class B/C/D airspace (United States only; FAA ADDS open data,
//     public domain), loaded for the viewport from zoom 6.
//   • Lightning — NASA GIBS LIS/OTD lightning CLIMATOLOGY (long-term average flash
//     rate). It is not live lightning, and the UI says so.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { z } from 'zod';
import { demoNow, demoRoute, demoViewChanged, useDemo } from '@/data/demo';
import { ui, useUI } from '@/state/ui';
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

/**
 * Sub-lunar point and phase — low-precision lunar theory (≈0.5° / a few hours),
 * plenty for a map marker.
 */
export function moonPosition(t: number): { lat: number; lon: number; illumination: number; waxing: boolean; elongation: number } {
  const d = t / 86_400_000 - 10_957.5;
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * D2R;
  const F = (93.272 + 13.22935 * d) * D2R;
  const lam = (L + 6.289 * Math.sin(M)) * D2R;
  const beta = 5.128 * Math.sin(F) * D2R;
  const eps = 23.439 * D2R;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam)) / D2R;
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam)) / D2R;
  const gmst = 280.46061837 + 360.98564736629 * d;
  const lon = ((((ra - gmst + 180) % 360) + 360) % 360) - 180;
  // Sun's ecliptic longitude for the phase.
  const g = (357.529 + 0.98560028 * d) * D2R;
  const sunLam = 280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const elong = ((((lam / D2R - sunLam) % 360) + 360) % 360);
  return { lat: dec, lon, illumination: (1 - Math.cos(elong * D2R)) / 2, waxing: elong < 180, elongation: elong };
}

/** Moon icon with its current phase (lit side to the right when waxing, as seen from the north). */
function drawMoon(illumination: number, waxing: boolean, size = 64): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const glow = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, size / 2);
  glow.addColorStop(0, 'rgba(220,230,255,0.35)');
  glow.addColorStop(1, 'rgba(220,230,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2b3242';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const lit = '#eef2fa';
  const dir = waxing ? 1 : -1;
  // Lit half.
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, dir < 0);
  ctx.closePath();
  ctx.fill();
  // Terminator ellipse: adds light (gibbous) or shadow (crescent).
  const k = 1 - 2 * illumination; // 1 new … -1 full
  ctx.fillStyle = k > 0 ? '#2b3242' : lit;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(k) * r, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function drawSun(size = 64): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 2, cx, cx, size / 2);
  g.addColorStop(0, 'rgba(255,236,170,1)');
  g.addColorStop(0.32, 'rgba(255,200,90,0.95)');
  g.addColorStop(0.45, 'rgba(255,180,70,0.35)');
  g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

let moonKey = '';

function celestialFeatures(map: MlMap, t: number): GeoJSON.Feature[] {
  const sun = subsolarPoint(t);
  const moon = moonPosition(t);
  const key = `${Math.round(moon.illumination * 40)}:${moon.waxing}`;
  if (key !== moonKey || !map.hasImage('moon-phase')) {
    const img = drawMoon(moon.illumination, moon.waxing);
    if (map.hasImage('moon-phase')) map.updateImage('moon-phase', img);
    else map.addImage('moon-phase', img, { pixelRatio: 2 });
    moonKey = key;
  }
  if (!map.hasImage('sun-disc')) map.addImage('sun-disc', drawSun(), { pixelRatio: 2 });
  const pct = Math.round(moon.illumination * 100);
  const phase = pct < 3 ? 'New moon' : pct > 97 ? 'Full moon' : `${moon.waxing ? 'Waxing' : 'Waning'} ${pct < 50 ? 'crescent' : pct === 50 ? 'quarter' : 'gibbous'} · ${pct}%`;
  return [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [sun.lon, sun.lat] }, properties: { icon: 'sun-disc', lbl: 'Sun overhead' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [moon.lon, moon.lat] }, properties: { icon: 'moon-phase', lbl: `Moon overhead
${phase}` } },
  ];
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
  if (!map.getSource('celestial')) map.addSource('celestial', { type: 'geojson', data: EMPTY });
  if (!map.getLayer('celestial'))
    map.addLayer({
      id: 'celestial',
      type: 'symbol',
      source: 'celestial',
      layout: {
        visibility: getSettings().showDayNight ? 'visible' : 'none',
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 1.1],
        'icon-allow-overlap': true,
        'text-field': ['get', 'lbl'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10.5,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#e8eefc', 'text-halo-color': 'rgba(3,6,11,0.85)', 'text-halo-width': 1.3, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.85, 7, 0.6] },
    });
  for (const id of ['daynight', 'celestial']) map.setLayoutProperty(id, 'visibility', getSettings().showDayNight ? 'visible' : 'none');
  renderDayNight(map);
}

function renderDayNight(map: MlMap) {
  if (!getSettings().showDayNight) return;
  const t = dayNightTime();
  (map.getSource('daynight') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: nightFeatures(t) });
  (map.getSource('celestial') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: celestialFeatures(map, t) });
}

export function bindDayNight(map: MlMap): () => void {
  const timer = setInterval(() => renderDayNight(map), 60_000);
  const unsubDemo = useDemo.subscribe((s, p) => {
    if (s.active !== p.active || s.speed !== p.speed) renderDayNight(map);
  });
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showDayNight === p.showDayNight) return;
    for (const id of ['daynight', 'celestial']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s.showDayNight ? 'visible' : 'none');
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

const CLASS_COLOR = ['match', ['get', 'CLASS'], 'A', '#ff6b7d', 'B', '#4f8dff', 'C', '#d65cff', 'D', '#5aa9ff', 'E', '#8fa3bd', '#9aa6b2'];

// ---- openAIP (Canada & Europe, CC BY-NC 4.0): static per-country files built at deploy time.
// Built on first use (the geometry schema is declared further down this module).
const openAipRow = () => z.tuple([airspaceGeometry, z.string(), z.enum(['A', 'B', 'C', 'D', 'E']), z.string(), z.string(), z.string()]);
let openAipIndex: Promise<Record<string, [number, number, number, number]>> | null = null;
const openAipFiles = new Map<string, Promise<AirspaceFeature[]>>();

function loadOpenAipIndex() {
  openAipIndex ??= fetch('/data/airspace/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ countries: Record<string, [number, number, number, number]> }>) : { countries: {} }))
    .then((j) => j.countries)
    .catch(() => ({}));
  return openAipIndex;
}

function loadOpenAip(cc: string): Promise<AirspaceFeature[]> {
  let p = openAipFiles.get(cc);
  if (!p) {
    p = fetch(`/data/airspace/${cc}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ f: unknown[] }>) : { f: [] }))
      .then((j) => {
        const out: AirspaceFeature[] = [];
        const schema = openAipRow();
        for (const raw of j.f) {
          const r = schema.safeParse(raw);
          if (!r.success) continue;
          const [geometry, name, cls, kind, lower, upper] = r.data;
          out.push({
            type: 'Feature',
            geometry: geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
            properties: { name, CLASS: cls, kind, src: 'openaip', lbl: `${cls} ${kind} ${upper}/${lower}` },
          });
        }
        return out;
      })
      .catch(() => {
        openAipFiles.delete(cc);
        return [];
      });
    openAipFiles.set(cc, p);
  }
  return p;
}

export function installAirspace(map: MlMap) {
  if (!map.getSource('airspace'))
    map.addSource('airspace', {
      type: 'geojson',
      data: lastAirspace ?? EMPTY,
      attribution: 'Airspace: FAA ADDS · <a href="https://www.openaip.net" target="_blank" rel="noopener">openAIP</a> (CC BY-NC 4.0)',
    });
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
          'line-dasharray': ['match', ['get', 'CLASS'], 'D', ['literal', [3, 2]], 'E', ['literal', [1, 2]], ['literal', [1, 0]]] as never,
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

// FAA ADDS Class_Airspace layer: only the fields this app reads, validated per feature.
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const ring = z.array(position).min(4);
const airspaceGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
const airspaceClass = z.enum(['B', 'C', 'D']);
const airspaceProps = z.object({
  NAME: z.string().nullish(),
  CLASS: airspaceClass,
  LOWER_VAL: z.number().nullish(),
  LOWER_CODE: z.string().nullish(),
  UPPER_VAL: z.number().nullish(),
});
const airspaceFeature = z.object({ type: z.literal('Feature'), geometry: airspaceGeometry, properties: airspaceProps });
const airspaceCollection = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) });

export type AirspaceClass = 'A' | 'B' | 'C' | 'D' | 'E';
export interface AirspaceProperties {
  name: string;
  CLASS: AirspaceClass;
  /** CTR / TMA / CTA / TCA for openAIP areas; absent for FAA class areas. */
  kind?: string;
  src: 'faa' | 'openaip';
  /** Ceiling/floor label in hundreds of feet, e.g. "B 100/SFC". */
  lbl: string;
  lowerFt?: number;
  upperFt?: number;
}
export type AirspaceFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, AirspaceProperties>;

/** Validate an ArcGIS GeoJSON response; malformed features are dropped, never guessed. */
export function parseAirspace(json: unknown): { features: AirspaceFeature[]; dropped: number } {
  const fc = airspaceCollection.safeParse(json);
  if (!fc.success) throw new Error('unexpected response');
  const features: AirspaceFeature[] = [];
  let dropped = 0;
  for (const raw of fc.data.features) {
    const f = airspaceFeature.safeParse(raw);
    if (!f.success) {
      dropped++;
      continue;
    }
    const p = f.data.properties;
    const props: AirspaceProperties = {
      name: p.NAME ?? '',
      CLASS: p.CLASS,
      src: 'faa',
      lbl: `${p.CLASS} ${fmtLimit(p.UPPER_VAL, null)}/${fmtLimit(p.LOWER_VAL, p.LOWER_CODE)}`,
    };
    if (typeof p.LOWER_VAL === 'number') props.lowerFt = p.LOWER_VAL;
    if (typeof p.UPPER_VAL === 'number') props.upperFt = p.UPPER_VAL;
    features.push({ type: 'Feature', geometry: f.data.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon, properties: props });
  }
  return { features, dropped };
}

let lastAirspace: GeoJSON.FeatureCollection | null = null;
let lastKey = '';
let controller: AbortController | null = null;

const inUS = (w: number, s: number, e: number, n: number) => e > -180 && w < -64 && n > 17 && s < 72;

function fmtLimit(v: number | null | undefined, code: string | null | undefined): string {
  if (code === 'SFC' || v === 0) return 'SFC';
  if (typeof v !== 'number') return '?';
  return String(Math.round(v / 100));
}

async function refreshAirspace(map: MlMap) {
  if (!getSettings().showAirspace) return;
  if (map.getZoom() < AIRSPACE_MIN_ZOOM) return setAirspace('zoom');
  const b = map.getBounds();
  const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const index = await loadOpenAipIndex();
  const countries = Object.entries(index)
    .filter(([, bb]) => bb[0] < e && bb[2] > w && bb[1] < n && bb[3] > s)
    .map(([cc]) => cc);
  const us = inUS(w, s, e, n);
  if (!us && !countries.length) return setAirspace('outside', 0);
  // Snap to a 1° grid so small pans reuse the last response.
  const key = [Math.floor(w), Math.floor(s), Math.ceil(e), Math.ceil(n)].join(',');
  if (key === lastKey) return;
  lastKey = key;
  controller?.abort();
  controller = new AbortController();
  setAirspace('loading');
  const other = (await Promise.all(countries.map(loadOpenAip))).flat();
  if (!us) {
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: other };
    lastAirspace = fc;
    (map.getSource('airspace') as GeoJSONSource | undefined)?.setData(fc);
    setAirspace('ok', other.length);
    return;
  }
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
    const { features: faa } = parseAirspace(await res.json());
    const features = [...faa, ...other];
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    lastAirspace = fc;
    (map.getSource('airspace') as GeoJSONSource | undefined)?.setData(fc);
    setAirspace('ok', features.length);
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
  // Coarse (≈0.1°) data: fade out as you zoom in, where it would only show blocks.
  if (!map.getLayer('lightning'))
    map.addLayer(
      {
        id: 'lightning',
        type: 'raster',
        source: 'lightning',
        maxzoom: 7.5,
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 5.5, 0.5, 7.5, 0],
          'raster-saturation': 0.35,
          'raster-contrast': 0.15,
          'raster-fade-duration': 200,
        },
      },
      beforeId(map),
    );
}

export function bindLightning(map: MlMap): () => void {
  return useSettings.subscribe((s, p) => {
    if (s.showLightning !== p.showLightning) installLightning(map);
  });
}

// ---------------------------------------------------------------- route line (demo)

/** Make longitudes continuous so a route across the antimeridian draws as one line. */
function unwrap(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let prev: number | undefined;
  for (const [lat, lon] of pts) {
    let l = lon;
    if (prev !== undefined) {
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    out.push([l, lat]);
    prev = l;
  }
  return out;
}

export function installRoute(map: MlMap) {
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY });
  const before = map.getLayer('ac-trails') ? 'ac-trails' : undefined;
  if (!map.getLayer('route-ahead'))
    map.addLayer(
      {
        id: 'route-ahead',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'k'], 'ahead'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffd28a', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 10, 2.2], 'line-opacity': 0.75, 'line-dasharray': [2, 2.2] },
      },
      before,
    );
  if (!map.getLayer('route-ends'))
    map.addLayer(
      {
        id: 'route-ends',
        type: 'circle',
        source: 'route',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'k'], 'diverted', '#ff8a9a', '#ffd28a'],
          'circle-stroke-color': 'rgba(3,6,11,0.9)',
          'circle-stroke-width': 2,
        },
      },
      before,
    );
  if (!map.getLayer('route-labels'))
    map.addLayer({
      id: 'route-labels',
      type: 'symbol',
      source: 'route',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': '#ffd28a', 'text-halo-color': 'rgba(3,6,11,0.9)', 'text-halo-width': 1.4 },
    });
}

function renderRoute(map: MlMap) {
  const src = map.getSource('route') as GeoJSONSource | undefined;
  if (!src) return;
  const r = useDemo.getState().active ? demoRoute(ui().selectedId) : undefined;
  if (!r) {
    src.setData(EMPTY);
    return;
  }
  const code = (a: { iata?: string; ident: string }) => a.iata ?? a.ident;
  const feats: GeoJSON.Feature[] = [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(r.ahead) }, properties: { k: 'ahead' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [r.from.lon, r.from.lat] }, properties: { k: 'from', lbl: code(r.from) } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [r.to.lon, r.to.lat] }, properties: { k: 'to', lbl: code(r.to) } },
  ];
  if (r.divertedFrom) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.divertedFrom.lon, r.divertedFrom.lat] }, properties: { k: 'diverted', lbl: `${code(r.divertedFrom)} (diverted)` } });
  src.setData({ type: 'FeatureCollection', features: feats });
}

export function bindRoute(map: MlMap): () => void {
  const timer = setInterval(() => renderRoute(map), 2000);
  const unsub = useUI.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId) renderRoute(map);
  });
  const onMove = () => {
    if (!useDemo.getState().active) return;
    const c = map.getCenter();
    const b = map.getBounds();
    demoViewChanged({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  };
  map.on('moveend', onMove);
  const unsubDemo = useDemo.subscribe((s, p) => {
    if (s.active && !s.loading && p.loading) onMove();
    if (!s.active) renderRoute(map);
  });
  return () => {
    clearInterval(timer);
    unsub();
    unsubDemo();
    map.off('moveend', onMove);
  };
}

export function installExtraOverlays(map: MlMap) {
  installRoute(map);
  installDayNight(map);
  installAirspace(map);
  installLightning(map);
}

export function bindExtraOverlays(map: MlMap): () => void {
  const a = bindDayNight(map);
  const b = bindAirspace(map);
  const c = bindLightning(map);
  const d = bindRoute(map);
  return () => {
    a();
    b();
    c();
    d();
  };
}
