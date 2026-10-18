// Owns the single MapLibre instance: creation, style swaps, projection, camera
// choreography, user location, URL sync and engine start-up.

import type * as GeoJSON from 'geojson';
import { GeoJSONSource, Map as MlMap, setWorkerUrl, type LngLatLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { startEmergencyAlerts } from '@/data/alerts';
import { startFeed } from '@/data/feed';
import { readUrlState, writeUrlState } from '@/lib/urlState';
import { load, save } from '@/lib/storage';
import { getSettings, useSettings, type MapStyleId } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui, useUI, type Projection } from '@/state/ui';
import { useView } from '@/state/view';
import { installAircraftLayers, startAircraftEngine, AIRCRAFT_LAYERS, type AircraftEngine } from './aircraftLayer';
import { bindAirportInteraction, installAirportLayers, AIRPORT_LAYERS } from './airportsLayer';
import { bindMeasure, bindRadar, bindRings, bindWeather, installCoverage, installMeasure, installRadar, installRings, installWeather, refreshWeather } from './overlays';
import { cameraFlags, viewOffset, viewPadding } from './camera';
import { buildStyle, TERRAIN_SOURCE } from './styles';

setWorkerUrl(workerUrl);

let map: MlMap | null = null;
let engine: AircraftEngine | null = null;
const cleanups: (() => void)[] = [];
let lastInteraction = Date.now();

export const getMap = () => map;
export const getEngine = () => engine;

const FALLBACK_VIEW = { lat: 51.47, lon: -0.4543, zoom: 7.6 }; // London Heathrow area

function currentStyle(id: MapStyleId = getSettings().mapStyle) {
  const s = getSettings();
  return buildStyle(id, s.labelDensity, ui().projection === 'globe', s.terrain3d);
}

function installAll(m: MlMap) {
  installAircraftLayers(m);
  installCoverage(m);
  installWeather(m);
  void installAirportLayers(m);
  installMeasure(m);
  installRings(m);
  void installRadar(m);
  installUserLocation(m);
  applyTerrain(m);
  engine?.markDirty();
}

function applyTerrain(m: MlMap) {
  const s = getSettings();
  const want = s.terrain3d && !!m.getSource(TERRAIN_SOURCE);
  try {
    m.setTerrain(want ? { source: TERRAIN_SOURCE, exaggeration: 1.35 } : null);
  } catch (e) {
    console.warn('terrain unavailable', e);
  }
}

export function createMap(container: HTMLElement): MlMap {
  const url = readUrlState();
  if (url.style) useSettings.getState().set('mapStyle', url.style);
  if (url.globe) ui().setProjection('globe');
  const s = getSettings();
  const last = s.rememberLastView ? load<{ lat: number; lon: number; zoom: number } | null>('lastView', null) : null;
  const start = url.lat !== undefined ? { lat: url.lat, lon: url.lon!, zoom: url.zoom ?? 8 } : (last ?? s.defaultView ?? FALLBACK_VIEW);

  map = new MlMap({
    container,
    style: currentStyle(),
    center: [start.lon, start.lat],
    zoom: start.zoom,
    bearing: url.bearing ?? 0,
    pitch: url.pitch ?? 0,
    maxPitch: 78,
    minZoom: 1,
    maxZoom: 17.5,
    attributionControl: false,
    fadeDuration: 180,
    renderWorldCopies: true,
  });
  const m = map;
  // Development-only handle for automated tests and debugging (not in production builds).
  if (import.meta.env.DEV) Object.assign(window, { __arnav: { map: m, traffic } });
  m.on('style.load', () => {
    installAll(m);
    setTimeout(() => ui().setStyleLoading(false), 120);
  });
  m.on('error', (e) => {
    // Tile/glyph hiccups are reported but must never take the app down.
    console.warn('map error', e.error?.message ?? e);
  });

  m.once('load', () => {
    engine = startAircraftEngine(m);
    cleanups.push(() => engine?.stop());
    cleanups.push(startFeed(m));
    cleanups.push(bindAirportInteraction(m));
    cleanups.push(bindWeather(m));
    cleanups.push(bindMeasure(m));
    cleanups.push(bindRings(m));
    cleanups.push(startEmergencyAlerts());
    cleanups.push(bindRadar(m));
    cleanups.push(bindUrlSync(m));
    cleanups.push(bindAutoRotate(m));
    cleanups.push(bindCursor(m));
    cleanups.push(bindFollowPause(m));
    cleanups.push(bindSettingsToMap(m));
    cleanups.push(bindViewStore(m));
    void refreshWeather(m);

    // Deselect when clicking empty map (aircraft/airport/weather layers handle their own clicks).
    m.on('click', (e) => {
      if (ui().measure.active) return;
      const layers = [...AIRCRAFT_LAYERS, ...AIRPORT_LAYERS, 'wx-station'].filter((l) => m.getLayer(l));
      const hits = m.queryRenderedFeatures(e.point, { layers });
      if (!hits.length && ui().selectedId && !ui().following) ui().select(null);
    });

    // On phones the details sheet covers the lower half: ease the selection into view.
    cleanups.push(
      useUI.subscribe((s, p) => {
        if (s.selectedId && s.selectedId !== p.selectedId && window.innerWidth < 768 && !s.following) {
          const t = traffic.get(s.selectedId);
          if (!t) return;
          const pos = traffic.displayPosition(t);
          m.easeTo({ center: [pos.lon, pos.lat], offset: viewOffset(), duration: motionMs(600) });
        }
      }),
    );

    if (url.aircraft) {
      ui().select(url.aircraft, { follow: url.follow ?? false });
    }
    if (url.airport) ui().selectAirport(url.airport);
  });

  return m;
}

