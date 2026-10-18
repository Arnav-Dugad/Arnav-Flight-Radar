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

/** Mixes hex colour `b` into hex colour `a` by `t` (0–1); non-hex input returns `a`. Used for derived tints. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const A = p(a);
  const B = p(b);
  if (!A || !B) return a;
  return `#${A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Derived tints for the extra land-use, landcover and transport detail. */
function detailTints(p: Palette, dark: boolean) {
  return {
    grass: mixHex(p.bg, p.park, 0.55),
    farmland: mixHex(p.bg, p.park, 0.25),
    wetland: mixHex(p.bg, p.water, 0.35),
    sand: mixHex(p.bg, dark ? '#c9b98a' : '#efe3c0', dark ? 0.07 : 0.45),
    industrial: mixHex(p.residential, p.roadMajor, dark ? 0.35 : 0.25),
    civic: mixHex(p.residential, dark ? '#7a5c8a' : '#e6d6ea', dark ? 0.12 : 0.5),
    green: mixHex(p.park, dark ? '#2f6b45' : '#bfe0bf', dark ? 0.18 : 0.35),
    military: mixHex(p.bg, dark ? '#a03a48' : '#f0c6cc', dark ? 0.08 : 0.4),
    buildingTall: dark ? mixHex(p.building, p.label, 0.1) : mixHex(p.building, '#000000', 0.05),
    buildingLine: dark ? mixHex(p.building, p.label, 0.14) : mixHex(p.building, '#000000', 0.1),
    path: mixHex(p.road, p.labelMinor, dark ? 0.25 : 0.3),
    ferry: mixHex(p.water, p.waterLabel, 0.7),
    poiGreen: mixHex(p.labelMinor, dark ? '#7fd39a' : '#2e7d4a', 0.55),
    poiBlue: mixHex(p.labelMinor, dark ? '#7fb6ff' : '#1d5fa8', 0.55),
    // Route-number shields: motorways in a muted blue, other roads in a lifted grey.
    shield: dark ? mixHex(p.motorway, '#2f5d9a', 0.55) : '#3d6fb0',
    shieldMinor: dark ? mixHex(p.roadMajor, p.labelMinor, 0.35) : '#ffffff',
    shieldText: dark ? '#eef3fa' : '#ffffff',
    shieldMinorText: dark ? '#eef3fa' : p.label,
    railHatch: mixHex(p.rail, p.labelMinor, dark ? 0.25 : 0.2),
  };
}

function placeFilter(density: LabelDensity) {
  // Rank: lower = more important. Density trims minor places.
  const maxRank = density === 'low' ? 6 : density === 'high' ? 16 : 10;
  return ['<=', ['coalesce', ['get', 'rank'], 99], maxRank];
}

