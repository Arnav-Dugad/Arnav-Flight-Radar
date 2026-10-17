// Original top-down aircraft silhouettes (nose pointing north).
// Coordinates are in a 64-unit box centred on (0, 0); y grows toward the tail.
// Each silhouette is described once and rendered both to SVG (UI) and to a
// canvas for the map's signed-distance-field icons.

import type { AircraftClass } from '@shared/classify';

type Pt = [number, number];

type Shape =
  | { k: 'half'; pts: Pt[] } // right half of a symmetric outline, nose → tail, mirrored automatically
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; mirror?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; rot?: number; r?: number; mirror?: boolean }
  | { k: 'circle'; cx: number; cy: number; r: number; mirror?: boolean };

export const SILHOUETTES: Record<AircraftClass, Shape[]> = {
  widebody: [
    {
      k: 'half',
      pts: [
        [0, -30],
        [1.9, -28.6],
        [3, -25.5],
        [3.3, -20],
        [3.3, -6.5],
        [28.5, 8],
        [29.2, 10.6],
        [3.3, 3.6],
        [3, 18],
        [12, 24.6],
        [12.4, 27],
        [2.6, 25.6],
        [1.4, 30],
        [0, 30.6],
      ],
    },
    { k: 'ellipse', cx: 10.4, cy: -0.6, rx: 1.9, ry: 3.8, mirror: true },
    { k: 'ellipse', cx: 18.2, cy: 4.2, rx: 1.6, ry: 3.2, mirror: true },
  ],
  narrowbody: [
    {
      k: 'half',
      pts: [
        [0, -26],
        [1.6, -24.8],
        [2.6, -21.5],
        [2.8, -16],
        [2.8, -3],
        [22, 7],
        [22.5, 9.3],
        [2.8, 4.4],
        [2.6, 16.5],
        [9.6, 22.3],
        [9.9, 24.4],
        [2.2, 23.2],
        [1.2, 26.4],
        [0, 27],
      ],
    },
    { k: 'ellipse', cx: 8.2, cy: 0.9, rx: 1.65, ry: 3.3, mirror: true },
  ],
  regional: [
    {
      k: 'half',
      pts: [
        [0, -25],
        [1.5, -23.8],
        [2.3, -20.5],
        [2.4, -14],
        [2.4, -2.5],
        [18.6, 5],
        [18.9, 7],
        [2.4, 3.8],
        [2.4, 18],
        [2.2, 20.5],
        [8.6, 23.6],
        [8.8, 25.5],
        [1.8, 25],
        [1, 26.6],
        [0, 27],
      ],
    },
    { k: 'ellipse', cx: 4.6, cy: 14, rx: 1.7, ry: 3.6, mirror: true },
  ],
  turboprop: [
    {
      k: 'half',
      pts: [
        [0, -23.5],
        [1.5, -22.4],
        [2.3, -19.5],
        [2.4, -14],
        [2.4, -5.2],
        [24.2, -4.2],
        [24.4, -1.2],
        [2.4, -0.6],
        [2.2, 16.5],
        [8.6, 20.6],
        [8.8, 22.6],
        [1.6, 22.4],
        [1, 24.6],
        [0, 25],
      ],
    },
    { k: 'ellipse', cx: 8.4, cy: -6, rx: 1.7, ry: 4.8, mirror: true },
    { k: 'rect', x: 4.4, y: -11.2, w: 8, h: 1.3, r: 0.6, mirror: true },
  ],
  bizjet: [
    {
      k: 'half',
      pts: [
        [0, -21],
        [1.3, -19.8],
        [1.9, -16.5],
        [2, -11],
        [2, -2.6],
        [13.6, 5],
        [13.9, 6.7],
        [2, 2.6],
        [1.9, 15.2],
        [7.2, 18.7],
        [7.4, 20.2],
        [1.5, 19.6],
        [0.8, 21.8],
        [0, 22.2],
      ],
    },
    { k: 'ellipse', cx: 3.9, cy: 10.8, rx: 1.35, ry: 2.9, mirror: true },
  ],
  helicopter: [
    { k: 'ellipse', cx: 0, cy: -5, rx: 5, ry: 9 },
    { k: 'rect', x: -1.1, y: 2, w: 2.2, h: 21, r: 1 },
    { k: 'rect', x: -5, y: 20.5, w: 10, h: 1.8, r: 0.9 },
    { k: 'rect', x: -22, y: -5.9, w: 44, h: 1.9, rot: 45, r: 0.9 },
    { k: 'rect', x: -22, y: -5.9, w: 44, h: 1.9, rot: -45, r: 0.9 },
  ],
  light: [
    {
      k: 'half',
      pts: [
        [0, -15],
        [1.8, -14.2],
        [2.4, -11],
        [2.5, -8.2],
        [19.5, -8.2],
        [19.8, -4.2],
        [2.5, -4.2],
        [1.5, 9.5],
        [7, 10.4],
        [7.2, 13.4],
        [1, 13.6],
        [0, 15],
      ],
    },
  ],
  glider: [
    {
      k: 'half',
      pts: [
        [0, -11],
        [1, -10],
        [1.4, -6],
        [1.4, -3.6],
        [29.5, -2.6],
        [29.6, -1],
        [1.4, -0.4],
        [0.7, 13.5],
        [5.4, 14],
        [5.4, 15.6],
        [0.6, 15.6],
        [0, 16.4],
      ],
    },
  ],
  military: [
    {
      k: 'half',
      pts: [
        [0, -27],
        [1.2, -23],
        [2.4, -15],
        [3.2, -7],
        [17.5, 9],
        [17.8, 12.6],
        [5.8, 12.8],
        [5, 17.5],
        [9.4, 22.8],
        [9.4, 25],
        [3.2, 24.4],
        [2, 26.4],
        [0, 26.4],
      ],
    },
  ],
  balloon: [
    { k: 'circle', cx: 0, cy: -3, r: 11 },
    { k: 'rect', x: -2.4, y: 9, w: 4.8, h: 4.2, r: 0.8 },
  ],
  drone: [
    { k: 'rect', x: -3.6, y: -3.6, w: 7.2, h: 7.2, r: 1.5 },
    { k: 'rect', x: -14, y: -1, w: 28, h: 2, rot: 45, r: 1 },
    { k: 'rect', x: -14, y: -1, w: 28, h: 2, rot: -45, r: 1 },
    { k: 'circle', cx: 9.9, cy: 9.9, r: 4.6, mirror: true },
    { k: 'circle', cx: 9.9, cy: -9.9, r: 4.6, mirror: true },
  ],
  ground: [{ k: 'rect', x: -5, y: -8, w: 10, h: 16, r: 2.5 }],
  unknown: [
    {
      k: 'half',
      pts: [
        [0, -22],
        [2, -19],
        [2.6, -12],
        [2.6, -3],
        [19, 6.8],
        [19, 9.6],
        [2.6, 4.6],
        [2.2, 14.5],
        [8, 19.2],
        [8, 21.4],
        [0, 20.4],
      ],
    },
  ],
};

