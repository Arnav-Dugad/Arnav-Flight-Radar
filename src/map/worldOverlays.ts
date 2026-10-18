// Map overlays for the simulated world's structure:
//   • Oceanic tracks — the day's simulated organised track systems (North Atlantic,
//     Pacific PACOTS, Australian flex tracks) with how many flights are on each.
//   • Closed airspace — real long-standing closures and the day's simulated ash advisory.
//   • Route fixes — the selected flight's procedure fixes, navaids and track points (click for details).
//   • Taxi route — the selected aircraft's cleared taxi route and holding point (ground view).
//   • ETOPS — a twin-engine flight's en-route alternates and their diversion-time circles.
//   • Forecast disruption — large airports in view coloured by the worst hour in their real TAF.
//   • Terminals — OpenStreetMap terminal outlines and names at the airport in view.
//   • 3D buildings — OpenStreetMap buildings (OpenFreeMap tiles) extruded when tilted.

import type * as GeoJSON from 'geojson';
import { Popup, type GeoJSONSource, type MapLayerMouseEvent, type Map as MlMap } from 'maplibre-gl';
import { api } from '@/lib/api';
import { destination } from '@shared/geo';
import { applyForecast, loadGround, simEtops, simNearestGroundAirport, simOceanicTracks, simRouteFixes, simTaxiPath, simZones, useSim } from '@/data/world';
import { loadMajorAirports } from '@/data/airports';
import { getSettings, useSettings } from '@/state/settings';
import { ui, useUI } from '@/state/ui';

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};
const WEST = '#5ce1ff';
const EAST = '#c4a3ff';
const LEVEL_COLOR = ['match', ['get', 'lvl'], 0, '#3ddc97', 1, '#ffd166', 2, '#ffb547', 3, '#ff5d73', '#9aa6b2'];
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function installWorldOverlays(map: MlMap) {
  const s = getSettings();
  const dark = s.mapStyle !== 'arctic';
  const halo = dark ? 'rgba(3,6,11,0.85)' : 'rgba(255,255,255,0.92)';
  for (const id of ['nat', 'nat-pts', 'terminals', 'zones', 'route-fixes', 'taxi-route', 'taxi-hold', 'tafmap', 'etops']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const vis = (on: boolean) => (on ? 'visible' : 'none');
  const below = map.getLayer('ac-heat') ? 'ac-heat' : undefined;

  // ---- closed airspace & volcanic ash
  if (!map.getLayer('zones-fill'))
    map.addLayer(
      {
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        maxzoom: 9,
        layout: { visibility: vis(s.showZones) },
        paint: {
          'fill-color': ['case', ['==', ['get', 'kind'], 'ash'], '#c9a227', '#ff5d73'],
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'ash'], 0.16, 0.06],
        },
      },
      below,
    );
  if (!map.getLayer('zones-line'))
    map.addLayer(
      {
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        maxzoom: 9,
        layout: { visibility: vis(s.showZones) },
        paint: {
          'line-color': ['case', ['==', ['get', 'kind'], 'ash'], '#e8c24a', '#ff8a9a'],
          'line-width': 1.2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.75,
        },
      },
      below,
    );
  if (!map.getLayer('zones-label'))
    map.addLayer({
      id: 'zones-label',
      type: 'symbol',
      source: 'zones',
      minzoom: 2.5,
      maxzoom: 9,
      layout: {
        visibility: vis(s.showZones),
        'text-field': ['get', 'short'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10.5,
        'text-max-width': 12,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': ['case', ['==', ['get', 'kind'], 'ash'], '#f2d06b', '#ff9aa8'],
        'text-halo-color': halo,
        'text-halo-width': 1.4,
      },
    });

  // ---- oceanic tracks
  const natVis = vis(s.showNatTracks);
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
      paint: {
        'text-color': ['case', ['get', 'east'], EAST, WEST],
        'text-halo-color': halo,
        'text-halo-width': 1.4,
      },
    });
  if (!map.getLayer('nat-pt'))
    map.addLayer({
      id: 'nat-pt',
      type: 'circle',
      source: 'nat-pts',
      minzoom: 3,
      maxzoom: 8,
      layout: { visibility: natVis },
      paint: {
        'circle-radius': 2.2,
        'circle-color': ['case', ['get', 'east'], EAST, WEST],
        'circle-stroke-color': halo,
        'circle-stroke-width': 1,
      },
    });

  // ---- forecast disruption (TAF)
  if (!map.getLayer('tafmap-dot'))
    map.addLayer(
      {
        id: 'tafmap-dot',
        type: 'circle',
        source: 'tafmap',
        maxzoom: 10,
        layout: { visibility: vis(s.showForecastMap) },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['+', 4, ['*', 2, ['get', 'lvl']]], 8, ['+', 9, ['*', 4, ['get', 'lvl']]]],
          'circle-color': LEVEL_COLOR as never,
          'circle-opacity': 0.3,
          'circle-stroke-color': LEVEL_COLOR as never,
          'circle-stroke-width': 1.6,
        },
      },
      below,
    );
  if (!map.getLayer('tafmap-label'))
    map.addLayer({
      id: 'tafmap-label',
      type: 'symbol',
      source: 'tafmap',
      minzoom: 4,
      maxzoom: 10,
      filter: ['>=', ['get', 'lvl'], 1],
      layout: {
        visibility: vis(s.showForecastMap),
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 14,
      },
      paint: {
        'text-color': LEVEL_COLOR as never,
        'text-halo-color': halo,
        'text-halo-width': 1.3,
      },
    });

  // ---- selected flight: ETOPS alternates and diversion circles (below the route fixes)
  if (!map.getLayer('etops-ring'))
    map.addLayer(
      {
        id: 'etops-ring',
        type: 'line',
        source: 'etops',
        maxzoom: 8,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'line-color': '#7fd4ff',
          'line-width': 1,
          'line-opacity': 0.55,
          'line-dasharray': [4, 3],
        },
      },
      below,
    );
  if (!map.getLayer('etops-alt'))
    map.addLayer({
      id: 'etops-alt',
      type: 'symbol',
      source: 'etops',
      maxzoom: 9,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-optional': true,
      },
      paint: {
        'text-color': '#bfe9ff',
        'text-halo-color': halo,
        'text-halo-width': 1.4,
      },
    });

  // ---- selected flight: route fixes and taxi route
  if (!map.getLayer('route-fix'))
    map.addLayer({
      id: 'route-fix',
      type: 'circle',
      source: 'route-fixes',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 9, 4.5],
        'circle-color': halo,
        'circle-stroke-width': 1.6,
        'circle-stroke-color': ['match', ['get', 'role'], 'sid', '#3ddc97', 'star', '#ffb547', 'ocean', EAST, '#9fd2ff'],
      },
    });
  if (!map.getLayer('route-fix-label'))
    map.addLayer({
      id: 'route-fix-label',
      type: 'symbol',
      source: 'route-fixes',
      minzoom: 3.5,
      layout: {
        'text-field': ['get', 'ident'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': ['match', ['get', 'role'], 'sid', '#8ff0bf', 'star', '#ffcf80', 'ocean', '#d6c2ff', '#bfe3ff'],
        'text-halo-color': halo,
        'text-halo-width': 1.3,
      },
    });
  if (!map.getLayer('taxi-route-line'))
    map.addLayer(
      {
        id: 'taxi-route-line',
        type: 'line',
        source: 'taxi-route',
        minzoom: 12.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3ddc97',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 6],
          'line-opacity': 0.85,
          'line-dasharray': [1.6, 1],
        },
      },
      below,
    );
  if (!map.getLayer('taxi-route-label'))
    map.addLayer(
      {
        id: 'taxi-route-label',
        type: 'symbol',
        source: 'taxi-route',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, -1],
          'text-keep-upright': true,
          'text-optional': true,
        },
        paint: {
          'text-color': '#8ff0bf',
          'text-halo-color': halo,
          'text-halo-width': 1.5,
        },
      },
      below,
    );
  if (!map.getLayer('taxi-hold'))
    map.addLayer(
      {
        id: 'taxi-hold',
        type: 'symbol',
        source: 'taxi-hold',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'text'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.8],
        },
        paint: {
          'text-color': '#ffcf80',
          'text-halo-color': halo,
          'text-halo-width': 1.6,
        },
      },
      below,
    );

  // ---- terminals
  if (!map.getLayer('terminal-fill'))
    map.addLayer(
      {
        id: 'terminal-fill',
        type: 'fill',
        source: 'terminals',
        minzoom: 13,
        paint: {
          'fill-color': dark ? '#5ce1ff' : '#1d6fa5',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, dark ? 0.08 : 0.1],
          'fill-outline-color': dark ? 'rgba(92,225,255,0.5)' : 'rgba(29,111,165,0.6)',
        },
      },
      map.getLayer('stands-dot') ? 'stands-dot' : undefined,
    );
  if (!map.getLayer('terminal-label'))
    map.addLayer({
      id: 'terminal-label',
      type: 'symbol',
      source: 'terminals',
      minzoom: 13.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 17, 14],
        'text-letter-spacing': 0.04,
        'text-optional': true,
      },
      paint: {
        'text-color': dark ? '#bdeeff' : '#0f4a73',
        'text-halo-color': halo,
        'text-halo-width': 1.5,
      },
    });

  // ---- 3D buildings from the base map's vector tiles (not on satellite imagery).
  if (map.getSource('openmaptiles') && map.getLayer('building') && !map.getLayer('building-3d')) {
    const color = (map.getPaintProperty('building', 'fill-color') as string | undefined) ?? (dark ? '#1b222d' : '#e1e5eb');
    map.addLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        layout: { visibility: s.show3dBuildings ? 'visible' : 'none' },
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

// ---------------------------------------------------------------- oceanic tracks

async function renderOceanic(map: MlMap) {
  if (!getSettings().showNatTracks || useSim.getState().loading) return;
  const tracks = await simOceanicTracks();
  const lines: GeoJSON.Feature[] = [];
  const pts: GeoJSON.Feature[] = [];
  for (const t of tracks) {
    // Points as [lon, lat]; Pacific tracks are unwrapped across the date line.
    const unwrap = (lo: number) => (t.system === 'PACOTS' && lo < 0 ? lo + 360 : lo);
    const coords = t.pts.map(([la, lo]) => [unwrap(lo), la]);
    if (t.system === 'NAT') {
      const first = t.pts[0]!;
      const last = t.pts[t.pts.length - 1]!;
      coords.unshift([first[1] + 5, first[0]]);
      coords.push([last[1] - 5, last[0]]);
    }
    const name = t.system === 'NAT' ? `NAT ${t.letter}` : t.system === 'PACOTS' ? `PACOTS ${t.letter}` : `Flex ${t.letter}`;
    lines.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        east: t.eastbound,
        active: t.flights > 0,
        label: `${name}${t.flights ? ` · ${t.flights}` : ''}`,
      },
    });
    for (const [la, lo] of t.pts)
      pts.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [unwrap(lo), la] },
        properties: { east: t.eastbound },
      });
  }
  (map.getSource('nat') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: lines,
  });
  (map.getSource('nat-pts') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: pts,
  });
}

