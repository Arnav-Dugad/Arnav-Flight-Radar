// Geographic request normalization.
//
// Visitors look at slightly different viewports. If every viewport produced its
// own upstream call we would burn the provider's 1 req/s budget instantly. So the
// server snaps every request to a coarse grid of shared regions: everyone looking
// at roughly the same area hits the same cached snapshot.

import { isValidCoordinate } from './geo';
import type { RegionQuery } from './types';

export const MAX_RADIUS_NM = 250; // adsb.fi v3 maximum
export const MIN_RADIUS_NM = 25;
export const RADIUS_BUCKETS = [25, 50, 100, 150, 200, 250] as const;

export class RegionError extends Error {}

/** Picks the smallest bucket that still covers the requested radius plus snapping slack. */
export function snapRadius(requestedNm: number): number {
  const r = Math.max(MIN_RADIUS_NM, Math.min(MAX_RADIUS_NM, requestedNm));
  // Snapping the centre moves it by up to ~0.142 r (half a grid cell on each axis), so pad by 18 %.
  const needed = Math.min(MAX_RADIUS_NM, r * 1.18);
  return RADIUS_BUCKETS.find((b) => b >= needed) ?? MAX_RADIUS_NM;
}

/** Grid spacing in degrees of latitude for a given bucket radius. */
export function gridStep(radiusNm: number): number {
  // radius / 5 in NM → degrees (1° lat = 60 NM). 250 NM → 0.8333°, 25 NM → 0.0833°.
  return radiusNm / 5 / 60;
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function normalizeRegion(lat: number, lon: number, radiusNm: number): RegionQuery {
  if (!isValidCoordinate(lat, lon)) throw new RegionError('Coordinates are out of range.');
  if (!Number.isFinite(radiusNm) || radiusNm <= 0) throw new RegionError('Radius must be a positive number.');
  const r = snapRadius(radiusNm);
  const latStep = gridStep(r);
  const sLat = Math.max(-89, Math.min(89, snap(lat, latStep)));
  // Longitude cells stay roughly square on the ground (never absurdly wide near the
  // poles). Derived from the SNAPPED latitude so every point in a cell agrees.
  const lonStep = latStep / Math.max(0.2, Math.cos((sLat * Math.PI) / 180));
  let sLon = snap(lon, lonStep);
  if (sLon > 180) sLon -= 360;
  if (sLon < -180) sLon += 360;
  return { lat: round4(sLat), lon: round4(sLon), radiusNm: r };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function regionKey(q: RegionQuery): string {
  return `${q.lat.toFixed(4)},${q.lon.toFixed(4)},${q.radiusNm}`;
}
