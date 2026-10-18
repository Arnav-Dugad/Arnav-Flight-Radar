// adsb.fi (ADSBexchange-v2-compatible / readsb JSON) → normalized Aircraft.
// Defensive: every field is type- and range-checked; anything implausible is
// dropped rather than "fixed". Records without a valid position are discarded.

import { isValidCoordinate, normalizeBearing } from './geo';
import type { Aircraft, AircraftExtras, PositionSource } from './types';

/** A position older than this (seconds) is reported as stale by the server. */
export const LIVE_THRESHOLD_SEC = 30;

type Raw = Record<string, unknown>;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const inRange = (v: unknown, min: number, max: number): number | undefined => {
  const n = num(v);
  return n !== undefined && n >= min && n <= max ? n : undefined;
};

const str = (v: unknown, max = 64): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : undefined;
};

const HEX_RE = /^~?[0-9a-f]{6}$/i;
const SQUAWK_RE = /^[0-7]{4}$/;
const CATEGORY_RE = /^[A-D][0-7]$/;
const CALLSIGN_RE = /^[A-Z0-9-]{1,8}$/;

const SOURCE: Record<string, PositionSource> = {
  adsb_icao: 'adsb',
  adsb_icao_nt: 'adsb',
  adsb_other: 'adsb',
  adsr_icao: 'adsr',
  adsr_other: 'adsr',
  tisb_icao: 'tisb',
  tisb_trackfile: 'tisb',
  tisb_other: 'tisb',
  adsc: 'adsc',
  mlat: 'mlat',
  mode_s: 'modes',
  other: 'other',
};

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function normalizeAdsbfiRecord(raw: unknown, providerNow: number, receivedAt: number): Aircraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;

  const hex = str(r.hex, 7)?.toLowerCase();
  if (!hex || !HEX_RE.test(hex)) return null;

  const lat = num(r.lat);
  const lon = num(r.lon);
  if (!isValidCoordinate(lat, lon)) return null;

  // seen_pos: seconds since the last position update; seen: since any message.
  const seenPos = inRange(r.seen_pos, 0, 3600) ?? inRange(r.seen, 0, 3600);
  if (seenPos === undefined) return null; // we will not invent a timestamp
  const seen = inRange(r.seen, 0, 3600) ?? seenPos;

  const onGround = r.alt_baro === 'ground';
  const altitudeBarometric = onGround ? undefined : inRange(r.alt_baro, -2000, 80000);
  const altitudeGeometric = inRange(r.alt_geom, -2000, 80000);

  const callsignRaw = str(r.flight, 10)?.toUpperCase();
  const callsign = callsignRaw && CALLSIGN_RE.test(callsignRaw) ? callsignRaw : undefined;

  const squawkRaw = str(r.squawk, 4);
  const squawk = squawkRaw && SQUAWK_RE.test(squawkRaw) ? squawkRaw : undefined;

  const categoryRaw = str(r.category, 2)?.toUpperCase();
  const category = categoryRaw && CATEGORY_RE.test(categoryRaw) ? categoryRaw : undefined;

  const emergencyRaw = str(r.emergency, 16)?.toLowerCase();
  const emergency = emergencyRaw && emergencyRaw !== 'none' ? emergencyRaw : undefined;

  const track = inRange(r.track, 0, 360);
  const verticalRate = inRange(r.baro_rate, -30000, 30000) ?? inRange(r.geom_rate, -30000, 30000);

  const dbFlags = num(r.dbFlags);

  const ext: AircraftExtras = {};
  const setExt = <K extends keyof AircraftExtras>(k: K, v: AircraftExtras[K] | undefined) => {
    if (v !== undefined) ext[k] = v;
  };
  setExt('ias', inRange(r.ias, 0, 1000));
  setExt('tas', inRange(r.tas, 0, 1500));
  setExt('mach', inRange(r.mach, 0, 5));
  setExt('roll', inRange(r.roll, -90, 90));
  setExt('magHeading', inRange(r.mag_heading, 0, 360));
  setExt('trueHeading', inRange(r.true_heading, 0, 360));
  setExt('navAltitudeMcp', inRange(r.nav_altitude_mcp, -2000, 80000));
  setExt('navAltitudeFms', inRange(r.nav_altitude_fms, -2000, 80000));
  setExt('navHeading', inRange(r.nav_heading, 0, 360));
  setExt('navQnh', inRange(r.nav_qnh, 800, 1100));
  setExt('windDirection', inRange(r.wd, 0, 360));
  setExt('windSpeed', inRange(r.ws, 0, 400));
  setExt('outsideAirTemp', inRange(r.oat, -100, 60));
  setExt('nic', inRange(r.nic, 0, 15));
  setExt('nacP', inRange(r.nac_p, 0, 15));
  setExt('sil', inRange(r.sil, 0, 3));
  setExt('rssi', inRange(r.rssi, -60, 10));
  setExt('messages', inRange(r.messages, 0, 1e10));
  setExt('adsbVersion', inRange(r.version, 0, 9));
  setExt('ownerOperator', str(r.ownOp, 80));
  setExt('year', str(r.year, 4));

  const typeCode = str(r.t, 4)?.toUpperCase();

  const ac: Aircraft = {
    id: hex,
    icao24: hex,
    lat: round(lat as number, 6),
    lon: round(lon as number, 6),
    onGround,
    positionSource: SOURCE[String(r.type)] ?? 'other',
    observedAt: Math.round(providerNow - seenPos * 1000),
    seenAt: Math.round(providerNow - seen * 1000),
    receivedAt,
    provider: 'adsbfi',
    freshness: seenPos <= LIVE_THRESHOLD_SEC ? 'live' : 'stale',
  };
  if (callsign) ac.callsign = callsign;
  const reg = str(r.r, 12)?.toUpperCase();
  if (reg) ac.registration = reg;
  if (typeCode && /^[A-Z0-9]{2,4}$/.test(typeCode)) ac.aircraftType = typeCode;
  const desc = str(r.desc, 80);
  if (desc) ac.typeDescription = desc;
  if (category) ac.category = category;
  if (altitudeBarometric !== undefined) ac.altitudeBarometric = altitudeBarometric;
  if (altitudeGeometric !== undefined) ac.altitudeGeometric = altitudeGeometric;
  const gs = inRange(r.gs, 0, 2000);
  if (gs !== undefined) ac.groundSpeed = round(gs, 1);
  if (track !== undefined) ac.track = round(normalizeBearing(track), 1);
  if (verticalRate !== undefined) ac.verticalRate = verticalRate;
  if (squawk) ac.squawk = squawk;
  if (emergency) ac.emergency = emergency;
  if (dbFlags !== undefined && (dbFlags & 1) === 1) ac.military = true;
  // readsb database flags: 4 = PIA (privacy ICAO address), 8 = LADD (FAA limited display).
  if (dbFlags !== undefined && (dbFlags & 8) === 8) ac.privacy = 'ladd';
  else if (dbFlags !== undefined && (dbFlags & 4) === 4) ac.privacy = 'pia';
  const dst = inRange(r.dst, 0, 1000);
  if (dst !== undefined) ac.distanceNm = round(dst, 2);
  if (Object.keys(ext).length > 0) ac.ext = ext;
  return ac;
}

