// Flight-sim style chase camera (fetched on demand the first time the chase view starts).
//
//  • The map centre is put ON the aircraft, at the altitude its 3D model is drawn at (the
//    centre elevation is no longer clamped to the ground), so MapLibre's camera sits a few
//    tens of metres behind and above the model instead of looking down from kilometres away.
//  • Heading, tilt and distance follow critically damped springs, so turns swing round
//    smoothly with no overshoot and no jitter. Position stays locked, so the model never drifts.
//  • Drag (mouse or one finger) orbits around the aircraft, the wheel / a pinch changes the
//    distance, a double-click goes back behind it. These gestures never pause following.
//  • Sky, horizon and fog colours follow the simulated sun at the aircraft.
//
// Everything shown is the output of the simulator; nothing here is live data.

import { MercatorCoordinate, type Map as MlMap, type PaddingOptions, type SkySpecification } from 'maplibre-gl';
import { specOf } from '@/data/sim/typeSpecs';
import { simElevationFt, simNow } from '@/data/world';
import { getSettings, useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui, useUI } from '@/state/ui';
import { applyAircraftSettings } from './aircraftLayer';
import { chaseHooks, chaseState, viewPadding } from './camera';
import { solarElevation, subsolarPoint } from './extraOverlays';

const D2R = Math.PI / 180;
const EARTH_CIRC = 40_075_016.686;
/** Steeper tilts make MapLibre load tiles all the way to the horizon from 10 km up: too heavy. */
const MAX_PITCH = 82;

// ------------------------------------------------------------------ pure helpers (unit tested)

export interface Spring {
  x: number;
  v: number;
}

/**
 * One step of a critically damped spring towards `target` (exact solution, so it is stable
 * for any frame time and never overshoots). `omega` is the natural frequency in rad/s: the
 * spring covers ~95% of a step change in about 4.7 / omega seconds.
 */
export function springStep(s: Spring, target: number, omega: number, dt: number): Spring {
  if (!(dt > 0)) return s;
  if (!(omega > 0) || !Number.isFinite(omega)) {
    s.x = target;
    s.v = 0;
    return s;
  }
  const x = s.x - target;
  const e = Math.exp(-omega * dt);
  const k = (s.v + omega * x) * dt;
  s.v = (s.v - omega * k) * e;
  s.x = target + (x + k) * e;
  return s;
}

/** Signed shortest difference b − a in degrees, in [−180, 180). */
export function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Spring on a compass angle (degrees) that always turns the short way round. Result in [0, 360). */
export function angleSpringStep(s: Spring, targetDeg: number, omega: number, dt: number): Spring {
  springStep(s, s.x + wrap180(targetDeg - s.x), omega, dt);
  s.x = ((s.x % 360) + 360) % 360;
  return s;
}

/**
 * Camera distance (m) from which an aircraft fills a comfortable share of the view: its span
 * across ~38% of the width, or its height-on-screen across ~34% of the visible band.
 */
export function chaseDistanceM(lengthM: number, spanM: number, viewW: number, viewH: number, fovDeg: number): number {
  const t = 2 * Math.tan((fovDeg * D2R) / 2); // view height per metre of distance
  const visW = t * (viewW / Math.max(1, viewH));
  const span = Math.max(8, spanM || 30);
  const len = Math.max(8, lengthM || 30);
  const dW = span / (0.38 * visW);
  const dH = (0.32 * span + 0.12 * len) / (0.34 * t);
  return Math.min(900, Math.max(22, Math.max(dW, dH)));
}

/** MapLibre zoom that puts the camera `distM` metres from a centre at latitude `lat`. */
export function zoomForDistance(distM: number, lat: number, canvasH: number, fovDeg: number): number {
  const cameraToCenterPx = (0.5 * canvasH) / Math.tan((fovDeg * D2R) / 2);
  const mercPerM = 1 / (EARTH_CIRC * Math.cos(lat * D2R));
  return Math.log2(cameraToCenterPx / (distM * mercPerM * 512));
}

type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

