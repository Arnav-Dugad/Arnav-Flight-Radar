// Lightweight SVG charts following the Arnav viz spec: single-hue magnitude,
// ≤ 24 px bars with 4 px rounded data-ends, hairline grids, hover tooltips,
// text in text tokens (never the series colour).
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BarDatum {
  key: string;
  label: ReactNode;
  value: number;
  icon?: ReactNode;
  onClick?: () => void;
}

/** Horizontal bar list — magnitude per category, sorted by the caller. */
export function BarList({ data, total, color = 'var(--viz-1)', valueLabel }: { data: BarDatum[]; total?: number; color?: string; valueLabel?: (d: BarDatum) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const sum = total ?? data.reduce((a, d) => a + d.value, 0);
  return (
    <ul className="space-y-2">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const Inner = (
          <>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex min-w-0 items-center gap-1.5 text-fg-2">
                {d.icon}
                <span className="truncate">{d.label}</span>
              </span>
              <span className="tnum shrink-0 font-semibold text-fg">
                {valueLabel ? valueLabel(d) : d.value}
                <span className="ml-1.5 font-normal text-fg-3">{sum ? Math.round((d.value / sum) * 100) : 0}%</span>
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--viz-grid)]">
              <motion.div
                className="h-full rounded-r-[4px]"
                style={{ background: color }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: 'spring', stiffness: 160, damping: 24, delay: i * 0.025 }}
              />
            </div>
          </>
        );
        return (
          <li key={d.key}>
            {d.onClick ? (
              <button type="button" onClick={d.onClick} className="block w-full rounded-[8px] text-left hover:opacity-90">
                {Inner}
              </button>
            ) : (
              Inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical column histogram with per-column hover tooltip and value labels. */
export function Histogram({ data, height = 140, color = 'var(--viz-1)', caption }: { data: { label: string; value: number }[]; height?: number; color?: string; caption: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = height;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(24, slot * 0.62);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption} onPointerLeave={() => setHover(null)}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--viz-grid)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const top = y(d.value);
          const h = H - pad.b - top;
          const r = Math.min(4, h / 2);
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {d.value > 0 && (
                <motion.path
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: hover === null || hover === i ? 1 : 0.45, scaleY: 1 }}
                  transition={{ type: 'spring', stiffness: 160, damping: 22, delay: i * 0.03 }}
                  style={{ originY: `${H - pad.b}px` }}
                  d={`M${cx - bw / 2},${H - pad.b} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${H - pad.b} Z`}
                  fill={color}
                />
              )}
              <text x={cx} y={top - 5} textAnchor="middle" fontSize="10" fill="var(--fg-2)" className="tnum" fontWeight="600">
                {d.value}
              </text>
              <text x={cx} y={H - 7} textAnchor="middle" fontSize="9.5" fill="var(--fg-3)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{ left: `clamp(0px, calc(${((pad.l + slot * hover + slot / 2) / W) * 100}% - 50px), calc(100% - 110px))` }}
        >
          <div className="font-semibold text-fg">{data[hover]!.label}</div>
          <div className="tnum text-fg-2">{data[hover]!.value} aircraft</div>
        </div>
      )}
    </figure>
  );
}

/** Three-way split bar (legend + direct labels; 2 px surface gaps between segments). */
export function SplitBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-[6px]">
        {total === 0 ? (
          <div className="w-full bg-[var(--viz-grid)]" />
        ) : (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <motion.div
                key={p.key}
                title={`${p.label}: ${p.value}`}
                className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                style={{ background: p.color }}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: p.value }}
                transition={{ type: 'spring', stiffness: 140, damping: 22 }}
              />
            ))
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 text-fg-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            {p.label}
            <span className="tnum font-semibold text-fg">{p.value}</span>
            <span className="tnum text-fg-3">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small single-series sparkline with end-dot and hover readout. */
export function Sparkline({ values, times, height = 56, caption }: { values: number[]; times?: number[]; height?: number; caption: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = height;
  if (values.length < 2) return <p className="text-[12px] text-fg-3">Collecting samples… the trend appears after a few refreshes.</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => 4 + (i / (values.length - 1)) * (W - 8);
  const y = (v: number) => 6 + (1 - (v - min) / span) * (H - 12);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={caption}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * last));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d={`${d}L${x(last)},${H}L${x(0)},${H}Z`} fill="var(--viz-1)" opacity="0.1" />
        <path d={d} fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(hover ?? last)} cy={y(values[hover ?? last]!)} r="4" fill="var(--viz-1)" stroke="var(--surface-solid)" strokeWidth="2" />
      </svg>
      <div className={cn('tnum mt-1 flex justify-between text-[11px] text-fg-3')}>
        <span>
          {hover !== null ? `${values[hover]} aircraft` : `min ${min} · max ${max}`}
          {hover !== null && times?.[hover] ? ` · ${new Date(times[hover]!).toISOString().slice(11, 19)}Z` : ''}
        </span>
        <span>now {values[last]}</span>
      </div>
    </figure>
  );
}