export interface AdsbfiEnvelope {
  now: number;
  records: unknown[];
}

/** Validates the response envelope; throws on a shape we do not understand. */
export function parseAdsbfiEnvelope(body: unknown): AdsbfiEnvelope {
  if (!body || typeof body !== 'object') throw new Error('Provider returned a non-object body.');
  const b = body as Raw;
  const list = Array.isArray(b.ac) ? b.ac : Array.isArray(b.aircraft) ? b.aircraft : null;
  if (!list) {
    // adsb.fi answers an empty area with `ac: []`; anything else is unexpected.
    throw new Error('Provider response did not contain an aircraft list.');
  }
  const nowRaw = num(b.now);
  // v2/v3 report milliseconds; older readsb outputs used seconds.
  const now = nowRaw === undefined ? Date.now() : nowRaw < 1e12 ? nowRaw * 1000 : nowRaw;
  return { now, records: list };
}

/** Normalizes and de-duplicates (keeping the most recent position per address). */
export function normalizeAdsbfi(body: unknown, receivedAt = Date.now()): { now: number; aircraft: Aircraft[] } {
  const { now, records } = parseAdsbfiEnvelope(body);
  const byId = new Map<string, Aircraft>();
  for (const rec of records) {
    const ac = normalizeAdsbfiRecord(rec, now, receivedAt);
    if (!ac) continue;
    const prev = byId.get(ac.id);
    if (!prev || prev.observedAt < ac.observedAt) byId.set(ac.id, ac);
  }
  return { now, aircraft: [...byId.values()] };
}

/** Returns the raw records matching a hex (for the Data Inspector). */
export function rawRecords(body: unknown): unknown[] {
  try {
    return parseAdsbfiEnvelope(body).records.slice(0, 20);
  } catch {
    return [];
  }
}
