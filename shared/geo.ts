// Geodesy helpers on a spherical Earth (adequate for display; not for navigation).

export const EARTH_RADIUS_NM = 3440.065;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function isValidLat(lat: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLon(lon: unknown): lon is number {
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return isValidLat(lat) && isValidLon(lon);
}

export function normalizeLon(lon: number): number {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return x === -180 && lon > 0 ? 180 : x;
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing, degrees true. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeBearing(Math.atan2(y, x) * R2D);
}

/** Point reached travelling `distNm` from a start point along an initial bearing. */
export function destination(lat: number, lon: number, bearing: number, distNm: number): [number, number] {
  const d = distNm / EARTH_RADIUS_NM;
  const b = bearing * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * R2D, normalizeLon(l2 * R2D)];
}

/** Point at fraction f (0–1) along the great circle from point 1 to point 2. */
export function intermediatePoint(lat1: number, lon1: number, lat2: number, lon2: number, f: number): [number, number] {
  const p1 = lat1 * D2R;
  const l1 = lon1 * D2R;
  const p2 = lat2 * D2R;
  const l2 = lon2 * D2R;
  const d = distanceNm(lat1, lon1, lat2, lon2) / EARTH_RADIUS_NM;
  if (d < 1e-9) return [lat1, lon1];
  const a = Math.sin((1 - f) * d) / Math.sin(d);
  const b = Math.sin(f * d) / Math.sin(d);
  const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
  const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
  const z = a * Math.sin(p1) + b * Math.sin(p2);
  return [Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, normalizeLon(Math.atan2(y, x) * R2D)];
}

/** Linear interpolation between two positions (fine for the short spans between reports). */
export function lerpPosition(a: [number, number], b: [number, number], t: number): [number, number] {
  let dLon = b[1] - a[1];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return [a[0] + (b[0] - a[0]) * t, normalizeLon(a[1] + dLon * t)];
}

/** Shortest signed angular difference b − a in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = normalizeBearing(b) - normalizeBearing(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeBearing(a + angleDelta(a, b) * t);
}

/** Polygon approximating a geodesic circle, for coverage rings. */
export function circlePolygon(lat: number, lon: number, radiusNm: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const [la, lo] = destination(lat, lon, (i / steps) * 360, radiusNm);
    ring.push([lo, la]);
  }
  return ring;
}

const COORD_RE =
  /^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i;

/** Parses "51.47, -0.45", "51.47N 0.45W", "-33.9 151.2". Returns [lat, lon] or null. */
export function parseCoordinates(input: string): [number, number] | null {
  const m = COORD_RE.exec(input);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[2]?.toUpperCase() === 'N') lat = Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (m[4]?.toUpperCase() === 'E') lon = Math.abs(lon);
  return isValidCoordinate(lat, lon) ? [lat, lon] : null;
}

export function formatLatLon(lat: number, lon: number, digits = 4): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}  ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}
