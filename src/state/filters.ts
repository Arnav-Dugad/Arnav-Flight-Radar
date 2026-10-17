import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { EMPTY_FILTERS, type Filters } from '@/lib/filters';
import { safeStorage } from '@/lib/storage';

interface FilterStore {
  filters: Filters;
  /** When true, non-matching aircraft are dimmed instead of hidden. */
  highlightMode: boolean;
  presets: { name: string; filters: Filters }[];
  update: (patch: Partial<Filters>) => void;
  clear: () => void;
  setHighlightMode: (on: boolean) => void;
  savePreset: (name: string) => void;
  applyPreset: (name: string) => void;
  deletePreset: (name: string) => void;
}

export const useFilters = create<FilterStore>()(
  persist(
    (set, get) => ({
      filters: EMPTY_FILTERS,
      highlightMode: false,
      presets: [],
      update: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      clear: () => set({ filters: EMPTY_FILTERS }),
      setHighlightMode: (highlightMode) => set({ highlightMode }),
      savePreset: (name) => {
        const n = name.trim().slice(0, 40);
        if (!n) return;
        set((s) => ({ presets: [...s.presets.filter((p) => p.name !== n), { name: n, filters: get().filters }].slice(-20) }));
      },
      applyPreset: (name) => {
        const p = get().presets.find((x) => x.name === name);
        if (p) set({ filters: { ...EMPTY_FILTERS, ...p.filters } });
      },
      deletePreset: (name) => set((s) => ({ presets: s.presets.filter((p) => p.name !== name) })),
    }),
    {
      name: 'filters',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ presets: s.presets, highlightMode: s.highlightMode }),
    },
  ),
);
