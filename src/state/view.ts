import { create } from 'zustand';

/** Camera state mirrored from MapLibre (throttled to animation frames). */
export interface ViewState {
  zoom: number;
  bearing: number;
  pitch: number;
  lat: number;
  lon: number;
  ready: boolean;
}

export const useView = create<ViewState>()(() => ({ zoom: 0, bearing: 0, pitch: 0, lat: 0, lon: 0, ready: false }));
