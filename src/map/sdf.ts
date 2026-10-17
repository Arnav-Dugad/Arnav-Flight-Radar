// Signed distance field generation for map icons.
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, 2012),
// encoded the way MapLibre's SDF shader expects: the shape edge sits at
// alpha ≈ 192/255 (cutoff 0.25), distances fall off over `radius` pixels.

import type { AircraftClass } from '@shared/classify';
import { drawSilhouette } from './silhouettes';

const INF = 1e20;

function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset]!;
  for (let q = 1, k = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]!;
    const q2 = q * q;
    let s: number;
    do {
      const r = v[k]!;
      s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k]! && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1]! < q) k++;
    const r = v[k]!;
    const qr = q - r;
    grid[offset + q * stride] = f[r]! + qr * qr;
  }
}

function edt(data: Float64Array, width: number, height: number) {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const v = new Uint16Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
  for (let y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
}

export interface SdfIcon {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, alpha carries the distance
}

/**
 * Renders a silhouette at `px` pixels for the 64-unit box, with `buffer` pixels of
 * padding for halos, and returns an SDF image.
 */
export function silhouetteSdf(cls: AircraftClass, px = 56, buffer = 8): SdfIcon {
  return drawSdf((ctx) => drawSilhouette(ctx, cls), px, buffer);
}

/**
 * Generic SDF from any drawing in a 64-unit box centred on (0, 0). Draw opaque
 * white; everything else is treated as outside.
 */
export function drawSdf(
  draw: (ctx: CanvasRenderingContext2D) => void,
  px = 56,
  buffer = 8,
  radius = 8,
  cutoff = 0.25,
): SdfIcon {
  const size = px + buffer * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(size / 2, size / 2);
  ctx.scale(px / 64, px / 64);
  draw(ctx);
  const img = ctx.getImageData(0, 0, size, size).data;

  const area = size * size;
  const outer = new Float64Array(area);
  const inner = new Float64Array(area);
  for (let i = 0; i < area; i++) {
    const a = img[i * 4 + 3]! / 255;
    if (a === 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a === 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      // Anti-aliased edge pixel: sub-pixel distance estimate.
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, size, size);
  edt(inner, size, size);

  const out = new Uint8ClampedArray(area * 4);
  for (let i = 0; i < area; i++) {
    const d = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
    out[i * 4 + 3] = Math.round(255 - 255 * (d / radius + cutoff));
  }
  return { width: size, height: size, data: out };
}
