// REAL published US departure (SID / named ODP) and arrival (STAR) procedures, from the FAA
// Coded Instrument Flight Procedures (public domain), compiled by scripts/build-procedures.mjs
// into public/data/sim/procedures-us.json. Pure functions over that JSON: nothing is fetched
// here. Reference data for the simulation only — never for navigation.

import { angleDelta, bearingDeg, distanceNm } from '@shared/geo';

/** [ident, lat, lon] or [ident, lat, lon, constraint] ("+2500", "-11000", "@9000", "B13000/11000"). */
export type RawFix = [string, number, number] | [string, number, number, string];

export interface RawProcedure {
  /** CIFP computer code, e.g. "DEEZZ6", "CAMRN5". */
  name: string;
  /** Runways served ("RW04L"…) or ["ALL"]. */
  rwys: string[];
  /** One fix sequence per en-route transition (SID: common + transition; STAR: transition + common). */
  tracks: RawFix[][];
  /** Runway-transition fixes per runway: flown before a SID track, after a STAR track. */
  rwt?: Record<string, RawFix[]>;
}

export interface ProceduresAirport {
  lat: number;
  lon: number;
  sids: RawProcedure[];
  stars: RawProcedure[];
}

export interface ProceduresData {
  v: number;
  source: string;
  cycle: string;
  effective?: string | null;
  airports: Record<string, ProceduresAirport>;
}

export interface ProcFix {
  ident: string;
  lat: number;
  lon: number;
  /** Published altitude constraint in feet (at or above / at or below; both equal = "at"). */
  altMin?: number;
  altMax?: number;
}

export interface ProcTrack {
  name: string;
  rwys: string[];
  fixes: ProcFix[];
  /** En-route transition: a SID's last fix, a STAR's first fix. */
  transition?: string;
}

/** "4l", "04L", "RW04L" → "RW04L"; "" / "ALL" → "ALL". */
export function normalizeRunway(runway: string): string {
  const r = runway.trim().toUpperCase().replace(/^RWY?/, '');
  if (!r || r === 'ALL') return 'ALL';
  const m = /^(\d{1,2})([LRC]?)$/.exec(r);
  return m ? `RW${m[1]!.padStart(2, '0')}${m[2]}` : `RW${r}`;
}

/** Parses a constraint string of the JSON ("+2500", "-11000", "@9000", "B13000/11000"). */
export function parseConstraint(c: string | undefined): { altMin?: number; altMax?: number } {
  if (!c) return {};
  const n = Number(c.slice(1));
  switch (c[0]) {
    case '+':
      return Number.isFinite(n) ? { altMin: n } : {};
    case '-':
      return Number.isFinite(n) ? { altMax: n } : {};
    case '@':
      return Number.isFinite(n) ? { altMin: n, altMax: n } : {};
    case 'B': {
      const [hi, lo] = c.slice(1).split('/').map(Number);
      return Number.isFinite(hi) && Number.isFinite(lo) ? { altMin: lo, altMax: hi } : {};
    }
    default:
      return {};
  }
}

function toFix(f: RawFix): ProcFix {
  return { ident: f[0], lat: f[1], lon: f[2], ...parseConstraint(f[3]) };
}

/** Concatenates fix lists, merging a shared junction fix. */
function joinFixes(a: RawFix[], b: RawFix[]): ProcFix[] {
  const out: ProcFix[] = [];
  for (const f of [...a, ...b]) {
    const last = out[out.length - 1];
    if (last && last.ident === f[0]) {
      if (last.altMin === undefined && last.altMax === undefined) Object.assign(last, parseConstraint(f[3]));
      continue;
    }
    out.push(toFix(f));
  }
  return out;
}

function airportOf(data: ProceduresData, airport: string): ProceduresAirport | undefined {
  const a = airport.trim().toUpperCase();
  return data.airports[a] ?? (a.length === 3 ? data.airports[`K${a}`] : undefined);
}

function serves(p: RawProcedure, rw: string): boolean {
  return rw === 'ALL' || p.rwys.includes('ALL') || p.rwys.includes(rw);
}