// ---------------------------------------------------------------- closed airspace

function renderZones(map: MlMap) {
  if (!getSettings().showZones || useSim.getState().loading) return;
  (map.getSource('zones') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: simZones().map((z) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...z.ring, z.ring[0]!]] },
      properties: {
        kind: z.kind,
        name: z.name,
        scope: z.scope,
        short: z.kind === 'ash' ? 'Volcanic ash (simulated)' : z.name.split(' — ')[0],
      },
    })),
  });
}

// ---------------------------------------------------------------- selected flight

let lastFixesFor = '';
function renderSelected(map: MlMap) {
  const id = ui().selectedId;
  const fixesSrc = map.getSource('route-fixes') as GeoJSONSource | undefined;
  if (id !== lastFixesFor) {
    lastFixesFor = id ?? '';
    fixesSrc?.setData({
      type: 'FeatureCollection',
      features: simRouteFixes(id).map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
        properties: {
          ident: f.ident,
          role: f.role,
          name: f.name ?? '',
          detail: f.detail,
        },
      })),
    });
  }
  renderEtops(map, id);
  const taxi = map.getZoom() >= 12.5 ? simTaxiPath(id) : undefined;
  (map.getSource('taxi-route') as GeoJSONSource | undefined)?.setData(
    taxi && taxi.path.length > 1
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: taxi.path },
              properties: { label: taxi.label },
            },
          ],
        }
      : EMPTY,
  );
  (map.getSource('taxi-hold') as GeoJSONSource | undefined)?.setData(
    taxi?.hold
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [taxi.hold.lon, taxi.hold.lat],
              },
              properties: { text: taxi.hold.text },
            },
          ],
        }
      : EMPTY,
  );
}

