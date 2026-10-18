// Arnav cartography. All styles are generated from the OpenMapTiles schema served
// free by OpenFreeMap; no paid keys. Terrain uses the AWS Terrain Tiles open
// dataset; "Satellite" uses the EOxCloudless annual mosaic (CC BY-NC-SA 4.0).

import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { LabelDensity, MapStyleId } from '@/state/settings';

export interface StyleMeta {
  id: MapStyleId;
  name: string;
  description: string;
  dark: boolean;
  swatch: [string, string, string]; // land, water, accent (for the picker)
}

export const STYLE_META: Record<MapStyleId, StyleMeta> = {
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian Radar',
    description: 'Deep navy oceans, graphite land, glowing aviation overlays.',
    dark: true,
    swatch: ['#141a23', '#06142a', '#5ce1ff'],
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic Glass',
    description: 'Clean light cartography with soft greys and blue accents.',
    dark: false,
    swatch: ['#f2f4f7', '#cfe1f3', '#0a84d6'],
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Ocean',
    description: 'Near-black maritime palette with restrained cyan.',
    dark: true,
    swatch: ['#070a0f', '#03101c', '#3fc5e6'],
  },
  terrain: {
    id: 'terrain',
    name: 'Terrain Explorer',
    description: 'Hillshaded relief with optional 3D terrain when tilted.',
    dark: true,
    swatch: ['#1a2420', '#0b2236', '#8fd18a'],
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal Aviation',
    description: 'Clutter removed; runways and airports emphasised.',
    dark: true,
    swatch: ['#0f1318', '#0a0f16', '#ffb547'],
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    description: 'EOxCloudless 2025 Sentinel-2 mosaic — a cloud-free annual composite, not live imagery.',
    dark: true,
    swatch: ['#3b4a35', '#10243a', '#ffffff'],
  },
};

interface Palette {
  bg: string;
  water: string;
  waterLine: string;
  land2: string; // wood/grass tint
  ice: string;
  park: string;
  residential: string;
  building: string;
  road: string;
  roadMajor: string;
  roadCasing: string;
  motorway: string;
  rail: string;
  border: string;
  borderState: string;
  runway: string;
  taxiway: string;
  apron: string;
  label: string;
  labelMinor: string;
  labelHalo: string;
  waterLabel: string;
  roads: 'full' | 'major' | 'none';
  landcover: boolean;
}

const PALETTES: Record<Exclude<MapStyleId, 'satellite'>, Palette> = {
  obsidian: {
    bg: '#12171f',
    water: '#06142a',
    waterLine: '#0a1f3d',
    land2: '#131a23',
    ice: '#1b222c',
    park: '#141c22',
    residential: '#161c25',
    building: '#1b222d',
    road: '#1d2531',
    roadMajor: '#26303e',
    roadCasing: '#0e131a',
    motorway: '#2e3a4b',
    rail: '#232c38',
    border: '#4a5d78',
    borderState: '#2c3748',
    runway: '#3a475a',
    taxiway: '#2b3646',
    apron: '#1c2430',
    label: '#a9b8cc',
    labelMinor: '#7f8ea3',
    labelHalo: '#070b11',
    waterLabel: '#3f6a99',
    roads: 'full',
    landcover: true,
  },
  arctic: {
    bg: '#f3f5f8',
    water: '#cfe1f3',
    waterLine: '#b5d0ec',
    land2: '#ebf0ea',
    ice: '#ffffff',
    park: '#e3eee1',
    residential: '#eceff3',
    building: '#e1e5eb',
    road: '#ffffff',
    roadMajor: '#ffffff',
    roadCasing: '#d9dfe7',
    motorway: '#fde7c2',
    rail: '#d0d6de',
    border: '#9aa8ba',
    borderState: '#c6cfdb',
    runway: '#c9d1dc',
    taxiway: '#d8dee6',
    apron: '#e6eaf0',
    label: '#3c4b5f',
    labelMinor: '#6a798c',
    labelHalo: '#ffffff',
    waterLabel: '#5a87b5',
    roads: 'full',
    landcover: true,
  },
  midnight: {
    bg: '#07090d',
    water: '#020c17',
    waterLine: '#05182b',
    land2: '#080b10',
    ice: '#0d1117',
    park: '#080d0c',
    residential: '#0a0d12',
    building: '#0e1218',
    road: '#0f141b',
    roadMajor: '#141a23',
    roadCasing: '#050709',
    motorway: '#18202b',
    rail: '#11161e',
    border: '#1f4a5e',
    borderState: '#15232f',
    runway: '#1f2a36',
    taxiway: '#18212b',
    apron: '#0d1218',
    label: '#7d93ab',
    labelMinor: '#566a80',
    labelHalo: '#020305',
    waterLabel: '#1f4f73',
    roads: 'major',
    landcover: false,
  },
  terrain: {
    bg: '#1b231f',
    water: '#0b2236',
    waterLine: '#123150',
    land2: '#1e2b22',
    ice: '#2a3236',
    park: '#1f2d22',
    residential: '#222a27',
    building: '#28302d',
    road: '#2b332f',
    roadMajor: '#353e39',
    roadCasing: '#141a17',
    motorway: '#4a4636',
    rail: '#2e3531',
    border: '#7b8a6c',
    borderState: '#3f4a3c',
    runway: '#4b5650',
    taxiway: '#39433d',
    apron: '#29312c',
    label: '#c4cfbf',
    labelMinor: '#93a08f',
    labelHalo: '#0f1411',
    waterLabel: '#6795c0',
    roads: 'major',
    landcover: true,
  },
  minimal: {
    bg: '#0f1318',
    water: '#0a0f16',
    waterLine: '#0c131c',
    land2: '#0f1318',
    ice: '#141920',
    park: '#0f1318',
    residential: '#11161c',
    building: '#141920',
    road: '#151b22',
    roadMajor: '#1a2129',
    roadCasing: '#0a0d11',
    motorway: '#1d252e',
    rail: '#151b22',
    border: '#38485c',
    borderState: '#1c2530',
    runway: '#57677d',
    taxiway: '#3a4757',
    apron: '#1c232c',
    label: '#8a99ac',
    labelMinor: '#5d6c7f',
    labelHalo: '#07090c',
    waterLabel: '#2f4b69',
    roads: 'none',
    landcover: false,
  },
};

