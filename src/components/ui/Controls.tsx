import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------- SegmentedControl
// A "liquid" indicator slides between options using a shared layoutId.

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Segment<T>[];
  size?: 'sm' | 'md';
  className?: string;
  label: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('glass-2 relative flex rounded-[12px] p-[3px]', size === 'sm' ? 'h-8' : 'h-9', className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 font-medium transition-colors duration-200',
              size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-[1] rounded-[9px] bg-[var(--surface-solid)] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_2px_10px_-2px_rgba(0,0,0,0.35)] ring-1 ring-[var(--line-strong)]"
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Toggle

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13px] font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-[11.5px] leading-snug text-fg-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-[24px] w-[42px] shrink-0 rounded-full border transition-colors duration-300',
          checked ? 'border-transparent bg-[var(--accent)]' : 'border-[var(--line-strong)] bg-[var(--line)]',
        )}
      >
        <motion.span
          className="absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
          animate={{ left: checked ? 20 : 2 }}
          transition={{ type: 'spring', stiffness: 700, damping: 34 }}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Sliders

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-medium text-fg-2">{label}</span>
        <span className="tnum text-fg">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="arnav-range w-full"
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </div>
  );
}

/** Two-thumb range built from two overlaid native range inputs (keyboard accessible). */
export function RangeSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: [number, number];
  onChange: (v: [number, number]) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  const [lo, hi] = value;
  const a = ((lo - min) / (max - min)) * 100;
  const b = ((hi - min) / (max - min)) * 100;
  const f = format ?? String;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-medium text-fg-2">{label}</span>
        <span className="tnum text-fg">
          {f(lo)} – {f(hi)}
        </span>
      </div>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[var(--line-strong)]" />
        <div
          className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[var(--accent)]"
          style={{ left: `${a}%`, right: `${100 - b}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={`${label} minimum`}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi - step), hi])}
          className="arnav-range-dual absolute inset-0 w-full"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label={`${label} maximum`}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + step)])}
          className="arnav-range-dual absolute inset-0 w-full"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Chip

export function Chip({
  active,
  onClick,
  children,
  icon,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <motion.button
      type="button"
      layout
      title={title}
      aria-pressed={active}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors duration-200',
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]'
          : 'border-[var(--line)] bg-[var(--line)] text-fg-2 hover:border-[var(--line-strong)] hover:text-fg',
      )}
    >
      {icon}
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------- TextField

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  icon,
  maxLength = 40,
  inputMode,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  icon?: ReactNode;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'search';
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-fg-2">
        {label}
      </label>
      <div className="glass-2 flex h-9 items-center gap-2 rounded-[11px] px-3 focus-within:border-[var(--line-strong)]">
        {icon && <span className="text-fg-3">{icon}</span>}
        <input
          id={id}
          value={value}
          maxLength={maxLength}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </div>
    </div>
  );
}
