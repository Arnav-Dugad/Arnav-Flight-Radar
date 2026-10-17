import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AltitudeUnit, DistanceUnit, SpeedUnit, TemperatureUnit, VerticalRateUnit } from '@shared/units';
import { safeStorage } from '@/lib/storage';

export type MapStyleId = 'obsidian' | 'arctic' | 'midnight' | 'terrain' | 'minimal' | 'satellite';
export type Appearance = 'system' | 'dark' | 'light';
export type ColorMode = 'altitude' | 'speed' | 'vertical' | 'freshness' | 'mono';
export type AltitudePalette = 'aurora' | 'accessible';
export type MotionLevel = 'full' | 'reduced' | 'off';
export type LabelDensity = 'none' | 'low' | 'normal' | 'high';
export type CameraMode = 'north-up' | 'heading-up';
export type TrailColorMode = 'altitude' | 'speed' | 'vertical' | 'time';
export type SmoothMotion = 'interpolate' | 'off';

export interface Settings {
  appearance: Appearance;
  mapStyle: MapStyleId;
  units: {
    altitude: AltitudeUnit;
    speed: SpeedUnit;
    distance: DistanceUnit;
    temperature: TemperatureUnit;
    verticalRate: VerticalRateUnit;
  };
  colorMode: ColorMode;
  altitudePalette: AltitudePalette;
  symbolScale: number; // 0.7 – 1.6
  labelDensity: LabelDensity;
  motion: MotionLevel;
  reducedEffects: boolean;
  smoothMotion: SmoothMotion;
  pollIntervalSec: number; // 10 – 60
  trailMinutes: number; // trail length kept per aircraft
  trailColorMode: TrailColorMode;
  showAllTrails: boolean;
  cameraMode: CameraMode;
  followZoom: number;
  followPitch: number;
  globeAutoRotate: boolean;
  radarSweep: boolean;
  showAirports: boolean;
  showWeather: boolean;
  showCoverage: boolean;
  showHeatmap: boolean;
  terrain3d: boolean;
  defaultView: { lat: number; lon: number; zoom: number } | null;
  rememberLastView: boolean;
  staleAfterSec: number; // client-side "stale" threshold
  lostAfterSec: number; // drop aircraft missing from results after this
  recordSession: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'dark',
  mapStyle: 'obsidian',
  units: { altitude: 'ft', speed: 'kt', distance: 'nm', temperature: 'c', verticalRate: 'fpm' },
  colorMode: 'altitude',
  altitudePalette: 'aurora',
  symbolScale: 1,
  labelDensity: 'normal',
  motion: 'full',
  reducedEffects: false,
  smoothMotion: 'interpolate',
  pollIntervalSec: 15,
  trailMinutes: 20,
  trailColorMode: 'altitude',
  showAllTrails: false,
  cameraMode: 'north-up',
  followZoom: 9.5,
  followPitch: 45,
  globeAutoRotate: true,
  radarSweep: false,
  showAirports: true,
  showWeather: false,
  showCoverage: true,
  showHeatmap: false,
  terrain3d: false,
  defaultView: null,
  rememberLastView: true,
  staleAfterSec: 45,
  lostAfterSec: 90,
  recordSession: true,
};

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setUnit: <K extends keyof Settings['units']>(key: K, value: Settings['units'][K]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      setUnit: (key, value) => set((s) => ({ units: { ...s.units, [key]: value } })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => {
        const { set: _a, setUnit: _b, reset: _c, ...rest } = s;
        void _a;
        void _b;
        void _c;
        return rest;
      },
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<Settings>) }),
    },
  ),
);

export const getSettings = () => useSettings.getState();
