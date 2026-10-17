// Client-side traffic engine (framework-free, read by the map renderer every frame
// and by React through a version counter).
//
// HONESTY RULES enforced here:
//  • Displayed motion is interpolation BETWEEN real reports: an icon glides from
//    where it was drawn toward the newest authoritative position and stops there.
//    It is never extrapolated beyond the latest report.
//  • Trails are made only of positions actually received; gaps longer than
//    TRAIL_GAP_MS or physically implausible jumps break the trail instead of being
//    bridged.
//  • Ages are measured on the provider's own clock and carried forward with our
//    server clock, so neither a skewed provider nor a skewed device clock can make
//    stale data look fresh.

import { distanceNm, lerpAngle, lerpPosition } from '@shared/geo';
import type { Aircraft, AircraftResponse, RegionQuery, TrackState } from '@shared/types';

export interface TrailPoint {
  lat: number;
  lon: number;
  alt?: number;
  gs?: number;
  vr?: number;
  t: number; // observedAt (provider time, ms)
  gap?: boolean; // true = do not connect to the previous point
}

export interface Track {
  id: string;
  ac: Aircraft;
  /** Age of the position (ms) at the moment our server fetched it, on the provider clock. */
  ageAtFetch: number;
  fetchedAt: number; // server clock
  fromLat: number;
  fromLon: number;
  fromTrk: number | undefined;
  animStart: number; // client clock
  animDur: number;
  trail: TrailPoint[];
  firstSeenAt: number; // client clock
  lastPresentAt: number; // client clock: last time it appeared in a response
  lost: boolean;
  outsideRegion: boolean;
}

export interface FeedMeta {
  region: RegionQuery;
  fetchedAt: number;
  servedAt: number;
  stale: boolean;
  degraded?: string;
  cacheHit: boolean;
  cacheAgeMs: number;
  count: number;
  attribution: AircraftResponse['attribution'];
  receivedAt: number; // client clock
}

export interface Snapshot {
  t: number; // server clock
  // [id, lat, lon, alt|null, track|null, groundSpeed|null]
  rows: [string, number, number, number | null, number | null, number | null][];
}

export const TRAIL_GAP_MS = 150_000;
const MAX_PLAUSIBLE_KT = 1100;
const MAX_SNAPSHOTS = 240; // ≈ 1 hour at 15 s polling
const LIVE_SEC = 30;

type Listener = () => void;

class TrafficEngine {
  tracks = new Map<string, Track>();
  meta: FeedMeta | null = null;
  version = 0;
  /** server clock − client clock (ms), smoothed. */
  clockOffset = 0;
  private hasOffset = false;
  snapshots: Snapshot[] = [];
  regionsQueried: { region: RegionQuery; at: number }[] = [];
  private listeners = new Set<Listener>();

  // Tunables pushed from settings.
  expectedIntervalMs = 15_000;
  smooth = true;
  trailMs = 20 * 60_000;
  staleSec = 45;
  lostSec = 90;
  record = true;
  pinned = new Set<string>(); // selected / compared / followed: never auto-removed

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  serverNow(clientNow = Date.now()) {
    return clientNow + this.clockOffset;
  }

  private updateClock(servedAt: number, clientNow: number) {
    const sample = servedAt - clientNow;
    // Smooth network jitter, but snap on large jumps (device clock changed).
    if (!this.hasOffset || Math.abs(sample - this.clockOffset) > 5000) {
      this.clockOffset = sample;
      this.hasOffset = true;
    } else this.clockOffset += (sample - this.clockOffset) * 0.3;
  }

  /** Position age right now (ms). */
  ageMs(t: Track, clientNow = Date.now()) {
    return t.ageAtFetch + Math.max(0, this.serverNow(clientNow) - t.fetchedAt);
  }

  stateOf(t: Track, clientNow = Date.now()): TrackState {
    if (t.lost) return 'lost';
    return this.ageMs(t, clientNow) / 1000 <= Math.max(LIVE_SEC, Math.min(this.staleSec, 120)) ? 'live' : 'stale';
  }

