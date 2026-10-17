import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { traffic, type Track } from '@/state/traffic';
import { useUI } from '@/state/ui';

/** Re-renders when the traffic engine ingests new data (≈ once per poll). */
export function useTrafficVersion(): number {
  return useSyncExternalStore(traffic.subscribe, traffic.getVersion, traffic.getVersion);
}

/** Current time, ticking at `ms` (for "x seconds ago" readouts). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useSelectedTrack(): Track | undefined {
  useTrafficVersion();
  const id = useUI((s) => s.selectedId);
  return traffic.get(id);
}

export function useTrack(id: string | null | undefined): Track | undefined {
  useTrafficVersion();
  return traffic.get(id);
}

/** Forces a re-render every animation frame while `active` (for live gauges). */
export function useFrame(active: boolean, fps = 30) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= 1000 / fps) {
        last = t;
        force();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, fps]);
}