let etopsKey = '';
function renderEtops(map: MlMap, id: string | null | undefined) {
  const e = id && map.getZoom() < 8 ? simEtops(id) : null;
  const key = e ? `${id}|${e.minutes}|${e.alternates.map((a) => a.ident).join(',')}` : '';
  if (key === etopsKey) return;
  etopsKey = key;
  const features: GeoJSON.Feature[] = [];
  for (const a of e?.alternates ?? []) {
    const ring: [number, number][] = [];
    for (let b = 0; b <= 360; b += 6) {
      const [la, lo] = destination(a.lat, a.lon, b, a.radiusNm);
      ring.push([lo, la]);
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { label: `${a.iata ?? a.ident} · ETOPS ${e!.minutes}` },
    });
  }
  (map.getSource('etops') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features,
  });
}

function fixPopup(map: MlMap, e: MapLayerMouseEvent) {
  const f = e.features?.[0];
  if (!f) return;
  const p = f.properties as Record<string, unknown>;
  new Popup({ closeButton: true, className: 'asp-popup', maxWidth: '260px' })
    .setLngLat(e.lngLat)
    .setHTML(
      `<div class="asp-row"><div class="asp-name">${esc(p.ident)}${p.name ? ` · ${esc(p.name)}` : ''}</div><div class="asp-meta">${esc(p.detail)}</div></div><div class="asp-foot">Route of a simulated flight — not for navigation.</div>`,
    )
    .addTo(map);
}

