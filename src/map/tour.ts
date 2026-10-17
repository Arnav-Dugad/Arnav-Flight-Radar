// Cinematic camera tours that outlive the panel that started them.
// Any user interaction with the map stops the tour.

import { create } from 'zustand';
import { HUBS, airportByCode, loadMajorAirports } from '@/data/airports';
import { getMap, motionMs } from './controller';

export const useTour = create<{ running: boolean; stop: string | null }>()(() => ({ running: false, stop: null }));

let timer: ReturnType<typeof setTimeout> | undefined;
let idx = 0;
let detach: (() => void) | null = null;

function step() {
  const m = getMap();
  if (!m) return stopTour();
  const h = HUBS[idx % HUBS.length]!;
  idx++;
  const a = airportByCode(h.ident);
  if (a) {
    useTour.setState({ stop: h.city });
    m.flyTo({ center: [a.lon, a.lat], zoom: 9.6, pitch: 55, bearing: (idx * 47) % 360, duration: motionMs(5200), curve: 1.8, essential: false });
  }
  timer = setTimeout(step, motionMs(5200) + 6500);
}

export async function startTour() {
  await loadMajorAirports();
  const m = getMap();
  if (!m) return;
  stopTour();
  useTour.setState({ running: true });
  const c = m.getCanvasContainer();
  const onUser = () => stopTour();
  c.addEventListener('pointerdown', onUser, { once: true });
  c.addEventListener('wheel', onUser, { once: true, passive: true });
  detach = () => {
    c.removeEventListener('pointerdown', onUser);
    c.removeEventListener('wheel', onUser);
  };
  step();
}

export function stopTour() {
  clearTimeout(timer);
  detach?.();
  detach = null;
  if (useTour.getState().running) useTour.setState({ running: false, stop: null });
}