const rad = (d: number) => (d * Math.PI) / 180;

function rectPoints(s: Extract<Shape, { k: 'rect' }>, flip: boolean): Pt[] {
  const corners: Pt[] = [
    [s.x, s.y],
    [s.x + s.w, s.y],
    [s.x + s.w, s.y + s.h],
    [s.x, s.y + s.h],
  ];
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const a = rad(s.rot ?? 0);
  return corners.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const rx = cx + dx * Math.cos(a) - dy * Math.sin(a);
    const ry = cy + dx * Math.sin(a) + dy * Math.cos(a);
    return [flip ? -rx : rx, ry];
  });
}

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * SVG path data in the 64-unit box (translate by 32,32 for a 0..64 viewBox).
 * One path per shape: overlapping parts (rotor over fuselage, pods under wings)
 * are painted as separate fills so winding direction can never punch holes.
 */
export function silhouettePaths(cls: AircraftClass): string[] {
  const parts: string[] = [];
  for (const s of SILHOUETTES[cls]) {
    const variants = 'mirror' in s && s.mirror ? [false, true] : [false];
    for (const flip of variants) {
      const sx = flip ? -1 : 1;
      if (s.k === 'half') {
        const right = s.pts;
        const left = [...s.pts].reverse().map(([x, y]) => [-x, y] as Pt);
        const all = [...right, ...left];
        parts.push(`M${all.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}Z`);
      } else if (s.k === 'ellipse') {
        const cx = s.cx * sx;
        parts.push(
          `M${f(cx - s.rx)},${f(s.cy)}a${s.rx},${s.ry} 0 1,0 ${f(s.rx * 2)},0a${s.rx},${s.ry} 0 1,0 ${f(-s.rx * 2)},0Z`,
        );
      } else if (s.k === 'circle') {
        const cx = s.cx * sx;
        parts.push(`M${f(cx - s.r)},${f(s.cy)}a${s.r},${s.r} 0 1,0 ${f(s.r * 2)},0a${s.r},${s.r} 0 1,0 ${f(-s.r * 2)},0Z`);
      } else {
        const pts = rectPoints(s, flip);
        parts.push(`M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}Z`);
      }
    }
  }
  return parts;
}

/** Draws a silhouette filled white into a canvas context already transformed. */
export function drawSilhouette(ctx: CanvasRenderingContext2D, cls: AircraftClass): void {
  ctx.fillStyle = '#fff';
  for (const d of silhouettePaths(cls)) ctx.fill(new Path2D(d));
}
