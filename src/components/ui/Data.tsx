import { Check, Copy } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { NA } from '@/lib/format';

/** Label/value row for telemetry tables. Missing values render "Not available". */
export function Row({ label, value, hint, mono, copy }: { label: ReactNode; value: ReactNode | undefined; hint?: string; mono?: boolean; copy?: string }) {
  const missing = value === undefined || value === null || value === '';
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] py-2 last:border-b-0" title={hint}>
      <dt className="shrink-0 text-[12px] text-fg-3">{label}</dt>
      <dd className={cn('flex min-w-0 items-center gap-1.5 text-right text-[12.5px] font-medium', missing ? 'text-fg-3' : 'text-fg', mono && 'tnum')}>
        <span className="truncate">{missing ? NA : value}</span>
        {copy && !missing && <CopyButton text={copy} label={`Copy ${typeof label === 'string' ? label : 'value'}`} />}
      </dd>
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="glass-2 rounded-[16px] px-3.5 py-1">{children}</dl>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="grid size-6 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-[var(--line)] hover:text-fg"
    >
      {done ? <Check size={13} className="text-[#57e3a6]" /> : <Copy size={12.5} />}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  const id = useId();
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-[var(--line)]">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn('relative px-3 pb-2.5 pt-1.5 text-[12.5px] font-medium transition-colors', active ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
          >
            {t.label}
            {active && (
              <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('glass-2 rounded-[16px] p-3', className)}>
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-1.5 text-[20px] font-semibold leading-none tracking-[-0.02em] text-fg">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-fg-3">{sub}</div>}
    </div>
  );
}