const SATELLITE_LABELS: Palette = {
  ...PALETTES.obsidian,
  border: '#e8eef6',
  borderState: 'rgba(232,238,246,0.45)',
  label: '#ffffff',
  labelMinor: '#e3e9f1',
  labelHalo: 'rgba(0,0,0,0.85)',
  waterLabel: '#bcd7f5',
  runway: 'rgba(255,255,255,0.55)',
  taxiway: 'rgba(255,255,255,0.35)',
  roads: 'major',
  landcover: false,
};

const OMT = 'openmaptiles';
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

export const TERRAIN_SOURCE = 'terrain-dem';

const SOURCES: Record<string, SourceSpecification> = {
  [OMT]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  [TERRAIN_SOURCE]: {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution:
      '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen / Tilezen &amp; data sources</a>',
  },
  satellite: {
    type: 'raster',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    maxzoom: 14,
    attribution:
      '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2025</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0',
  },
};

const z = (stops: [number, number][]) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];

function placeFilter(density: LabelDensity) {
  // Rank: lower = more important. Density trims minor places.
  const maxRank = density === 'low' ? 6 : density === 'high' ? 16 : 10;
  return ['<=', ['coalesce', ['get', 'rank'], 99], maxRank];
}

function buildLayers(id: MapStyleId, p: Palette, density: LabelDensity, satellite: boolean, terrain: boolean): LayerSpecification[] {
  const L: LayerSpecification[] = [];
  const add = (l: Record<string, unknown>) => L.push(l as unknown as LayerSpecification);

  add({ id: 'background', type: 'background', paint: { 'background-color': p.bg } });

  if (satellite) {
    add({
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      paint: { 'raster-fade-duration': 250, 'raster-saturation': -0.1, 'raster-contrast': 0.05 },
    });
  }

  if (!satellite) {
    if (p.landcover) {
      add({
        id: 'landcover-wood',
        type: 'fill',
        source: OMT,
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
        paint: { 'fill-color': p.land2, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 10, 1] },
      });
      add({
        id: 'landcover-ice',
        type: 'fill',
        source: OMT,
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['ice', 'glacier']]],
        paint: { 'fill-color': p.ice, 'fill-opacity': 0.85 },
      });
      add({
        id: 'landuse-residential',
        type: 'fill',
        source: OMT,
        'source-layer': 'landuse',
        minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial']]],
        paint: { 'fill-color': p.residential, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 0.9] },
      });
      add({
        id: 'park',
        type: 'fill',
        source: OMT,
        'source-layer': 'park',
        minzoom: 7,
        paint: { 'fill-color': p.park, 'fill-opacity': 0.8 },
      });
    }

    if (terrain) {
      add({
        id: 'hillshade',
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: {
          'hillshade-shadow-color': '#060a08',
          'hillshade-highlight-color': '#6f8a74',
          'hillshade-accent-color': '#1f2a24',
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 10, 0.4, 14, 0.25],
        },
      });
    }

    add({
      id: 'water',
      type: 'fill',
      source: OMT,
      'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': p.water, 'fill-antialias': true },
    });
    add({
      id: 'water-edge',
      type: 'line',
      source: OMT,
      'source-layer': 'water',
      minzoom: 4,
      paint: { 'line-color': p.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 12, 1.2] },
    });
    add({
      id: 'waterway',
      type: 'line',
      source: OMT,
      'source-layer': 'waterway',
      minzoom: 8,
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'line-color': p.water, 'line-width': z([[8, 0.5], [14, 3]]) },
    });
  }

  // Airport surfaces from the basemap (runway/taxiway geometry).
  add({
    id: 'aeroway-area',
    type: 'fill',
    source: OMT,
    'source-layer': 'aeroway',
    minzoom: 10,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'class'], ['literal', ['apron', 'aerodrome']]]],
    paint: { 'fill-color': p.apron, 'fill-opacity': satellite ? 0 : 0.9 },
  });
  add({
    id: 'aeroway-runway-area',
    type: 'fill',
    source: OMT,
    'source-layer': 'aeroway',
    minzoom: 10,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'runway']],
    paint: { 'fill-color': p.runway, 'fill-opacity': satellite ? 0.4 : 1 },
  });
  add({
    id: 'aeroway-taxiway',
    type: 'line',
    source: OMT,
    'source-layer': 'aeroway',
    minzoom: 11,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']],
    paint: { 'line-color': p.taxiway, 'line-width': z([[11, 0.6], [14, 4], [17, 14]]) },
  });
  add({
    id: 'aeroway-runway',
    type: 'line',
    source: OMT,
    'source-layer': 'aeroway',
    minzoom: 8,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']],
    paint: { 'line-color': p.runway, 'line-width': z([[8, 1], [11, 4], [14, 20], [17, 60]]) },
  });

  if (!satellite) {
    add({
      id: 'building',
      type: 'fill',
      source: OMT,
      'source-layer': 'building',
      minzoom: 13,
      paint: { 'fill-color': p.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.9] },
    });
  }

  if (p.roads !== 'none') {
    const major = ['motorway', 'trunk', 'primary'];
    const roadClasses = p.roads === 'full' ? [...major, 'secondary', 'tertiary', 'minor'] : major;
    add({
      id: 'road-casing',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['all', ['in', ['get', 'class'], ['literal', roadClasses]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.roadCasing,
        'line-width': z([[10, 1], [14, 6], [18, 26]]),
        'line-opacity': satellite ? 0 : 1,
      },
    });
    add({
      id: 'road-minor',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['all', ['in', ['get', 'class'], ['literal', roadClasses.filter((c) => !major.includes(c))]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.road, 'line-width': z([[11, 0.4], [14, 3], [18, 18]]) },
    });
    add({
      id: 'road-major',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 5,
      filter: ['in', ['get', 'class'], ['literal', ['trunk', 'primary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.roadMajor,
        'line-width': z([[5, 0.3], [10, 1.2], [14, 5], [18, 22]]),
        'line-opacity': satellite ? 0.5 : 1,
      },
    });
    add({
      id: 'road-motorway',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 4,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.motorway,
        'line-width': z([[4, 0.3], [9, 1.4], [14, 6], [18, 26]]),
        'line-opacity': satellite ? 0.55 : 1,
      },
    });
    if (p.roads === 'full') {
      add({
        id: 'rail',
        type: 'line',
        source: OMT,
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': p.rail, 'line-width': z([[11, 0.6], [16, 2.5]]), 'line-dasharray': [3, 2] },
      });
    }
  }

  add({
    id: 'boundary-state',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    minzoom: 4,
    filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
    paint: { 'line-color': p.borderState, 'line-width': z([[4, 0.4], [10, 1.2]]), 'line-dasharray': [2, 2] },
  });
  add({
    id: 'boundary-country',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': p.border,
      'line-width': z([[1, 0.5], [5, 1], [10, 1.8]]),
      'line-opacity': id === 'midnight' ? 0.8 : 0.9,
    },
  });
  add({
    id: 'boundary-disputed',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'disputed'], 1]],
    paint: { 'line-color': p.border, 'line-width': z([[1, 0.5], [10, 1.4]]), 'line-dasharray': [2, 2], 'line-opacity': 0.7 },
  });

  if (density !== 'none' && p.roads === 'full') {
    add({
      id: 'road-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': FONT,
        'text-size': 11,
        'text-letter-spacing': 0.02,
      },
      paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
    });
  }

  if (density !== 'none') {
    add({
      id: 'water-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'water_name',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': NAME,
        'text-font': FONT_ITALIC,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 13],
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
      },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 },
    });
    add({
      id: 'place-minor',
      type: 'symbol',
      source: OMT,
      'source-layer': 'place',
      minzoom: 9,
      filter: ['all', ['in', ['get', 'class'], ['literal', ['town', 'village', 'suburb']]], placeFilter(density)],
      layout: {
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13],
        'text-max-width': 8,
      },
      paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
    });
  }
  add({
    id: 'place-city',
    type: 'symbol',
    source: OMT,
    'source-layer': 'place',
    minzoom: 3,
    filter:
      density === 'none'
        ? ['all', ['==', ['get', 'class'], 'city'], ['<=', ['coalesce', ['get', 'rank'], 99], 2]]
        : ['all', ['==', ['get', 'class'], 'city'], placeFilter(density)],
    layout: {
      'text-field': NAME,
      'text-font': ['step', ['zoom'], ['literal', FONT], 8, ['literal', FONT_BOLD]],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13, 12, 16],
      'text-max-width': 8,
      'text-letter-spacing': 0.02,
    },
    paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 },
  });
  add({
    id: 'place-state',
    type: 'symbol',
    source: OMT,
    'source-layer': 'place',
    minzoom: 4,
    maxzoom: 8,
    filter: ['==', ['get', 'class'], 'state'],
    layout: {
      'text-field': NAME,
      'text-font': FONT,
      'text-size': 10,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.16,
      'text-max-width': 9,
      visibility: density === 'none' || density === 'low' ? 'none' : 'visible',
    },
    paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
  });
  add({
    id: 'place-country',
    type: 'symbol',
    source: OMT,
    'source-layer': 'place',
    maxzoom: 9,
    filter: ['==', ['get', 'class'], 'country'],
    layout: {
      'text-field': NAME,
      'text-font': FONT_BOLD,
      'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 4, 12, 7, 15],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.2,
      'text-max-width': 7,
    },
    paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6, 'text-opacity': 0.9 },
  });

  return L;
}