function zonePopup(map: MlMap, e: MapLayerMouseEvent) {
  const blocking = ['ac-icons', 'apt-large-icon', 'apt-other-icon', 'apt-cluster', 'route-fix'].filter((l) => map.getLayer(l));
  if (blocking.length && map.queryRenderedFeatures(e.point, { layers: blocking }).length) return;
  const f = e.features?.[0];
  if (!f || map.getZoom() > 7) return;
  const p = f.properties as Record<string, unknown>;
  new Popup({ closeButton: true, className: 'asp-popup', maxWidth: '280px' })
    .setLngLat(e.lngLat)
    .setHTML(
      `<div class="asp-row"><div class="asp-name">${esc(p.name)}</div><div class="asp-meta">Avoided by: ${esc(p.scope)}</div></div><div class="asp-foot">${p.kind === 'ash' ? 'Simulated advisory near a real volcano. ' : ''}Simulated flights route around it. Coarse outline — not for navigation.</div>`,
    )
    .addTo(map);
}

// ---------------------------------------------------------------- forecast disruption (TAF)

const tafLevels = new Map<
  string,
  {
    t: number;
    lvl: number;
    label: string;
    lat: number;
    lon: number;
    code: string;
  }
>();
let tafBusy = false;
async function renderForecastMap(map: MlMap) {
  if (!getSettings().showForecastMap || tafBusy || map.getZoom() < 3.5) return;
  tafBusy = true;
  try {
    const [airports, lib] = await Promise.all([loadMajorAirports(), import('@/lib/tafImpact')]);
    const b = map.getBounds();
    const inView = airports.filter((a) => a.type === 'large_airport' && a.lat >= b.getSouth() && a.lat <= b.getNorth() && a.lon >= b.getWest() && a.lon <= b.getEast());
    const stale = inView.filter((a) => Date.now() - (tafLevels.get(a.ident)?.t ?? 0) > 45 * 60_000).slice(0, 20);
    // Ten stations per request, paced, as the weather API asks.
    for (let i = 0; i < stale.length; i += 10) {
      const ids = stale.slice(i, i + 10).map((a) => a.ident);
      for (const id of ids) {
        const a = inView.find((x) => x.ident === id)!;
        tafLevels.set(id, {
          t: Date.now(),
          lvl: -1,
          label: '',
          lat: a.lat,
          lon: a.lon,
          code: a.iata ?? a.ident,
        });
      }
      try {
        const r = await api.taf(ids);
        for (const taf of r.data) {
          applyForecast(taf, lib);
          const hours = lib.hourlyForecast(taf, { hours: 12 });
          const sum = lib.summarize(hours);
          const e = tafLevels.get(taf.station);
          if (!e) continue;
          e.lvl = sum.level;
          const worst = sum.worst;
          e.label = `${e.code} ${worst && sum.level ? (worst.causes[0] ?? '') : ''}`.trim();
        }
      } catch {
        /* keep previous values */
      }
      if (i + 10 < stale.length) await new Promise((r) => setTimeout(r, 1500));
    }
    (map.getSource('tafmap') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [...tafLevels.values()]
        .filter((e) => e.lvl >= 0)
        .map((e) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
          properties: { lvl: e.lvl, label: e.label },
        })),
    });
  } finally {
    tafBusy = false;
  }
}

