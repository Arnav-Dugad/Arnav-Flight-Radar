// Color scales used by both the map (as MapLibre expressions) and the UI legend.
// "aurora" is tuned for the dark map; "accessible" is a CVD-safe sequential
// scale (yellow → blue, monotonic lightness) for colour-vision deficiencies.

import type { AltitudePalette, ColorMode } from '@/state/settings';

export type Stop = [number, string];

export const ALTITUDE_STOPS: Record<AltitudePalette, Stop[]> = {
  aurora: [
    [0, '#ffd166'],
    [2000, '#ffb547'],
    [6000, '#ff8a5c'],
    [10000, '#ff6b9a'],
    [18000, '#c77dff'],
    [26000, '#8b9cff'],
    [34000, '#5cb8ff'],
    [41000, '#5ce1ff'],
  ],
  accessible: [
    [0, '#fde725'],
    [5000, '#b5de2b'],
    [10000, '#6ece58'],
    [18000, '#35b779'],
    [26000, '#1f9e89'],
    [34000, '#26828e'],
    [41000, '#3e8ec4'],
  ],
};

export const SPEED_STOPS: Stop[] = [
  [0, '#9aa6b2'],
  [80, '#ffd166'],
  [200, '#ff9f43'],
  [350, '#ff6b9a'],
  [450, '#a98bff'],
  [550, '#5ce1ff'],
];

export const VERTICAL_STOPS: Stop[] = [
  [-3000, '#ff7a59'],
  [-500, '#ffb547'],
  [0, '#dfe7f2'],
  [500, '#7cf0c2'],
  [3000, '#3ddc97'],
];

export const GROUND_COLOR = '#9aa6b2';
export const UNKNOWN_COLOR = '#c3cfdd';
export const SELECT_COLOR = '#ffb547';

/** Linear interpolation between two #rrggbb colors. */
export function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function scaleColor(stops: Stop[], v: number): string {
  if (v <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i]!;
    const [x0, c0] = stops[i - 1]!;
    if (v <= x1) return lerpColor(c0, c1, (v - x0) / (x1 - x0));
  }
  return stops[stops.length - 1]![1];
}

/** Color for an aircraft in the UI, matching the map symbol. */
export function aircraftColor(
  mode: ColorMode,
  palette: AltitudePalette,
  a: { onGround: boolean; alt?: number; gs?: number; vr?: number; stale?: boolean },
): string {
  switch (mode) {
    case 'speed':
      return a.gs === undefined ? UNKNOWN_COLOR : scaleColor(SPEED_STOPS, a.gs);
    case 'vertical':
      return a.vr === undefined ? UNKNOWN_COLOR : scaleColor(VERTICAL_STOPS, a.vr);
    case 'freshness':
      return a.stale ? '#7d8ea5' : '#5ce1ff';
    case 'mono':
      return '#e8f1ff';
    case 'classic':
      return a.onGround ? '#c9a74d' : '#ffcc33';
    default:
      if (a.onGround) return GROUND_COLOR;
      return a.alt === undefined ? UNKNOWN_COLOR : scaleColor(ALTITUDE_STOPS[palette], a.alt);
  }
}

/** MapLibre expression equivalent of aircraftColor (reads feature properties). */
export function aircraftColorExpression(mode: ColorMode, palette: AltitudePalette): unknown {
  const interp = (prop: string, stops: Stop[]) => [
    'case',
    ['==', ['get', prop], null],
    UNKNOWN_COLOR,
    ['interpolate', ['linear'], ['get', prop], ...stops.flat()],
  ];
  switch (mode) {
    case 'speed':
      return interp('gs', SPEED_STOPS);
    case 'vertical':
      return interp('vr', VERTICAL_STOPS);
    case 'freshness':
      return ['case', ['==', ['get', 'st'], 'live'], '#5ce1ff', '#7d8ea5'];
    case 'mono':
      return '#e8f1ff';
    case 'classic':
      // The classic flight-tracker look: every aircraft yellow, ground traffic muted.
      return ['case', ['==', ['get', 'gnd'], 1], '#c9a74d', '#ffcc33'];
    default:
      return ['case', ['==', ['get', 'gnd'], 1], GROUND_COLOR, interp('alt', ALTITUDE_STOPS[palette])];
  }
}