export function buildStyle(id: MapStyleId, density: LabelDensity, globe: boolean, terrain3d: boolean): StyleSpecification {
  const satellite = id === 'satellite';
  const palette = satellite ? SATELLITE_LABELS : PALETTES[id];
  const useTerrainSource = id === 'terrain' || terrain3d;
  const dark = STYLE_META[id].dark;
  const sources: Record<string, SourceSpecification> = { [OMT]: SOURCES[OMT]! };
  if (useTerrainSource) sources[TERRAIN_SOURCE] = SOURCES[TERRAIN_SOURCE]!;
  if (satellite) sources.satellite = SOURCES.satellite!;

  const style: StyleSpecification = {
    version: 8,
    name: `Arnav ${STYLE_META[id].name}`,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources,
    layers: buildLayers(id, palette, density, satellite, id === 'terrain'),
    sky: dark
      ? {
          'sky-color': '#02060d',
          'horizon-color': '#0a2240',
          'fog-color': '#02060d',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.6,
          'fog-ground-blend': 0.75,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
        }
      : {
          'sky-color': '#cfe3f7',
          'horizon-color': '#ffffff',
          'fog-color': '#eef4fb',
          'sky-horizon-blend': 0.5,
          'horizon-fog-blend': 0.5,
          'fog-ground-blend': 0.8,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
        },
    projection: { type: globe ? 'globe' : 'mercator' },
  };
  return style;
}

/** Text shown in the attribution bar for the active style. */
export function styleAttribution(id: MapStyleId, terrain: boolean): { label: string; href: string }[] {
  const out = [
    { label: 'OpenFreeMap', href: 'https://openfreemap.org' },
    { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
    { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  ];
  if (id === 'terrain' || terrain)
    out.push({ label: 'Terrain: Mapzen/Tilezen', href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' });
  if (id === 'satellite')
    out.push({
      label: 'EOxCloudless 2025 by EOX (modified Copernicus Sentinel data 2025, CC BY-NC-SA 4.0)',
      href: 'https://cloudless.eox.at',
    });
  return out;
}