  /** Where to draw the aircraft now (interpolated between real reports). */
  displayPosition(t: Track, clientNow = Date.now()): { lat: number; lon: number; trk: number | undefined; settled: boolean } {
    const to = t.ac;
    const toTrk = to.track ?? to.ext?.trueHeading ?? to.ext?.magHeading;
    if (!this.smooth || t.animDur <= 0) return { lat: to.lat, lon: to.lon, trk: toTrk, settled: true };
    const p = Math.min(1, Math.max(0, (clientNow - t.animStart) / t.animDur));
    if (p >= 1) return { lat: to.lat, lon: to.lon, trk: toTrk, settled: true };
    const [lat, lon] = lerpPosition([t.fromLat, t.fromLon], [to.lat, to.lon], p);
    // Heading turns a little faster than position so the nose leads the turn.
    const hp = Math.min(1, p * 2.2);
    const eased = 1 - (1 - hp) ** 3;
    const trk = t.fromTrk === undefined || toTrk === undefined ? toTrk : lerpAngle(t.fromTrk, toTrk, eased);
    return { lat, lon, trk, settled: false };
  }

  ingest(resp: AircraftResponse, clientNow = Date.now()) {
    this.updateClock(resp.servedAt, clientNow);
    const seen = new Set<string>();
    for (const ac of resp.aircraft) {
      seen.add(ac.id);
      this.upsert(ac, resp.providerNow, resp.fetchedAt, clientNow);
    }

    const r = resp.query;
    for (const [id, t] of this.tracks) {
      if (seen.has(id)) continue;
      const inside = distanceNm(r.lat, r.lon, t.ac.lat, t.ac.lon) < r.radiusNm * 0.97;
      if (inside) {
        // Expected in this region but missing → the provider stopped reporting it.
        if (!t.lost && clientNow - t.lastPresentAt > 1000) t.lost = true;
        t.outsideRegion = false;
      } else {
        t.outsideRegion = true;
      }
    }

    this.meta = {
      region: r,
      fetchedAt: resp.fetchedAt,
      servedAt: resp.servedAt,
      stale: resp.stale,
      cacheHit: resp.cache.hit,
      cacheAgeMs: resp.cache.ageMs,
      count: resp.count,
      attribution: resp.attribution,
      receivedAt: clientNow,
    };
    if (resp.degraded) this.meta.degraded = resp.degraded;

    const last = this.regionsQueried[this.regionsQueried.length - 1];
    if (!last || last.region.lat !== r.lat || last.region.lon !== r.lon || last.region.radiusNm !== r.radiusNm) {
      this.regionsQueried.push({ region: r, at: clientNow });
      if (this.regionsQueried.length > 12) this.regionsQueried.shift();
    } else last.at = clientNow;

    if (this.record) this.recordSnapshot(resp);
    this.prune(clientNow);
    this.emit();
  }

  /** Single-aircraft updates (e.g. a selected aircraft outside the polled region). */
  ingestLookup(list: Aircraft[], providerNow: number, fetchedAt: number, servedAt: number, clientNow = Date.now()) {
    this.updateClock(servedAt, clientNow);
    for (const ac of list) {
      this.upsert(ac, providerNow, fetchedAt, clientNow);
      const t = this.tracks.get(ac.id);
      if (t) t.outsideRegion = !this.meta || distanceNm(this.meta.region.lat, this.meta.region.lon, ac.lat, ac.lon) > this.meta.region.radiusNm;
    }
    this.emit();
  }