export function destroyMap() {
  cleanups.splice(0).forEach((c) => c());
  map?.remove();
  map = null;
  engine = null;
}

// ---------------------------------------------------------------- styles

export function setMapStyle(id: MapStyleId) {
  if (!map) return;
  ui().setStyleLoading(true);
  // Let the veil fade in before the swap so the change feels like a crossfade.
  setTimeout(() => {
    map?.setStyle(currentStyle(id), { diff: false });
  }, 140);
}

export function rebuildStyle() {
  if (map) setMapStyle(getSettings().mapStyle);
}

// ---------------------------------------------------------------- projection

export function setProjection(p: Projection) {
  if (!map) return;
  ui().setProjection(p);
  map.setProjection({ type: p === 'globe' ? 'globe' : 'mercator' });
  if (p === 'globe' && map.getZoom() > 3.2) {
    map.flyTo({ zoom: 2.3, pitch: 0, bearing: 0, duration: motionMs(2200), essential: false, curve: 1.6 });
  }
}

// ---------------------------------------------------------------- camera

export function motionMs(ms: number) {
  const m = getSettings().motion;
  return m === 'off' ? 0 : m === 'reduced' ? Math.round(ms * 0.35) : ms;
}

export function flyTo(lon: number, lat: number, zoom?: number, opts: { pitch?: number; bearing?: number; duration?: number } = {}) {
  if (!map) return;
  lastInteraction = Date.now();
  const target = zoom ?? Math.max(map.getZoom(), 8);
  map.flyTo({
    offset: viewOffset(),
    center: [lon, lat] as LngLatLike,
    zoom: target,
    pitch: opts.pitch ?? map.getPitch(),
    bearing: opts.bearing ?? map.getBearing(),
    duration: motionMs(opts.duration ?? 1800),
    curve: 1.5,
    essential: false,
  });
}

export function fitBounds(w: number, s: number, e: number, n: number) {
  if (!map) return;
  map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: 60, duration: motionMs(1600), maxZoom: 9 },
  );
}

export function zoomBy(delta: number) {
  map?.easeTo({ zoom: map.getZoom() + delta, duration: motionMs(300) });
}

export function resetNorth() {
  map?.easeTo({ bearing: 0, pitch: 0, duration: motionMs(700) });
}

export function setPitch(p: number) {
  map?.easeTo({ pitch: p, duration: motionMs(900) });
}

export function focusAircraft(id: string, zoom?: number) {
  const t = traffic.get(id);
  if (!t || !map) return;
  const pos = traffic.displayPosition(t);
  flyTo(pos.lon, pos.lat, zoom ?? Math.max(map.getZoom(), 8.5));
}

export function startFollow(id: string) {
  const t = traffic.get(id);
  if (!t || !map) return;
  const s = getSettings();
  const pos = traffic.displayPosition(t);
  ui().setFollowing(true);
  ui().setFollowPaused(true); // pause until the camera lands
  map.flyTo({
    padding: viewPadding(),
    center: [pos.lon, pos.lat],
    zoom: s.followZoom,
    pitch: s.followPitch,
    bearing: s.cameraMode === 'heading-up' ? (pos.trk ?? 0) : map.getBearing(),
    duration: motionMs(1600),
    essential: false,
  });
  map.once('moveend', () => {
    if (ui().following) ui().setFollowPaused(false);
  });
}

export function stopFollow() {
  ui().setFollowing(false);
  if (!map) return;
  // Drop the follow padding without moving what is on screen.
  const c = map.getCanvas();
  const visualCentre = map.unproject([c.clientWidth / 2, c.clientHeight / 2]);
  map.jumpTo({ center: visualCentre, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  map.easeTo({ pitch: 0, duration: motionMs(800) });
}

// ---------------------------------------------------------------- user location

const ME = 'me';
let meData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function installUserLocation(m: MlMap) {
  if (!m.getSource(ME)) m.addSource(ME, { type: 'geojson', data: meData });
  if (!m.getLayer('me-accuracy'))
    m.addLayer({
      id: 'me-accuracy',
      type: 'circle',
      source: ME,
      paint: { 'circle-radius': 18, 'circle-color': 'rgba(92,225,255,0.12)', 'circle-stroke-color': 'rgba(92,225,255,0.4)', 'circle-stroke-width': 1 },
    });
  if (!m.getLayer('me-dot'))
    m.addLayer({
      id: 'me-dot',
      type: 'circle',
      source: ME,
      paint: { 'circle-radius': 6, 'circle-color': '#5ce1ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
}

export function locateUser(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        meData = {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.coords.longitude, p.coords.latitude] }, properties: {} }],
        };
        (map?.getSource(ME) as GeoJSONSource | undefined)?.setData(meData);
        flyTo(p.coords.longitude, p.coords.latitude, 9);
        resolve();
      },
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission was denied.' : 'Your location could not be determined.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}