// ---------------------------------------------------------------- terminals

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
        .map((t) => ({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [t.ring.map(([la, lo]) => [lo, la])],
          },
          properties: { name: t.name },
        })),
    });
  });
}

export function bindWorldOverlays(map: MlMap): () => void {
  const slow = setInterval(() => {
    void renderOceanic(map);
    renderZones(map);
  }, 60_000);
  const sel = setInterval(() => renderSelected(map), 2000);
  const onMove = () => {
    renderTerminals(map);
    void renderForecastMap(map);
  };
  const onPitch = () => syncBuildings(map);
  const onFix = (e: MapLayerMouseEvent) => fixPopup(map, e);
  const onZone = (e: MapLayerMouseEvent) => zonePopup(map, e);
  const pointer = () => (map.getCanvas().style.cursor = 'pointer');
  const unpointer = () => (map.getCanvas().style.cursor = '');
  map.on('moveend', onMove);
  map.on('pitchend', onPitch);
  map.on('pitch', onPitch);
  map.on('click', 'route-fix', onFix);
  map.on('click', 'zones-fill', onZone);
  map.on('mouseenter', 'route-fix', pointer);
  map.on('mouseleave', 'route-fix', unpointer);
  const layersFor = {
    showNatTracks: ['nat-line', 'nat-label', 'nat-pt'],
    showZones: ['zones-fill', 'zones-line', 'zones-label'],
    showForecastMap: ['tafmap-dot', 'tafmap-label'],
  } as const;
  const unsub = useSettings.subscribe((s, p) => {
    for (const [k, ids] of Object.entries(layersFor) as [keyof typeof layersFor, readonly string[]][]) {
      if (s[k] === p[k]) continue;
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s[k] ? 'visible' : 'none');
    }
    if (s.showNatTracks !== p.showNatTracks) void renderOceanic(map);
    if (s.showZones !== p.showZones) renderZones(map);
    if (s.showForecastMap !== p.showForecastMap) void renderForecastMap(map);
    if (s.show3dBuildings !== p.show3dBuildings) syncBuildings(map);
  });
  const unsubSel = useUI.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId) renderSelected(map);
  });
  const unsubSim = useSim.subscribe((s, p) => {
    if (!s.loading && p.loading) {
      void renderOceanic(map);
      renderZones(map);
      renderTerminals(map);
      void renderForecastMap(map);
    }
  });
  void renderOceanic(map);
  renderZones(map);
  renderTerminals(map);
  return () => {
    clearInterval(slow);
    clearInterval(sel);
    map.off('moveend', onMove);
    map.off('pitchend', onPitch);
    map.off('pitch', onPitch);
    map.off('click', 'route-fix', onFix);
    map.off('click', 'zones-fill', onZone);
    map.off('mouseenter', 'route-fix', pointer);
    map.off('mouseleave', 'route-fix', unpointer);
    unsub();
    unsubSel();
    unsubSim();
    terminalsFor = '';
    lastFixesFor = '';
  };
}

/** Called after a style change so overlays re-render into the fresh sources. */
export function resetWorldOverlays() {
  terminalsFor = '';
  lastFixesFor = '';
  etopsKey = '';
}