// Sky keyframes by sun altitude (degrees): zenith sky, horizon band, fog over the ground.
const SKY_KEYS: [number, Rgb, Rgb, Rgb][] = [
  [-18, hex('#02050c'), hex('#08122a'), hex('#050a16')], // night
  [-9, hex('#0a1430'), hex('#28305a'), hex('#141a33')], // nautical twilight
  [-3, hex('#1d2e5e'), hex('#d0705a'), hex('#5a4a62')], // civil twilight, glowing horizon
  [3, hex('#3a62a8'), hex('#ffad6b'), hex('#d9a58a')], // sunrise / sunset
  [10, hex('#3f7cd0'), hex('#ffd9a8'), hex('#cfd8e2')], // golden hour
  [25, hex('#2f78dc'), hex('#cfe4f7'), hex('#d6e3ef')], // day
];

/** Sky, horizon and fog colours for the chase view from the sun altitude at the aircraft. */
export function chaseSky(sunAltDeg: number): SkySpecification {
  const a = Number.isFinite(sunAltDeg) ? sunAltDeg : 30;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && a > SKY_KEYS[i + 1]![0]) i++;
  const k0 = SKY_KEYS[i]!;
  const k1 = SKY_KEYS[i + 1]!;
  const f = Math.min(1, Math.max(0, (a - k0[0]) / (k1[0] - k0[0])));
  const mix = (p: Rgb, q: Rgb): Rgb => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  const day = Math.min(1, Math.max(0, (a + 6) / 16));
  return {
    'sky-color': css(mix(k0[1], k1[1])),
    'horizon-color': css(mix(k0[2], k1[2])),
    'fog-color': css(mix(k0[3], k1[3])),
    'sky-horizon-blend': 0.55 + 0.25 * day,
    'horizon-fog-blend': 0.55 + 0.2 * day,
    'fog-ground-blend': 0.45 + 0.2 * day,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  };
}

/** Height (m) the 3D model is drawn at, matching modelsBridge: MSL with terrain, above the field without. */
export function modelAltitudeM(altFt: number | undefined, fieldFt: number, onGround: boolean, terrain: boolean): number {
  const alt = onGround ? fieldFt : (altFt ?? fieldFt);
  return (terrain ? alt : Math.max(0, alt - fieldFt)) * 0.3048;
}

// ------------------------------------------------------------------ camera controller

export interface ChaseHandle {
  /** Positions the camera; called once per animation frame by the aircraft engine, before the map renders. */
  frame(now: number): void;
  dispose(): void;
}

/** Layers that make no sense with the camera up at the aircraft (they are drawn on the ground). */
const HIDE_ALWAYS = ['ac-sel-ribbon', 'ac-sel-trail', 'ac-labels', 'ac-trails', 'ac-heat'];
/** Selection markers: hidden while the true-scale model stands in for them. */
const HIDE_WITH_MODELS = ['ac-sel-glow', 'ac-sel-ring', 'ac-sel-icon', 'ac-sel-label', 'ac-sel-report'];

