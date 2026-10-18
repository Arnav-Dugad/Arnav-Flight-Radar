import { create } from 'zustand';

export type PanelId =
  | 'aircraft'
  | 'airport'
  | 'airports'
  | 'filters'
  | 'analytics'
  | 'layers'
  | 'settings'
  | 'bookmarks'
  | 'discover'
  | 'compare'
  | 'inspector'
  | 'data'
  | 'timeline'
  | 'spotter';

export type Projection = 'mercator' | 'globe';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

interface UIState {
  panel: PanelId | null;
  /** Panel to return to when the aircraft/airport detail closes. */
  previousPanel: PanelId | null;
  selectedId: string | null;
  hoveredId: string | null;
  /** Screen position of the hovered aircraft (for the hover card). */
  hoverPoint: { x: number; y: number } | null;
  /** Polite screen-reader announcement. */
  announcement: string;
  selectedAirport: string | null;
  following: boolean;
  followPaused: boolean;
  searchOpen: boolean;
  projection: Projection;
  presentation: boolean;
  compare: [string | null, string | null];
  replay: { active: boolean; index: number; playing: boolean };
  measure: { active: boolean; points: [number, number][] };
  spotterAirport: string | null;
  sheet: 'peek' | 'half' | 'full';
  toasts: Toast[];
  cursor: { lat: number; lon: number } | null;
  styleLoading: boolean;

  openPanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  select: (id: string | null, opts?: { follow?: boolean }) => void;
  setHovered: (id: string | null) => void;
  setHoverPoint: (p: { x: number; y: number } | null) => void;
  announce: (msg: string) => void;
  selectAirport: (ident: string | null) => void;
  setFollowing: (on: boolean) => void;
  setFollowPaused: (on: boolean) => void;
  setSearchOpen: (on: boolean) => void;
  setProjection: (p: Projection) => void;
  setPresentation: (on: boolean) => void;
  setCompare: (slot: 0 | 1, id: string | null) => void;
  setReplay: (r: Partial<UIState['replay']>) => void;
  setMeasure: (m: Partial<UIState['measure']>) => void;
  setSpotter: (ident: string | null) => void;
  setSheet: (s: UIState['sheet']) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setCursor: (c: UIState['cursor']) => void;
  setStyleLoading: (on: boolean) => void;
}

let toastId = 0;

export const useUI = create<UIState>()((set, get) => ({
  panel: null,
  previousPanel: null,
  selectedId: null,
  hoveredId: null,
  hoverPoint: null,
  announcement: '',
  selectedAirport: null,
  following: false,
  followPaused: false,
  searchOpen: false,
  projection: 'mercator',
  presentation: false,
  compare: [null, null],
  replay: { active: false, index: 0, playing: false },
  measure: { active: false, points: [] },
  spotterAirport: null,
  sheet: 'half',
  toasts: [],
  cursor: null,
  styleLoading: false,

  openPanel: (p) =>
    set((s) => ({
      panel: p,
      previousPanel: p === 'aircraft' || p === 'airport' ? (s.panel !== 'aircraft' && s.panel !== 'airport' ? s.panel : s.previousPanel) : null,
    })),
  togglePanel: (p) => {
    const s = get();
    if (s.panel === p) set({ panel: null });
    else s.openPanel(p);
  },
  select: (id, opts) => {
    const s = get();
    if (id === null) {
      set({
        selectedId: null,
        following: false,
        followPaused: false,
        panel: s.panel === 'aircraft' ? s.previousPanel : s.panel,
      });
      return;
    }
    s.openPanel('aircraft');
    set({ selectedId: id, following: opts?.follow ?? (s.following && s.selectedId === id), followPaused: false, sheet: 'half' });
  },
  setHovered: (id) => set({ hoveredId: id }),
  setHoverPoint: (hoverPoint) => set({ hoverPoint }),
  announce: (msg) => {
    // Clear first so repeating the same text is still announced.
    set({ announcement: '' });
    setTimeout(() => set({ announcement: msg }), 30);
  },
  selectAirport: (ident) => {
    const s = get();
    if (ident === null) {
      set({ selectedAirport: null, panel: s.panel === 'airport' ? s.previousPanel : s.panel });
      return;
    }
    s.openPanel('airport');
    set({ selectedAirport: ident, sheet: 'half' });
  },
  setFollowing: (on) => set({ following: on, followPaused: false }),
  setFollowPaused: (on) => set({ followPaused: on }),
  setSearchOpen: (on) => set({ searchOpen: on }),
  setProjection: (p) => set({ projection: p }),
  setPresentation: (on) => set({ presentation: on }),
  setCompare: (slot, id) =>
    set((s) => {
      const c: [string | null, string | null] = [...s.compare];
      c[slot] = id;
      return { compare: c };
    }),
  setReplay: (r) => set((s) => ({ replay: { ...s.replay, ...r } })),
  setMeasure: (m) => set((s) => ({ measure: { ...s.measure, ...m } })),
  setSpotter: (ident) => set({ spotterAirport: ident }),
  setSheet: (sheet) => set({ sheet }),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.action ? 12000 : t.kind === 'error' ? 7000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setCursor: (cursor) => set({ cursor }),
  setStyleLoading: (styleLoading) => set({ styleLoading }),
}));

export const ui = () => useUI.getState();
