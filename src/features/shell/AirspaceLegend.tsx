// Compact on-map legend while the airspace layer is visible (zoom ≥ 6).
import { AnimatePresence, motion } from 'motion/react';
import { useSettings } from '@/state/settings';
import { useView } from '@/state/view';

const ITEMS: [string, string, string][] = [
  ['A', '#ff6b7d', 'solid'],
  ['B', '#4f8dff', 'solid'],
  ['C', '#d65cff', 'solid'],
  ['D', '#5aa9ff', 'dashed'],
  ['E', '#8fa3bd', 'dotted'],
  ['Danger', '#ffa94d', 'solid'],
  ['Restricted', '#ff5d73', 'solid'],
];

export function AirspaceLegend() {
  const on = useSettings((s) => s.showAirspace);
  const zoom = useView((s) => s.zoom);
  const show = on && zoom >= 5.5;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="glass pointer-events-auto absolute bottom-[64px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full px-3.5 py-1.5 text-[10.5px] text-fg-2"
          role="note"
          aria-label="Airspace legend"
        >
          <span className="font-semibold uppercase tracking-[0.12em] text-fg-3">Airspace</span>
          {ITEMS.map(([label, color, style]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="w-3.5 border-t-2" style={{ borderColor: color, borderStyle: style as 'solid' }} /> {label}
            </span>
          ))}
          <span className="text-fg-3">· tap an area for details</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