interface Cam {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  elev: number;
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function startChaseView(map: MlMap): ChaseHandle {
  let active = false;
  let intro: { t0: number; dur: number; from: Cam } | null = null;
  const hdg: Spring = { x: 0, v: 0 };
  const tilt: Spring = { x: 80, v: 0 };
  const zoomS: Spring = { x: 16, v: 0 };
  const yawS: Spring = { x: 0, v: 0 };
  const orbit = { yaw: 0, pitch: 0, zoom: 0 };
  let last = 0;
  let savedSky: SkySpecification | undefined;
  let skyAt = 0;
  let prevMaxPitch = 78;
  let prevMaxZoom = 19;
  let restorePending = false;
  let lastId: string | null = null;
  let hdgPrimed = false;
  let touchAction = '';
  let sky: SkySpecification = chaseSky(30);
  let haze: HTMLDivElement | null = null;

  const motion = () => getSettings().motion;
  const reduced = () => motion() !== 'full' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const modelsOn = () => getSettings().show3dModels;

  // ---------------------------------------------------------------- map dressing
  const setVis = (ids: string[], visible: boolean) => {
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  };
  const dress = () => {
    setVis(HIDE_ALWAYS, false);
    setVis(HIDE_WITH_MODELS, !modelsOn());
    applySky(true);
  };
  const undress = () => {
    setVis(HIDE_WITH_MODELS, true);
    setVis(['ac-labels'], true);
    applyAircraftSettings(map); // heatmap, trails and 3D path back to what the settings say
    try {
      if (savedSky) map.setSky(savedSky);
    } catch {
      /* style is being swapped: it brings its own sky */
    }
  };
  const applySky = (force = false) => {
    const now = performance.now();
    if (!force && now - skyAt < 2000) return;
    skyAt = now;
    const c = map.getCenter();
    try {
      sky = chaseSky(solarElevation(c.lat, c.lng, subsolarPoint(simNow())));
      map.setSky(sky);
    } catch {
      /* style not ready */
    }
  };
  const onStyle = () => {
    if (!active) return;
    try {
      savedSky = map.getSky();
    } catch {
      savedSky = undefined;
    }
    // The aircraft layers are re-installed by the controller's own style.load handler.
    setTimeout(() => active && dress(), 0);
  };

  // ---------------------------------------------------------------- gestures (orbit)
  const container = map.getContainer();
  const canvasBox = map.getCanvasContainer();
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = { x: 0, y: 0 };
  let moved = 0;
  let pinch0 = 0;
  let pinchZoom0 = 0;
  const onMap = (e: Event) => e.target instanceof Node && canvasBox.contains(e.target);
  const block = (e: Event) => {
    if (!active || !onMap(e)) return;
    e.stopPropagation();
  };
  const blockPrevent = (e: Event) => {
    if (!active || !onMap(e)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };
  const spread = () => {
    const p = [...pointers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
  };
  const onDown = (e: PointerEvent) => {
    if (!active || !onMap(e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      moved = 0;
    } else if (pointers.size === 2) {
      pinch0 = spread();
      pinchZoom0 = orbit.zoom;
    }
  };
  const onMovePtr = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!active || !p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    moved = Math.max(moved, Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y));
    if (pointers.size >= 2) {
      const d = spread();
      if (pinch0 > 0 && d > 0) orbit.zoom = clampZoomOffset(pinchZoom0 + Math.log2(d / pinch0));
      orbit.yaw -= (dx * 0.5) / 2; // each finger contributes half
      return;
    }
    orbit.yaw -= dx * 0.32;
    orbit.pitch = Math.max(-38, Math.min(6, orbit.pitch - dy * 0.22));
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = 0;
  };
  const onWheel = (e: WheelEvent) => {
    if (!active || !onMap(e)) return;
    e.stopPropagation();
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    orbit.zoom = clampZoomOffset(orbit.zoom - px * 0.0022);
  };
  const onClick = (e: Event) => {
    // Clicks on the map would select ground-level icons far below the camera: ignore them.
    if (!active || !onMap(e)) return;
    e.stopPropagation();
    if (moved > 6) e.preventDefault();
  };
  const onDbl = (e: Event) => {
    if (!active || !onMap(e)) return;
    e.stopPropagation();
    e.preventDefault();
    resetOrbit();
  };
  const cap = { capture: true };
  const capActive = { capture: true, passive: false };
  container.addEventListener('pointerdown', onDown, cap);
  window.addEventListener('pointermove', onMovePtr, cap);
  window.addEventListener('pointerup', onUp, cap);
  window.addEventListener('pointercancel', onUp, cap);
  container.addEventListener('mousedown', block, cap);
  container.addEventListener('touchstart', block, capActive);
  container.addEventListener('touchmove', blockPrevent, capActive);
  container.addEventListener('wheel', onWheel, capActive);
  container.addEventListener('click', onClick, cap);
  container.addEventListener('dblclick', onDbl, cap);
  container.addEventListener('contextmenu', blockPrevent, cap);

  function clampZoomOffset(z: number) {
    return Math.max(-3.2, Math.min(1.6, z));
  }
  function resetOrbit() {
    // Shortest way back to "behind": the yaw spring swings the camera round.
    orbit.yaw = 0;
    yawS.x = wrap180(yawS.x);
    orbit.pitch = 0;
    orbit.zoom = 0;
    chaseState.orbited = false;
  }

  // ---------------------------------------------------------------- enter / leave
  const current = (): Cam => {
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), elev: map.getCenterElevation() };
  };