/** Runway-transition fixes for a runway (none when the transition is headings/vectors only). */
function runwayPart(p: RawProcedure, rw: string): RawFix[] {
  return (rw !== 'ALL' && p.rwt?.[rw]) || [];
}

/**
 * A SID serving the runway (or ALL) whose final fix lies within ±maxDeltaDeg (default 50°) of
 * the desired course from the airport and at least minDistNm (default 15 NM) out; the one
 * whose last-fix bearing best matches wins. Null when no published SID fits (e.g. vector SIDs).
 */
export function pickSid(
  data: ProceduresData,
  airport: string,
  runway: string,
  courseDeg: number,
  opts: { maxDeltaDeg?: number; minDistNm?: number } = {},
): ProcTrack | null {
  const apt = airportOf(data, airport);
  if (!apt) return null;
  const rw = normalizeRunway(runway);
  const maxDelta = opts.maxDeltaDeg ?? 50;
  const minDist = opts.minDistNm ?? 15;
  let best: { p: RawProcedure; t: RawFix[]; d: number } | null = null;
  for (const p of apt.sids) {
    if (!serves(p, rw)) continue;
    for (const t of p.tracks) {
      const last = t[t.length - 1];
      if (!last) continue;
      if (distanceNm(apt.lat, apt.lon, last[1], last[2]) < minDist) continue;
      const d = Math.abs(angleDelta(courseDeg, bearingDeg(apt.lat, apt.lon, last[1], last[2])));
      if (d <= maxDelta && (!best || d < best.d)) best = { p, t, d };
    }
  }
  if (!best) return null;
  const fixes = joinFixes(runwayPart(best.p, rw), best.t);
  return { name: best.p.name, rwys: best.p.rwys, fixes, transition: fixes[fixes.length - 1]?.ident };
}

/**
 * A STAR serving the runway (or ALL) whose first (entry) fix bearing from the airport best
 * matches the direction the flight comes from (bearing airport → origin). Entries more than
 * maxDeltaDeg (default 90°) off are rejected, so a flight never enters from the far side.
 */
export function pickStar(
  data: ProceduresData,
  airport: string,
  runway: string,
  inboundFromDeg: number,
  opts: { maxDeltaDeg?: number } = {},
): ProcTrack | null {
  const apt = airportOf(data, airport);
  if (!apt) return null;
  const rw = normalizeRunway(runway);
  const maxDelta = opts.maxDeltaDeg ?? 90;
  let best: { p: RawProcedure; t: RawFix[]; d: number } | null = null;
  for (const p of apt.stars) {
    if (!serves(p, rw)) continue;
    for (const t of p.tracks) {
      const first = t[0];
      if (!first) continue;
      const d = Math.abs(angleDelta(inboundFromDeg, bearingDeg(apt.lat, apt.lon, first[1], first[2])));
      if (d <= maxDelta && (!best || d < best.d)) best = { p, t, d };
    }
  }
  if (!best) return null;
  const fixes = joinFixes(best.t, runwayPart(best.p, rw));
  return { name: best.p.name, rwys: best.p.rwys, fixes, transition: fixes[0]?.ident };
}

/**
 * Every published procedure of one kind serving a runway, one representative track each
 * (the runway transition joined with the first en-route transition), for diagrams.
 */
export function listProcedures(data: ProceduresData, airport: string, runway: string, kind: 'sid' | 'star'): ProcTrack[] {
  const apt = airportOf(data, airport);
  if (!apt) return [];
  const rw = normalizeRunway(runway);
  const out: ProcTrack[] = [];
  for (const p of kind === 'sid' ? apt.sids : apt.stars) {
    if (!serves(p, rw)) continue;
    const track = p.tracks[0];
    if (!track?.length) continue;
    const rwt = runwayPart(p, rw);
    const fixes = kind === 'sid' ? joinFixes(rwt, track) : joinFixes(track, rwt);
    if (fixes.length < 2) continue;
    const tr: ProcTrack = { name: p.name, rwys: p.rwys, fixes };
    const t = kind === 'sid' ? fixes[fixes.length - 1] : fixes[0];
    if (t) tr.transition = t.ident;
    out.push(tr);
  }
  return out.slice(0, 24);
}
