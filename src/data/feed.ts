// Live feed controller: decides WHICH region to poll and WHEN.
//
//  • Region = viewport centre (or the followed aircraft) with a radius covering
//    the view, clamped to the provider's 250 NM maximum. Snapped exactly as the
//    server snaps, so small pans don't trigger new upstream requests.
//  • Interval = user setting (default 15 s, minimum 10 s), paused while the tab is
//    hidden, with exponential back-off on errors and honouring Retry-After.
//  • A selected aircraft that leaves the region keeps updating via a single-aircraft
//    lookup on the same cadence.

import type { Map as MlMap } from 'maplibre-gl';
import { create } from 'zustand';
import { distanceNm } from '@shared/geo';
import { MAX_RADIUS_NM, normalizeRegion, regionKey } from '@shared/region';
import { api, ApiFailure } from '@/lib/api';
import { getSettings, useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui, useUI } from '@/state/ui';
import { cameraFlags } from '@/map/camera';
import { updateCoverage } from '@/map/overlays';

export type FeedStatus = 'connecting' | 'live' | 'degraded' | 'error' | 'paused';

interface FeedState {
  status: FeedStatus;
  message?: string;
  lastOkAt?: number;
  nextAt?: number;
  inFlight: boolean;
  requests: number;
  viewportClipped: boolean; // view is larger than the queryable radius
}

export const useFeed = create<FeedState>()(() => ({ status: 'connecting', inFlight: false, requests: 0, viewportClipped: false }));

const MIN_GAP_MS = 3000;

export function startFeed(map: MlMap): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let moveTimer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | null = null;
  let failures = 0;
  let lastFetchAt = 0;
  let lastKey = '';
  let stopped = false;

  const syncTunables = () => {
    const s = getSettings();
    traffic.expectedIntervalMs = s.pollIntervalSec * 1000;
    traffic.smooth = s.smoothMotion === 'interpolate' && s.motion !== 'off';
    traffic.trailMs = s.trailMinutes * 60_000;
    traffic.staleSec = s.staleAfterSec;
    traffic.lostSec = s.lostAfterSec;
    traffic.record = s.recordSession;
  };
  syncTunables();
  const unsubSettings = useSettings.subscribe(syncTunables);

  const syncPinned = () => {
    const u = ui();
    traffic.pinned = new Set([u.selectedId, ...u.compare].filter((x): x is string => !!x));
  };
  syncPinned();
  const unsubUI = useUI.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId || s.compare !== p.compare) syncPinned();
    if (s.following && !p.following) schedule(0);
  });

  function desiredRegion() {
    const u = ui();
    const followed = u.following && !u.followPaused ? traffic.get(u.selectedId) : undefined;
    const c = followed ? { lat: followed.ac.lat, lng: followed.ac.lon } : map.getCenter();
    const b = map.getBounds();
    let radius = Math.max(
      distanceNm(c.lat, c.lng, b.getNorth(), b.getEast()),
      distanceNm(c.lat, c.lng, b.getSouth(), b.getWest()),
    );
    if (!Number.isFinite(radius) || b.getEast() - b.getWest() >= 180) radius = MAX_RADIUS_NM * 2;
    useFeed.setState({ viewportClipped: radius > MAX_RADIUS_NM });
    return normalizeRegion(Math.max(-89, Math.min(89, c.lat)), ((((c.lng + 180) % 360) + 360) % 360) - 180, Math.min(radius, MAX_RADIUS_NM));
  }

  function schedule(delay: number) {
    clearTimeout(timer);
    if (stopped) return;
    const wait = Math.max(delay, lastFetchAt + MIN_GAP_MS - Date.now(), 0);
    useFeed.setState({ nextAt: Date.now() + wait });
    timer = setTimeout(() => void tick(), wait);
  }

  async function tick() {
    if (stopped) return;
    if (document.hidden) {
      useFeed.setState({ status: 'paused', message: 'Paused while this tab is in the background.' });
      return; // resumed by visibilitychange
    }
    // Polling continues during Timeline replay so live data stays current underneath.
    const region = desiredRegion();
    lastKey = regionKey(region);
    abort?.abort();
    abort = new AbortController();
    lastFetchAt = Date.now();
    useFeed.setState((s) => ({ inFlight: true, requests: s.requests + 1 }));
    try {
      const resp = await api.nearby(region.lat, region.lon, region.radiusNm, abort.signal);
      traffic.ingest(resp);
      updateCoverage(map);
      failures = 0;
      const degraded = resp.degraded ?? (resp.stale ? 'Showing an older shared snapshot.' : undefined);
      useFeed.setState({
        status: degraded ? 'degraded' : 'live',
        message: degraded,
        lastOkAt: Date.now(),
        inFlight: false,
      });
      await refreshPinned(abort.signal);
      schedule(getSettings().pollIntervalSec * 1000 + jitter());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      failures++;
      const retry = e instanceof ApiFailure && e.retryAfterSec ? e.retryAfterSec * 1000 : 0;
      const backoff = Math.min(120_000, getSettings().pollIntervalSec * 1000 * 2 ** Math.min(failures, 3));
      useFeed.setState({
        status: traffic.meta ? 'degraded' : 'error',
        message: e instanceof ApiFailure ? e.message : 'Live data is temporarily unavailable.',
        inFlight: false,
      });
      schedule(Math.max(retry, backoff));
    }
  }

  /** Selected/compared aircraft that are outside the polled region or dropped out. */
  async function refreshPinned(signal: AbortSignal) {
    for (const id of traffic.pinned) {
      const t = traffic.get(id);
      if (t && !t.outsideRegion && !t.lost) continue;
      if (id.startsWith('~')) continue;
      try {
        const r = await api.aircraft(id, false, signal);
        if (r.aircraft.length) traffic.ingestLookup(r.aircraft, r.providerNow, r.fetchedAt, r.servedAt);
      } catch {
        /* the panel shows tracking-lost state */
      }
    }
  }

  const jitter = () => Math.round(Math.random() * 1200);

  const onMoveEnd = () => {
    // Ambient globe rotation must never spend upstream requests.
    if (cameraFlags.autoRotating) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const key = regionKey(desiredRegion());
      if (key !== lastKey) schedule(0);
    }, 450);
  };
  map.on('moveend', onMoveEnd);

  const onVisibility = () => {
    if (!document.hidden) {
      useFeed.setState({ status: traffic.meta ? 'live' : 'connecting', message: undefined });
      schedule(Date.now() - lastFetchAt > 5000 ? 0 : 5000);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  schedule(0);

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(moveTimer);
    abort?.abort();
    map.off('moveend', onMoveEnd);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubSettings();
    unsubUI();
  };
}

/** One-off lookup used by deep links and search results. */
export async function lookupAndSelect(hex: string): Promise<boolean> {
  try {
    const r = await api.aircraft(hex);
    if (!r.aircraft.length) return false;
    traffic.ingestLookup(r.aircraft, r.providerNow, r.fetchedAt, r.servedAt);
    return true;
  } catch {
    return false;
  }
}