  const enter = () => {
    active = true;
    chaseState.active = true;
    restorePending = false;
    if (map.getMaxPitch() < MAX_PITCH) {
      prevMaxPitch = map.getMaxPitch();
      map.setMaxPitch(MAX_PITCH);
    }
    if (map.getMaxZoom() < 21) {
      prevMaxZoom = map.getMaxZoom();
      map.setMaxZoom(21);
    }
    map.setCenterClampedToGround(false);
    // One-finger orbit needs every pointermove: no browser panning on the map while chasing.
    touchAction = canvasBox.style.touchAction;
    canvasBox.style.touchAction = 'none';
    try {
      savedSky = map.getSky();
    } catch {
      savedSky = undefined;
    }
    resetOrbit();
    yawS.x = 0;
    yawS.v = 0;
    const from = current();
    hdg.x = ((from.bearing % 360) + 360) % 360;
    hdg.v = 0;
    tilt.x = from.pitch;
    tilt.v = 0;
    zoomS.x = from.zoom;
    zoomS.v = 0;
    last = 0;
    lastId = ui().selectedId;
    beginIntro(2600);
    dress();
    haze = document.createElement('div');
    haze.setAttribute('aria-hidden', 'true');
    haze.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none;display:none;';
    canvasBox.appendChild(haze);
    chaseHooks.zoomBy = (d) => {
      if (!active) return false;
      orbit.zoom = clampZoomOffset(orbit.zoom + d * 0.6);
      return true;
    };
    chaseHooks.reset = resetOrbit;
    map.triggerRepaint();
  };

  const beginIntro = (ms: number) => {
    const dur = reduced() ? Math.min(700, ms * 0.35) : ms;
    intro = motion() === 'off' ? null : { t0: performance.now(), dur, from: current() };
    hdgPrimed = false;
  };

  /**
   * Re-expresses the elevated camera as an ordinary ground-centred one with exactly the same
   * view (the centre moves down the line of sight to the ground), then re-clamps the centre to
   * the ground. Whatever animation runs next (stop or plain follow) starts without a jump.
   */
  const release = () => {
    const c = map.getCenter();
    const E = map.getCenterElevation();
    const p = map.getPitch() * D2R;
    const b = map.getBearing() * D2R;
    const H = map.getCanvas().clientHeight || 600;
    const fov = map.getVerticalFieldOfView() * D2R;
    const ctc = (0.5 * H) / Math.tan(fov / 2);
    const dM = ctc / (512 * 2 ** map.getZoom());
    const C = MercatorCoordinate.fromLngLat(c, E);
    const ux = Math.sin(p) * Math.sin(b);
    const uy = -Math.sin(p) * Math.cos(b);
    const uz = -Math.cos(p);
    const cam = { x: C.x - ux * dM, y: C.y - uy * dM, z: C.z - uz * dM };
    let G = 0;
    if (map.getTerrain()) G = map.queryTerrainElevation(c) ?? 0;
    const gz = G * C.meterInMercatorCoordinateUnits();
    try {
      if (uz < -0.02 && cam.z > gz) {
        const tHit = (cam.z - gz) / -uz;
        const centre = new MercatorCoordinate(cam.x + ux * tHit, cam.y + uy * tHit, gz).toLngLat();
        const zoom = Math.log2(ctc / (tHit * 512));
        map.jumpTo({ center: centre, zoom: Math.max(map.getMinZoom(), zoom), elevation: G });
      } else {
        map.jumpTo({ elevation: G, zoom: Math.min(map.getZoom(), 14) });
      }
    } catch {
      /* map is going away */
    }
    map.setCenterClampedToGround(true);
  };

  const tryRestoreLimits = () => {
    if (active || !restorePending) return;
    if (map.getPitch() <= prevMaxPitch + 0.01 && map.getZoom() <= prevMaxZoom + 0.01 && !map.isMoving()) {
      map.setMaxPitch(prevMaxPitch);
      map.setMaxZoom(prevMaxZoom);
      restorePending = false;
    }
  };
  map.on('moveend', tryRestoreLimits);

  const leave = () => {
    active = false;
    chaseState.active = false;
    chaseState.orbited = false;
    intro = null;
    pointers.clear();
    canvasBox.style.touchAction = touchAction;
    delete chaseHooks.zoomBy;
    delete chaseHooks.reset;
    release();
    undress();
    haze?.remove();
    haze = null;
    restorePending = true;
    tryRestoreLimits();
  };

