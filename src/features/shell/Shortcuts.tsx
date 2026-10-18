import { useEffect } from 'react';
import { create } from 'zustand';
import { Kbd } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Sheet';
import { followRandomFlight, resetNorth, setProjection, startFollow, stopFollow, zoomBy } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import { setSimSpeed } from '@/data/world';

const toggle = (key: 'showDayNight' | 'showAirspace' | 'showDisruptions') => useSettings.getState().set(key, !useSettings.getState()[key]);
import { cycleAircraft } from './cycle';

export const useShortcutsModal = create<{ open: boolean; setOpen: (o: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const LIST: [string[], string][] = [
  [[isMac ? '⌘' : 'Ctrl', 'K'], 'Search'],
  [['/'], 'Search'],
  [['Esc'], 'Close / deselect / exit mode'],
  [['C'], 'Follow or stop following the selected aircraft'],
  [['[', ']'], 'Previous / next aircraft in view'],
  [['J'], 'Jump to and follow a random flight'],
  [['X'], '3D view behind the selected aircraft'],
  [['1', '2', '3', '4'], 'Clock speed 1× / 5× / 15× / 30×'],
  [['W'], 'Right now: busiest airports & disruptions'],
  [['D'], 'Day & night shading'],
  [['U'], 'Controlled airspace'],
  [['K'], 'Airport disruption map'],
  [['V'], 'Vertical profile'],
  [['R'], 'Range rings'],
  [['F'], 'Filters'],
  [['L'], 'Map styles & layers'],
  [['A'], 'Analytics'],
  [['B'], 'Bookmarks'],
  [['T'], 'Timeline replay'],
  [['M'], 'Measure distance'],
  [['G'], 'Toggle globe'],
  [['N'], 'Reset north & tilt'],
  [['P'], 'Presentation mode'],
  [['+', '−'], 'Zoom'],
  [[','], 'Settings'],
  [['?'], 'This list'],
];

export function ShortcutsModal() {
  const open = useShortcutsModal((s) => s.open);
  const setOpen = useShortcutsModal((s) => s.setOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={520}>
      <ul className="grid grid-cols-1 gap-x-6 px-5 py-3 sm:grid-cols-2">
        {LIST.map(([keys, label]) => (
          <li key={label + keys.join()} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2 text-[12.5px] last:border-b-0">
            <span className="text-fg-2">{label}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setSearchOpen(!ui.searchOpen);
        return;
      }
      if (e.key === 'Escape') {
        if (ui.searchOpen || useShortcutsModal.getState().open) return; // dialogs handle their own Esc
        if (ui.presentation) return ui.setPresentation(false);
        if (ui.measure.active) return ui.setMeasure({ active: false, points: [] });
        if (ui.panel === 'aircraft') return ui.select(null);
        if (ui.panel === 'airport') return ui.selectAirport(null);
        if (ui.panel) return ui.openPanel(null);
        if (ui.selectedId) return ui.select(null);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ui.searchOpen || useShortcutsModal.getState().open) return;
      const k = e.key;
      const map: Record<string, () => void> = {
        '/': () => ui.setSearchOpen(true),
        f: () => ui.togglePanel('filters'),
        l: () => ui.togglePanel('layers'),
        a: () => ui.togglePanel('analytics'),
        b: () => ui.togglePanel('bookmarks'),
        t: () => ui.togglePanel('timeline'),
        ',': () => ui.togglePanel('settings'),
        m: () => ui.setMeasure({ active: !ui.measure.active, points: [] }),
        g: () => setProjection(ui.projection === 'globe' ? 'mercator' : 'globe'),
        n: () => resetNorth(),
        p: () => ui.setPresentation(!ui.presentation),
        '?': () => useShortcutsModal.getState().setOpen(true),
        c: () => {
          if (!ui.selectedId) return;
          if (ui.following && !ui.followPaused) stopFollow();
          else startFollow(ui.selectedId);
        },
        j: () => void followRandomFlight(),
        x: () => {
          if (!ui.selectedId) return;
          if (ui.chase) stopFollow();
          else startFollow(ui.selectedId, { chase: true });
        },
        '1': () => setSimSpeed(1),
        '2': () => setSimSpeed(5),
        '3': () => setSimSpeed(15),
        '4': () => setSimSpeed(30),
        w: () => ui.togglePanel('widgets'),
        d: () => toggle('showDayNight'),
        u: () => toggle('showAirspace'),
        k: () => toggle('showDisruptions'),
        '[': () => cycleAircraft(-1),
        ']': () => cycleAircraft(1),
        v: () => useSettings.getState().set('showProfile', !useSettings.getState().showProfile),
        r: () => useSettings.getState().set('showRangeRings', !useSettings.getState().showRangeRings),
        '+': () => zoomBy(1),
        '=': () => zoomBy(1),
        '-': () => zoomBy(-1),
      };
      const fn = map[k.length === 1 ? k.toLowerCase() : k] ?? map[k];
      if (fn) {
        // Map canvas handles +/- itself when focused.
        if ((k === '+' || k === '-' || k === '=') && (e.target as HTMLElement)?.classList?.contains('maplibregl-canvas')) return;
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