  private upsert(ac: Aircraft, providerNow: number, fetchedAt: number, clientNow: number) {
    const prev = this.tracks.get(ac.id);
    const ageAtFetch = Math.max(0, providerNow - ac.observedAt);
    if (!prev) {
      this.tracks.set(ac.id, {
        id: ac.id,
        ac,
        ageAtFetch,
        fetchedAt,
        fromLat: ac.lat,
        fromLon: ac.lon,
        fromTrk: ac.track,
        animStart: clientNow,
        animDur: 0,
        trail: [point(ac)],
        firstSeenAt: clientNow,
        lastPresentAt: clientNow,
        lost: false,
        outsideRegion: false,
      });
      return;
    }

    prev.lastPresentAt = clientNow;
    prev.lost = false;
    prev.outsideRegion = false;
    if (ac.observedAt <= prev.ac.observedAt) {
      // Same (or older) position: keep the newer metadata only.
      prev.ac = { ...ac, lat: prev.ac.lat, lon: prev.ac.lon, observedAt: prev.ac.observedAt };
      return;
    }

    const shown = this.displayPosition(prev, clientNow);
    const dtH = (ac.observedAt - prev.ac.observedAt) / 3_600_000;
    const jump = distanceNm(prev.ac.lat, prev.ac.lon, ac.lat, ac.lon);
    const implausible = dtH > 0 && jump / dtH > MAX_PLAUSIBLE_KT && jump > 2;
    const gap = ac.observedAt - prev.ac.observedAt > TRAIL_GAP_MS || implausible;

    prev.fromLat = shown.lat;
    prev.fromLon = shown.lon;
    prev.fromTrk = shown.trk;
    prev.animStart = clientNow;
    // Glide over roughly the time until the next report is expected; snap on gaps.
    prev.animDur = gap ? 0 : Math.max(2000, Math.min(30_000, this.expectedIntervalMs * 1.05));
    prev.ac = ac;
    prev.ageAtFetch = ageAtFetch;
    prev.fetchedAt = fetchedAt;

    const pt = point(ac);
    if (gap) pt.gap = true;
    prev.trail.push(pt);
  }

  private recordSnapshot(resp: AircraftResponse) {
    const rows: Snapshot['rows'] = resp.aircraft.map((a) => [
      a.id,
      a.lat,
      a.lon,
      a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric ?? null),
      a.track ?? null,
      a.groundSpeed ?? null,
    ]);
    this.snapshots.push({ t: resp.fetchedAt, rows });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  prune(clientNow = Date.now()) {
    const cutoff = this.serverNow(clientNow) - this.trailMs;
    for (const [id, t] of this.tracks) {
      if (t.trail.length > 1 && t.trail[0]!.t < cutoff) {
        const i = t.trail.findIndex((p) => p.t >= cutoff);
        t.trail = i < 0 ? t.trail.slice(-1) : t.trail.slice(i);
        if (t.trail[0]) t.trail[0] = { ...t.trail[0], gap: false };
      }
      if (this.pinned.has(id)) continue;
      if (t.outsideRegion) this.tracks.delete(id);
      else if (t.lost && clientNow - t.lastPresentAt > this.lostSec * 1000) this.tracks.delete(id);
    }
  }

  clearSession() {
    this.snapshots = [];
    for (const t of this.tracks.values()) t.trail = t.trail.slice(-1);
    this.emit();
  }

  get(id: string | null | undefined) {
    return id ? this.tracks.get(id) : undefined;
  }

  list(): Track[] {
    return [...this.tracks.values()];
  }

  /** Aircraft currently reported (excludes lost / out-of-region pinned ones). */
  current(): Aircraft[] {
    const out: Aircraft[] = [];
    for (const t of this.tracks.values()) if (!t.lost && !t.outsideRegion) out.push(t.ac);
    return out;
  }

  touch() {
    this.emit();
  }
}

function point(ac: Aircraft): TrailPoint {
  const p: TrailPoint = { lat: ac.lat, lon: ac.lon, t: ac.observedAt };
  const alt = ac.onGround ? 0 : (ac.altitudeBarometric ?? ac.altitudeGeometric);
  if (alt !== undefined) p.alt = alt;
  if (ac.groundSpeed !== undefined) p.gs = ac.groundSpeed;
  if (ac.verticalRate !== undefined) p.vr = ac.verticalRate;
  return p;
}

export const traffic = new TrafficEngine();
export type { TrafficEngine };