  const wanted = () => {
    const u = ui();
    return u.following && u.chase && !!u.selectedId;
  };
  const unsub = useUI.subscribe((s, p) => {
    const want = wanted();
    if (want && !active) enter();
    else if (!want && active) leave();
    else if (active) {
      // "Return to aircraft" after a pause, or a new aircraft: glide back in.
      if ((p.followPaused && !s.followPaused) || s.selectedId !== lastId) {
        lastId = s.selectedId;
        beginIntro(1400);
      }
    }
  });
  const unsubSettings = useSettings.subscribe((s, p) => {
    if (active && s.show3dModels !== p.show3dModels) setVis(HIDE_WITH_MODELS, !s.show3dModels);
  });
  map.on('style.load', onStyle);
  if (wanted()) enter();

  // ---------------------------------------------------------------- per frame
  /**
   * Without 3D terrain MapLibre draws nothing between its sky line (computed for an unpadded view)
   * and the farthest ground tiles; with the aircraft lowered on screen that leaves a dark gap.
   * A haze band in the sky's horizon and fog colours covers it, like aerial perspective.
   */
  const placeHaze = (padding: PaddingOptions) => {
    if (!haze) return;
    const H = map.getCanvas().clientHeight || 600;
    const p = map.getPitch();
    const ctc = (0.5 * H) / Math.tan((map.getVerticalFieldOfView() * D2R) / 2);
    const skyLine = H / 2 - ctc * Math.min(Math.tan((90 - p) * D2R) * 0.85, Math.tan((89.25 - p) * D2R));
    const top = padding.top ?? 0;
    const cy = top + (H - top - (padding.bottom ?? 0)) / 2;
    const ground = cy - ctc * Math.tan((90 - p) * D2R);
    const y0 = Math.min(skyLine, ground) - 26;
    const y1 = Math.max(skyLine, ground) + 54;
    if (p < 60 || y1 < 0 || y0 > H) {
      haze.style.display = 'none';
      return;
    }
    const h = y1 - y0;
    const a = (26 / h) * 100;
    const b = ((Math.max(skyLine, ground) - y0) / h) * 100;
    const hc = String(sky['horizon-color']);
    const fc = String(sky['fog-color']);
    haze.style.display = 'block';
    haze.style.top = `${y0.toFixed(1)}px`;
    haze.style.height = `${h.toFixed(1)}px`;
    haze.style.background = `linear-gradient(to bottom, transparent 0%, ${hc} ${a.toFixed(1)}%, ${fc} ${b.toFixed(1)}%, transparent 100%)`;
  };

