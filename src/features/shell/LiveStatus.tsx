// Header status: aircraft count + the simulation clock. Opens a small popover with
// the time controls (1×–30×) and a link to "About & data".
import { Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { SIM_SPEEDS, setSimSpeed, simNow, useSim } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { useUI } from '@/state/ui';

export function SimClockControls({ onAbout }: { onAbout?: () => void }) {
  const speed = useSim((s) => s.speed);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Clock speed</span>
        <span className="tnum text-[11px] text-fg-3">{speed === 1 ? 'Real time' : `${speed}× faster`}</span>
      </div>
      <div role="radiogroup" aria-label="Simulation speed" className="grid grid-cols-4 gap-1 rounded-[12px] bg-[var(--surface-2)] p-1">
        {SIM_SPEEDS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={speed === v}
            onClick={() => setSimSpeed(v)}
            className={cn(
              'tnum rounded-[9px] py-1.5 text-[12.5px] font-semibold transition-colors',
              speed === v ? 'bg-[var(--accent)] text-[#04101c] shadow-sm' : 'text-fg-2 hover:bg-[var(--line)] hover:text-fg',
            )}
          >
            {v}×
          </button>
        ))}
      </div>
      {onAbout && (
        <button type="button" onClick={onAbout} className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1 text-left text-[12px] text-fg-2 hover:text-fg">
          <Info size={14} /> About this simulated world &amp; its data
        </button>
      )}
    </div>
  );
}

export function LiveStatus({ compact = false }: { compact?: boolean }) {
  useNow(1000);
  const airborne = useSim((s) => s.airborne);
  const loading = useSim((s) => s.loading);
  const speed = useSim((s) => s.speed);
  const replay = useUI((s) => s.replay.active);
  const openPanel = useUI((s) => s.openPanel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const clock = new Date(simNow()).toISOString().slice(11, 16);
  const label = replay ? 'Replay' : 'Simulated';
  return (
    <div ref={ref} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.97 }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Simulated air traffic — clock and speed"
        aria-label={`${label} world. ${airborne} aircraft airborne. Simulated time ${clock} UTC${speed > 1 ? `, running ${speed} times faster` : ''}.`}
        className={cn(
          'glass-2 flex h-9 items-center gap-2 rounded-full pl-3 pr-3.5 text-[12px] font-medium text-fg-2 transition-colors hover:text-fg',
          compact && 'h-8 pl-2.5 pr-3',
        )}
      >
        <span className={cn('size-2 rounded-full bg-[#3ddc97] text-[#3ddc97]', !loading && 'pulse-dot')} />
        <span className="tnum font-semibold text-fg">
          {loading ? '—' : <AnimatedNumber value={airborne} />}
        </span>
        {!compact && <span>flying</span>}
        <span className="h-3.5 w-px bg-[var(--line-strong)]" />
        <span className="tnum text-fg">{clock}Z</span>
        {speed > 1 && <span className="tnum rounded-full bg-[var(--accent)] px-1.5 text-[10.5px] font-bold text-[#04101c]">{speed}×</span>}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-3">{compact ? (replay ? 'Replay' : 'Sim') : label}</span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Simulation clock"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            className="glass absolute left-0 top-[calc(100%+8px)] z-50 w-[260px] rounded-[18px] p-3"
          >
            <SimClockControls
              onAbout={() => {
                setOpen(false);
                openPanel('data');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
