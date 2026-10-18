import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/storage';
import type { MapStyleId } from './settings';

export interface SavedView {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zoom: number;
  bearing: number;
  pitch: number;
  style?: MapStyleId;
  createdAt: number;
}

export interface FavoriteAircraft {
  hex: string;
  label: string;
  type?: string;
  addedAt: number;
}

export interface Recent {
  kind: 'airport' | 'aircraft' | 'place' | 'coordinates' | 'country';
  id: string;
  label: string;
  sub?: string;
  lat?: number;
  lon?: number;
  zoom?: number;
  at: number;
}

interface BookmarkStore {
  airports: string[]; // idents
  aircraft: FavoriteAircraft[];
  views: SavedView[];
  recents: Recent[];
  /** Aircraft (hex) whose photos the user chose not to see. */
  hiddenPhotos: string[];
  toggleHiddenPhoto: (hex: string) => void;
  /** Airport whose live board is pinned to the map. */
  pinnedAirport: string | null;
  setPinnedAirport: (ident: string | null) => void;
  toggleAirport: (ident: string) => void;
  toggleAircraft: (a: Omit<FavoriteAircraft, 'addedAt'>) => void;
  saveView: (v: Omit<SavedView, 'id' | 'createdAt'>) => void;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
  addRecent: (r: Omit<Recent, 'at'>) => void;
  clearRecents: () => void;
}

export const useBookmarks = create<BookmarkStore>()(
  persist(
    (set) => ({
      airports: [],
      aircraft: [],
      views: [],
      recents: [],
      hiddenPhotos: [],
      pinnedAirport: null,
      setPinnedAirport: (ident) => set({ pinnedAirport: ident }),
      toggleHiddenPhoto: (hex) =>
        set((s) => ({
          hiddenPhotos: s.hiddenPhotos.includes(hex) ? s.hiddenPhotos.filter((x) => x !== hex) : [...s.hiddenPhotos, hex].slice(-500),
        })),
      toggleAirport: (ident) =>
        set((s) => ({
          airports: s.airports.includes(ident) ? s.airports.filter((x) => x !== ident) : [...s.airports, ident].slice(-100),
        })),
      toggleAircraft: (a) =>
        set((s) => ({
          aircraft: s.aircraft.some((x) => x.hex === a.hex)
            ? s.aircraft.filter((x) => x.hex !== a.hex)
            : [...s.aircraft, { ...a, addedAt: Date.now() }].slice(-100),
        })),
      saveView: (v) =>
        set((s) => ({
          views: [...s.views, { ...v, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() }].slice(-50),
        })),
      renameView: (id, name) => set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, name } : v)) })),
      deleteView: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
      addRecent: (r) =>
        set((s) => ({
          recents: [{ ...r, at: Date.now() }, ...s.recents.filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, 12),
        })),
      clearRecents: () => set({ recents: [] }),
    }),
    { name: 'bookmarks', version: 1, storage: createJSONStorage(() => safeStorage) },
  ),
);