// ---------------------------------------------------------------- bindings

function bindUrlSync(m: MlMap): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const c = m.getCenter();
      const u = ui();
      writeUrlState({
        lat: c.lat,
        lon: c.lng,
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
        style: getSettings().mapStyle,
        globe: u.projection === 'globe',
        aircraft: u.selectedId && !u.selectedId.startsWith('~') ? u.selectedId : undefined,
        airport: u.selectedAirport ?? undefined,
        follow: u.following,
      });
      if (getSettings().rememberLastView) save('lastView', { lat: c.lat, lon: c.lng, zoom: m.getZoom() });
    }, 400);
  };
  m.on('moveend', write);
  const u1 = useUI.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId || s.selectedAirport !== p.selectedAirport || s.following !== p.following || s.projection !== p.projection)
      write();
  });
  const u2 = useSettings.subscribe((s, p) => {
    if (s.mapStyle !== p.mapStyle) write();
  });
  return () => {
    clearTimeout(t);
    m.off('moveend', write);
    u1();
    u2();
  };
}

function bindAutoRotate(m: MlMap): () => void {
  let raf = 0;
  let last = performance.now();
  const touch = () => (lastInteraction = Date.now());
  const container = m.getCanvasContainer();
  container.addEventListener('pointerdown', touch);
  container.addEventListener('wheel', touch, { passive: true });
  container.addEventListener('touchstart', touch, { passive: true });
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = now - last;
    last = now;
    const s = getSettings();
    const u = ui();
    const should =
      u.projection === 'globe' &&
      s.globeAutoRotate &&
      s.motion === 'full' &&
      !u.following &&
      !document.hidden &&
      m.getZoom() < 3.4 &&
      Date.now() - lastInteraction > 6000 &&
      !m.isMoving();
    cameraFlags.autoRotating = should;
    if (should) {
      const c = m.getCenter();
      m.setCenter([c.lng + dt * 0.0035, c.lat]);
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    container.removeEventListener('pointerdown', touch);
    container.removeEventListener('wheel', touch);
    container.removeEventListener('touchstart', touch);
  };
}

function bindCursor(m: MlMap): () => void {
  let pending: { lat: number; lon: number } | null = null;
  let raf = 0;
  const onMove = (e: { lngLat: { lat: number; lng: number } }) => {
    pending = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        ui().setCursor(pending);
      });
  };
  const onOut = () => ui().setCursor(null);
  m.on('mousemove', onMove);
  m.on('mouseout', onOut);
  return () => {
    m.off('mousemove', onMove);
    m.off('mouseout', onOut);
    cancelAnimationFrame(raf);
  };
}

function bindFollowPause(m: MlMap): () => void {
  // Any manual camera gesture pauses following; "Return to aircraft" resumes.
  const pause = (e: { originalEvent?: Event }) => {
    if (!e.originalEvent) return;
    const u = ui();
    if (u.following && !u.followPaused) u.setFollowPaused(true);
  };
  m.on('dragstart', pause);
  m.on('rotatestart', pause);
  m.on('pitchstart', pause);
  return () => {
    m.off('dragstart', pause);
    m.off('rotatestart', pause);
    m.off('pitchstart', pause);
  };
}

function bindSettingsToMap(m: MlMap): () => void {
  return useSettings.subscribe((s, p) => {
    if (s.mapStyle !== p.mapStyle || s.labelDensity !== p.labelDensity) setMapStyle(s.mapStyle);
    else if (s.terrain3d !== p.terrain3d) {
      if (s.terrain3d && !m.getSource(TERRAIN_SOURCE)) setMapStyle(s.mapStyle);
      else applyTerrain(m);
      if (s.terrain3d && m.getPitch() < 30) m.easeTo({ pitch: 55, duration: motionMs(1200) });
    }
  });
}

function bindViewStore(m: MlMap): () => void {
  let raf = 0;
  const push = () => {
    raf = 0;
    const c = m.getCenter();
    useView.setState({ zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), lat: c.lat, lon: c.lng, ready: true });
  };
  const onMove = () => {
    if (!raf) raf = requestAnimationFrame(push);
  };
  m.on('move', onMove);
  push();
  return () => {
    m.off('move', onMove);
    cancelAnimationFrame(raf);
  };
}
