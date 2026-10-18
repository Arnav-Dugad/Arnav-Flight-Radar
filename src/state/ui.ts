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
  | 'spotter'
  | 'credits'
  | 'airline'
  | 'widgets'
  | 'type'
  | 'airportCompare';

export type Projection = 'mercator' | 'globe';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

/** A destination of the airport-panel route map ([lon, lat] like GeoJSON). */
export interface AirportOverlayDest {
  ident: string;
  code: string;
  name: string;
  lon: number;
  lat: number;
  perWeek: number;
}

/** A point of a procedure drawn from the airport panel. */
export interface AirportOverlayFix {
  ident: string;
  lon: number;
  lat: number;
  /** Altitude constraint label, e.g. "↑5000" or "FL110". */
  alt?: string;
}

/**
 * What the airport panel asks the map to draw (src/map/airportRoutesOverlay.ts): the
 * simulated route network from an airport, or one departure/arrival procedure.
 */
export type AirportOverlay = (
  | { kind: 'routes'; airport: string; origin: [number, number]; dests: AirportOverlayDest[]; focus?: string | null }
  | { kind: 'procedure'; airport: string; origin: [number, number]; name: string; proc: 'sid' | 'star'; fixes: AirportOverlayFix[]; published: boolean }
) & {
  /** The map frames the overlay whenever this token changes (not on every data refresh). */
  fit?: string;
};

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
  /** ICAO code of the airline shown in the airline panel. */
  selectedAirline: string | null;
  /** ICAO type designator shown in the aircraft-type panel. */
  selectedType: string | null;
  /** Airports (ICAO idents, up to four) in the airport comparison panel. */
  compareAirports: string[];
  following: boolean;
  /** 3D chase view: low, tilted, heading-up camera behind the followed aircraft. */
  chase: boolean;
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
  /** Route network or procedure the airport panel draws on the map (null = nothing). */
  airportOverlay: AirportOverlay | null;

  openPanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  select: (id: string | null, opts?: { follow?: boolean }) => void;
  setHovered: (id: string | null) => void;
  setHoverPoint: (p: { x: number; y: number } | null) => void;
  announce: (msg: string) => void;
  selectAirport: (ident: string | null) => void;
  selectAirline: (icao: string | null) => void;
  selectType: (code: string | null) => void;
  setCompareAirports: (idents: string[]) => void;
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
  setAirportOverlay: (o: AirportOverlay | null) => void;
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
  selectedAirline: null,
  selectedType: null,
  compareAirports: [],
  following: false,
  chase: false,
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
  airportOverlay: null,

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
  selectAirline: (icao) => {
    if (icao) {
      get().openPanel('airline');
      set({ selectedAirline: icao, sheet: 'half' });
    } else set({ selectedAirline: null });
  },
  setCompareAirports: (idents) => set({ compareAirports: [...new Set(idents)].slice(0, 4) }),
  selectType: (code) => {
    if (code) {
      get().openPanel('type');
      set({ selectedType: code, sheet: 'half' });
    } else set({ selectedType: null });
  },
  setFollowing: (on) => set({ following: on, followPaused: false, ...(on ? {} : { chase: false }) }),
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
  setAirportOverlay: (airportOverlay) => set({ airportOverlay }),
}));

export const ui = () => useUI.getState();