function buildLayers(id: MapStyleId, p: Palette, density: LabelDensity, satellite: boolean, terrain: boolean, dem = terrain): LayerSpecification[] {
  const L: LayerSpecification[] = [];
  const add = (l: Record<string, unknown>) => L.push(l as unknown as LayerSpecification);
  const dark = STYLE_META[id].dark;
  const t = detailTints(p, dark);
  const labels = density !== 'none';
  const richLabels = density === 'normal' || density === 'high';
  const tunnelFade = (o: number) => ['case', ['==', ['get', 'brunnel'], 'tunnel'], o * 0.4, o];

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
        id: 'landcover-grass',
        type: 'fill',
        source: OMT,
        'source-layer': 'landcover',
        minzoom: 7,
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland', 'sand', 'rock']]],
        paint: {
          'fill-color': ['match', ['get', 'class'], 'grass', t.grass, 'farmland', t.farmland, 'wetland', t.wetland, t.sand],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 10, 0.85],
        },
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
      // Finer land use from zoom 11: industry/commerce/rail yards, civic campuses, sports & cemeteries, military.
      add({
        id: 'landuse-detail',
        type: 'fill',
        source: OMT,
        'source-layer': 'landuse',
        minzoom: 11,
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['industrial', 'commercial', 'retail', 'railway', 'garages', 'hospital', 'school', 'university', 'college', 'kindergarten', 'library', 'cemetery', 'pitch', 'playground', 'stadium', 'track', 'theme_park', 'zoo', 'military', 'quarry']],
        ],
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            ['industrial', 'commercial', 'retail', 'railway', 'garages', 'quarry'],
            t.industrial,
            ['hospital', 'school', 'university', 'college', 'kindergarten', 'library'],
            t.civic,
            'military',
            t.military,
            t.green,
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.9],
        },
      });
      add({
        id: 'park',
        type: 'fill',
        source: OMT,
        'source-layer': 'park',
        minzoom: 7,
        paint: { 'fill-color': p.park, 'fill-opacity': 0.8 },
      });
      add({
        id: 'park-outline',
        type: 'line',
        source: OMT,
        'source-layer': 'park',
        minzoom: 9,
        paint: { 'line-color': t.green, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 1.2], 'line-opacity': 0.6, 'line-dasharray': [3, 2] },
      });
    }

    if (dem && !terrain) {
      // Subtle relief under the other styles whenever the elevation source is on (3D terrain).
      add({
        id: 'hillshade',
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: {
          'hillshade-shadow-color': dark ? '#000000' : '#5d6b7a',
          'hillshade-highlight-color': dark ? mixHex(p.bg, '#ffffff', 0.12) : '#ffffff',
          'hillshade-accent-color': dark ? '#000000' : '#8090a0',
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 10, 0.25, 14, 0.15],
        },
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

  // Ferry routes.
  add({
    id: 'ferry',
    type: 'line',
    source: OMT,
    'source-layer': 'transportation',
    minzoom: 7,
    filter: ['==', ['get', 'class'], 'ferry'],
    paint: { 'line-color': satellite ? 'rgba(188,215,245,0.55)' : t.ferry, 'line-width': z([[7, 0.6], [14, 1.6]]), 'line-dasharray': [3, 3], 'line-opacity': 0.75 },
  });

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
    // On imagery, bright outlines help far out; close in they turn to asphalt under the surface markings.
    paint: { 'fill-color': satellite ? ['interpolate', ['linear'], ['zoom'], 12, p.runway, 13.5, 'rgba(46,48,52,0.85)'] : p.runway, 'fill-opacity': satellite ? 0.4 : 1 },
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
    paint: {
      'line-color': satellite ? ['interpolate', ['linear'], ['zoom'], 12, p.runway, 13.5, 'rgba(46,48,52,0.7)'] : p.runway,
      'line-width': z([[8, 1], [11, 4], [14, 20], [17, 60]]),
    },
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
    // Taller buildings a shade lighter, and crisp footprint outlines up close.
    add({
      id: 'building-tall',
      type: 'fill',
      source: OMT,
      'source-layer': 'building',
      minzoom: 14,
      filter: ['>=', ['coalesce', ['get', 'render_height'], 0], 25],
      paint: { 'fill-color': t.buildingTall, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.9] },
    });
    add({
      id: 'building-outline',
      type: 'line',
      source: OMT,
      'source-layer': 'building',
      minzoom: 15,
      paint: { 'line-color': t.buildingLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.4, 18, 1], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.9] },
    });
  }

  if (p.roads !== 'none') {
    const major = ['motorway', 'trunk', 'primary'];
    const roadClasses = p.roads === 'full' ? [...major, 'secondary', 'tertiary', 'minor'] : major;
    if (p.roads === 'full') {
      // Service roads (airport roads, car parks, docks) and footpaths / tracks up close.
      add({
        id: 'road-path',
        type: 'line',
        source: OMT,
        'source-layer': 'transportation',
        minzoom: 15,
        filter: ['all', ['in', ['get', 'class'], ['literal', ['path', 'track']]], ['!=', ['get', 'brunnel'], 'tunnel']],
        paint: { 'line-color': t.path, 'line-width': z([[15, 0.6], [18, 2]]), 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 },
      });
      add({
        id: 'road-service',
        type: 'line',
        source: OMT,
        'source-layer': 'transportation',
        minzoom: 13.5,
        filter: ['all', ['==', ['get', 'class'], 'service'], ['!=', ['get', 'brunnel'], 'tunnel']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.road, 'line-width': z([[13.5, 0.4], [15, 1.4], [18, 8]]), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 0.9] },
      });
    }
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
      paint: { 'line-color': p.road, 'line-width': z([[11, 0.4], [14, 3], [18, 18]]), 'line-opacity': tunnelFade(1) },
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
        'line-opacity': tunnelFade(satellite ? 0.5 : 1),
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
        'line-opacity': tunnelFade(satellite ? 0.55 : 1),
      },
    });
  }

  // Railways: a solid line with cross-ties up close (classic map hatching); metro/tram thinner.
  if (p.roads !== 'none') {
    const railColour = satellite ? 'rgba(230,236,244,0.55)' : p.rail;
    add({
      id: 'rail',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel'], ['!', ['in', ['get', 'service'], ['literal', ['yard', 'siding', 'spur']]]]],
      paint: { 'line-color': railColour, 'line-width': z([[9, 0.5], [13, 1.2], [17, 2.4]]), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 0.9] },
    });
    add({
      id: 'rail-hatch',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': satellite ? railColour : t.railHatch, 'line-width': z([[13, 3], [17, 7]]), 'line-dasharray': [0.18, 2.4], 'line-opacity': 0.8 },
    });
    add({
      id: 'rail-transit',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['all', ['==', ['get', 'class'], 'transit'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': railColour, 'line-width': z([[12, 0.4], [16, 1.6]]), 'line-dasharray': [4, 1.5], 'line-opacity': 0.8 },
    });
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
  // A soft glow under national borders so they read over land use and imagery.
  add({
    id: 'boundary-country-glow',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    minzoom: 2,
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': p.border, 'line-width': z([[2, 2], [6, 4], [10, 7]]), 'line-blur': z([[2, 1.5], [10, 4]]), 'line-opacity': satellite ? 0.18 : dark ? 0.14 : 0.2 },
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

  if (labels && p.roads !== 'none') {
    // Route numbers ("M4", "A40", "I-95") as pill-shaped shields along motorways and trunk roads.
    const shield = (sid: string, classes: string[], minzoom: number, fill: string, ink: string) =>
      add({
        id: sid,
        type: 'symbol',
        source: OMT,
        'source-layer': 'transportation_name',
        minzoom,
        filter: ['all', ['has', 'ref'], ['<=', ['coalesce', ['get', 'ref_length'], 9], 6], ['in', ['get', 'class'], ['literal', classes]]],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 7, 300, 14, 450],
          'text-field': ['get', 'ref'],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 8.5, 14, 10.5],
          'text-rotation-alignment': 'viewport',
          'text-padding': 12,
        },
        paint: { 'text-color': ink, 'text-halo-color': fill, 'text-halo-width': 3, 'text-opacity': 0.95 },
      });
    shield('road-shield', ['motorway'], 7, satellite ? 'rgba(28,62,120,0.92)' : t.shield, satellite ? '#ffffff' : t.shieldText);
    shield('road-shield-minor', ['trunk', 'primary'], 10, satellite ? 'rgba(30,34,40,0.85)' : t.shieldMinor, satellite ? '#ffffff' : t.shieldMinorText);
  }

  if (labels) {
    // River and canal names along the water.
    add({
      id: 'waterway-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'waterway',
      minzoom: 12,
      filter: ['all', ['has', 'name'], ['in', ['get', 'class'], ['literal', ['river', 'canal']]]],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 380, 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': 11, 'text-letter-spacing': 0.1 },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
    });
    add({
      id: 'water-label-line',
      type: 'symbol',
      source: OMT,
      'source-layer': 'water_name',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13], 'text-letter-spacing': 0.2 },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 },
    });
  }

  if (richLabels) {
    // Points of interest up close (text only, ranked; parks green, transport blue).
    add({
      id: 'poi-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'poi',
      minzoom: density === 'high' ? 14.5 : 15.5,
      filter: ['all', ['has', 'name'], ['<=', ['coalesce', ['get', 'rank'], 99], density === 'high' ? 40 : 20], ['!', ['in', ['get', 'class'], ['literal', ['aerialway', 'entrance']]]]],
      layout: {
        'text-field': NAME,
        'text-font': FONT,
        'text-size': 10.5,
        'text-max-width': 7,
        'text-padding': 4,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: {
        'text-color': ['match', ['get', 'class'], ['park', 'garden', 'golf', 'campsite', 'zoo'], t.poiGreen, ['railway', 'bus', 'ferry_terminal', 'harbor', 'aerodrome', 'fuel'], t.poiBlue, p.labelMinor],
        'text-halo-color': p.labelHalo,
        'text-halo-width': 1.3,
        'text-opacity': 0.9,
      },
    });
    // Railway stations from zoom 12.
    add({
      id: 'station-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'poi',
      minzoom: 12,
      maxzoom: density === 'high' ? 14.5 : 15.5,
      filter: ['all', ['has', 'name'], ['==', ['get', 'class'], 'railway'], ['==', ['get', 'subclass'], 'station']],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 10.5, 'text-max-width': 7, 'text-padding': 6 },
      paint: { 'text-color': t.poiBlue, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.3 },
    });
    // Gate numbers (OpenStreetMap aeroway=gate).
    add({
      id: 'aeroway-gate-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'aeroway',
      minzoom: 16.5,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate'], ['has', 'ref']],
      layout: { 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': 10, 'text-padding': 2 },
      paint: { 'text-color': satellite ? '#ffffff' : p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.3, 'text-opacity': 0.85 },
    });
    // Apron names / refs where OpenStreetMap has them.
    add({
      id: 'aeroway-apron-label',
      type: 'symbol',
      source: OMT,
      'source-layer': 'aeroway',
      minzoom: 14.5,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron'], ['has', 'ref']],
      layout: {
        // Short refs ("3", "W2") read as "APRON 3"; named ones ("Main Apron") as they are.
        'text-field': ['case', ['>', ['length', ['to-string', ['get', 'ref']]], 3], ['to-string', ['get', 'ref']], ['concat', 'Apron ', ['to-string', ['get', 'ref']]]],
        'text-font': FONT_BOLD,
        'text-size': 10,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-padding': 8,
      },
      paint: { 'text-color': satellite ? '#ffffff' : p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.3, 'text-opacity': 0.8 },
    });
    // Peaks with elevation.
    add({
      id: 'mountain-peak',
      type: 'symbol',
      source: OMT,
      'source-layer': 'mountain_peak',
      minzoom: id === 'terrain' ? 9 : 11,
      filter: ['all', ['has', 'name'], ['<=', ['coalesce', ['get', 'rank'], 99], density === 'high' ? 10 : 5]],
      layout: {
        'text-field': ['case', ['has', 'ele'], ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'ele']], ' m'], ['get', 'name']],
        'text-font': FONT_ITALIC,
        'text-size': 10,
        'text-max-width': 8,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2, 'text-opacity': 0.85 },
    });
    // Neighbourhoods and hamlets up close.
    add({
      id: 'place-neighbourhood',
      type: 'symbol',
      source: OMT,
      'source-layer': 'place',
      minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', density === 'high' ? ['neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling'] : ['neighbourhood', 'quarter', 'hamlet']]],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 10, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8, 'text-padding': 6 },
      paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2, 'text-opacity': 0.8 },
    });
  }
  if (density === 'high') {
    add({
      id: 'housenumber',
      type: 'symbol',
      source: OMT,
      'source-layer': 'housenumber',
      minzoom: 17.5,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': FONT, 'text-size': 9, 'text-padding': 2 },
      paint: { 'text-color': p.labelMinor, 'text-halo-color': p.labelHalo, 'text-halo-width': 1, 'text-opacity': 0.7 },
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
      // National capitals in bold from the start; bigger cities (lower rank = larger population) larger.
      'text-font': ['step', ['zoom'], ['case', ['==', ['get', 'capital'], 2], ['literal', FONT_BOLD], ['literal', FONT]], 8, ['literal', FONT_BOLD]],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['case', ['<=', ['coalesce', ['get', 'rank'], 99], 2], 11, 10],
        8,
        ['case', ['<=', ['coalesce', ['get', 'rank'], 99], 3], 14.5, 12.5],
        12,
        ['case', ['<=', ['coalesce', ['get', 'rank'], 99], 4], 17.5, 15.5],
      ],
      'text-max-width': 8,
      'text-letter-spacing': 0.02,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
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
    layers: buildLayers(id, palette, density, satellite, id === 'terrain', useTerrainSource),
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