  const frame = (now: number) => {
    if (!active) return;
    const u = ui();
    const t = traffic.get(u.selectedId);
    if (!t) return;
    const perf = performance.now();
    const dt = last ? Math.min(0.1, Math.max(0, (perf - last) / 1000)) : 0;
    last = perf;
    const a = t.ac;
    const pos = traffic.displayPosition(t, now);
    const trk = pos.trk ?? a.track ?? hdg.x;
    if (!hdgPrimed) {
      // The heading spring starts on the aircraft's track; the intro blends the bearing in.
      hdg.x = ((trk % 360) + 360) % 360;
      hdg.v = 0;
      hdgPrimed = true;
    }
    const models = modelsOn();
    const terrain = !!map.getTerrain();
    const fieldFt = simElevationFt(t.id) ?? 0;
    const elev = models ? modelAltitudeM(a.altitudeBarometric ?? a.altitudeGeometric, fieldFt, a.onGround, terrain) : terrain ? fieldFt * 0.3048 : 0;

    const canvas = map.getCanvas();
    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 600;
    const pad = viewPadding();
    const phone = W < 768;
    // Phones: keep the aircraft between the HUD's top cluster (ribbon) and bottom cluster (readouts).
    // Larger screens: sit it a little below the middle, like a sim's default chase view.
    const padding: { top: number; bottom: number; left: number; right: number } = phone
      ? { ...pad, top: Math.max(pad.top, 170), bottom: pad.bottom + 96 }
      : { ...pad, top: pad.top + Math.round(Math.max(160, H - pad.top - pad.bottom) * 0.2) };
    const bandH = Math.max(phone ? 120 : 160, H - padding.top - padding.bottom);
    const bandW = Math.max(200, W - pad.left - pad.right);
    const fov = map.getVerticalFieldOfView();
    const spec = a.aircraftType ? specOf(a.aircraftType) : undefined;
    const fitH = phone ? bandH : bandH * 1.075;
    const fit = chaseDistanceM(spec?.lengthM ?? 38, spec?.spanM ?? 34, bandW, fitH, fov * (fitH / H));
    const dist = models ? fit * 2 ** -orbit.zoom : 2600 * 2 ** -orbit.zoom;
    const zoomTarget = Math.min(21, zoomForDistance(dist, pos.lat, H, fov));
    const basePitch = models ? (a.onGround ? 75 : 80) : 68;
    const pitchTarget = Math.max(40, Math.min(MAX_PITCH, basePitch + orbit.pitch));
    if (orbit.yaw !== 0 || orbit.pitch !== 0 || orbit.zoom !== 0) chaseState.orbited = true;

    const calm = reduced();
    // Lower natural frequencies = lazier, more cinematic camera; reduced motion stiffens it.
    angleSpringStep(hdg, trk, calm ? 6 : a.onGround ? 3 : 1.5, dt);
    springStep(tilt, pitchTarget, calm ? 10 : 2.2, dt);
    springStep(zoomS, zoomTarget, calm ? 10 : 2.6, dt);
    springStep(yawS, orbit.yaw, 14, dt);

    let cam: Cam = { lng: pos.lon, lat: pos.lat, zoom: zoomS.x, pitch: tilt.x, bearing: hdg.x + yawS.x, elev };
    if (intro) {
      const k = intro.dur > 0 ? Math.min(1, (perf - intro.t0) / intro.dur) : 1;
      const e = ease(k);
      const ec = 1 - (1 - Math.min(1, k * 1.4)) ** 3; // centre leads so the aircraft is found early
      const f = intro.from;
      const A = MercatorCoordinate.fromLngLat([f.lng, f.lat]);
      const B = MercatorCoordinate.fromLngLat([cam.lng, cam.lat]);
      let dx = B.x - A.x;
      if (dx > 0.5) dx -= 1;
      else if (dx < -0.5) dx += 1;
      const mid = new MercatorCoordinate(A.x + dx * ec, A.y + (B.y - A.y) * ec, 0).toLngLat();
      // Hold the springs on the target so they take over seamlessly when the intro ends.
      tilt.x = pitchTarget;
      tilt.v = 0;
      zoomS.x = zoomTarget;
      zoomS.v = 0;
      cam = {
        lng: mid.lng,
        lat: mid.lat,
        zoom: f.zoom + (zoomTarget - f.zoom) * e,
        pitch: f.pitch + (pitchTarget - f.pitch) * e,
        bearing: f.bearing + wrap180(cam.bearing - f.bearing) * e,
        elev: f.elev + (elev - f.elev) * e,
      };
      if (k >= 1) intro = null;
    }

    // Quantise tiny changes away so a settled camera stops firing zoom/rotate events.
    const z = Math.round(cam.zoom * 1e4) / 1e4;
    const opts: Parameters<MlMap['jumpTo']>[0] = {
      center: [cam.lng, cam.lat],
      elevation: cam.elev,
      pitch: Math.round(Math.max(0, Math.min(MAX_PITCH, cam.pitch)) * 1e3) / 1e3,
      bearing: Math.round(cam.bearing * 1e3) / 1e3,
      padding,
    };
    if (Math.abs(z - map.getZoom()) > 1e-4) opts.zoom = Math.max(map.getMinZoom(), Math.min(21, z));
    map.jumpTo(opts);
    applySky();
    placeHaze(padding);
  };

  return {
    frame,
    dispose() {
      if (active) leave();
      unsub();
      unsubSettings();
      map.off('style.load', onStyle);
      map.off('moveend', tryRestoreLimits);
      container.removeEventListener('pointerdown', onDown, cap);
      window.removeEventListener('pointermove', onMovePtr, cap);
      window.removeEventListener('pointerup', onUp, cap);
      window.removeEventListener('pointercancel', onUp, cap);
      container.removeEventListener('mousedown', block, cap);
      container.removeEventListener('touchstart', block, capActive);
      container.removeEventListener('touchmove', blockPrevent, capActive);
      container.removeEventListener('wheel', onWheel, capActive);
      container.removeEventListener('click', onClick, cap);
      container.removeEventListener('dblclick', onDbl, cap);
      container.removeEventListener('contextmenu', blockPrevent, cap);
    },
  };
}
