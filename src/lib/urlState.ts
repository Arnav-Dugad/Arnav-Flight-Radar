// Shareable map state in the query string:
//   ?lat=51.4700&lon=-0.4543&z=9.2&b=0&p=0&style=obsidian&proj=globe&ac=400a5b&apt=EGLL&follow=1

import type { MapStyleId } from '@/state/settings';
import { STYLE_IDS } from './styleIds';

export interface UrlState {
  lat?: number;
  lon?: number;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  style?: MapStyleId;
  globe?: boolean;
  aircraft?: string;
  airport?: string;
  follow?: boolean;
}

const num = (v: string | null, min: number, max: number) => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function readUrlState(search = window.location.search): UrlState {
  const q = new URLSearchParams(search);
  const s: UrlState = {};
  const lat = num(q.get('lat'), -85, 85);
  const lon = num(q.get('lon'), -180, 180);
  if (lat !== undefined && lon !== undefined) {
    s.lat = lat;
    s.lon = lon;
  }
  const z = num(q.get('z'), 0, 20);
  if (z !== undefined) s.zoom = z;
  const b = num(q.get('b'), -360, 360);
  if (b !== undefined) s.bearing = b;
  const p = num(q.get('p'), 0, 85);
  if (p !== undefined) s.pitch = p;
  const style = q.get('style');
  if (style && (STYLE_IDS as readonly string[]).includes(style)) s.style = style as MapStyleId;
  if (q.get('proj') === 'globe') s.globe = true;
  const ac = q.get('ac')?.toLowerCase();
  if (ac && /^[0-9a-f]{6}$/.test(ac)) s.aircraft = ac;
  const apt = q.get('apt')?.toUpperCase();
  if (apt && /^[A-Z0-9-]{2,10}$/.test(apt)) s.airport = apt;
  if (q.get('follow') === '1') s.follow = true;
  return s;
}

export function writeUrlState(s: UrlState) {
  const q = new URLSearchParams();
  if (s.lat !== undefined && s.lon !== undefined) {
    q.set('lat', s.lat.toFixed(4));
    q.set('lon', s.lon.toFixed(4));
  }
  if (s.zoom !== undefined) q.set('z', s.zoom.toFixed(2));
  if (s.bearing) q.set('b', s.bearing.toFixed(1));
  if (s.pitch) q.set('p', s.pitch.toFixed(0));
  if (s.style) q.set('style', s.style);
  if (s.globe) q.set('proj', 'globe');
  if (s.aircraft) q.set('ac', s.aircraft);
  if (s.airport) q.set('apt', s.airport);
  if (s.follow) q.set('follow', '1');
  const url = `${window.location.pathname}?${q.toString()}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
}

export function shareUrl(extra: Partial<UrlState>): string {
  const q = new URLSearchParams(window.location.search);
  if (extra.aircraft) q.set('ac', extra.aircraft);
  if (extra.airport) q.set('apt', extra.airport);
  if (extra.follow) q.set('follow', '1');
  return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
}
