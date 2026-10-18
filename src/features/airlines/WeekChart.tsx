// Routes operated per day of the week (Monday first): stacked thin columns, daily routes at
// the base and routes flown on some days on top, one count axis, direct labels on the busiest
// and quietest day, per-day tooltips and a table view.
import { useId, useState } from 'react';
import { WEEKDAYS } from '@/data/sim/schedule';
import { cn } from '@/lib/cn';

export interface DayCount {
  day: number; // 0 = Sunday
  daily: number;
  some: number;
}

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function WeekChart({ data, today }: { data: DayCount[]; today?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();
  const W = 340;
  const H = 150;
  const pad = { l: 28, r: 6, t: 18, b: 30 };
  const totals = data.map((d) => d.daily + d.some);
  const maxV = Math.max(1, ...totals);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => maxV / s <= 4) ?? 1000;
  const top = Math.ceil(maxV / step) * step;
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(22, slot * 0.5);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const hi = totals.indexOf(Math.max(...totals));
  const lo = totals.indexOf(Math.min(...totals));
  const labelled = new Set(hi === lo ? [hi] : [hi, lo]);
  const summary = data.map((d) => `${WEEKDAYS[d.day]} ${d.daily + d.some}`).join(', ');

  const bar = (x: number, y0: number, y1: number, round: boolean) => {
    const h = Math.max(0, y0 - y1);
    if (h <= 0) return '';
    const r = round ? Math.min(4, h / 2, bw / 2) : 0;
    return `M${x - bw / 2},${y0} V${y1 + r} Q${x - bw / 2},${y1} ${x - bw / 2 + r},${y1} H${x + bw / 2 - r} Q${x + bw / 2},${y1} ${x + bw / 2},${y1 + r} V${y0} Z`;
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--viz-1)]" /> Daily routes
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--viz-2)]" /> Some days only
          </li>
        </ul>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
          className={cn('h-7 rounded-full border px-3 text-[11px] font-medium', table ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3 hover:text-fg-2')}
        >
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {table ? (
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Routes operated per day of the week</caption>
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-[10.5px] uppercase tracking-[0.08em] text-fg-3">
              <th scope="col" className="pb-1 text-left font-medium">
                Day
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Daily
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Some days
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-b border-[var(--line)] last:border-b-0">
                <th scope="row" className="py-1.5 text-left font-normal text-fg-2">
                  {DAY_FULL[d.day]}
                  {d.day === today && <span className="ml-1.5 text-[10.5px] text-fg-3">today</span>}
                </th>
                <td className="tnum py-1.5 text-right text-fg">{d.daily}</td>
                <td className="tnum py-1.5 text-right text-fg">{d.some}</td>
                <td className="tnum py-1.5 text-right font-semibold text-fg">{d.daily + d.some}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <figure className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="group" aria-labelledby={titleId} onPointerLeave={() => setHover(null)}>
            <title id={titleId}>Routes operated per day of the week: {summary}</title>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" />
                <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--fg-3)" className="tnum">
                  {v}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + slot * i + slot / 2;
              const base = y(0);
              const yd = y(d.daily);
              const yt = y(d.daily + d.some);
              const gap = d.daily > 0 && d.some > 0 ? 2 : 0;
              const dim = hover !== null && hover !== i;
              return (
                <g
                  key={d.day}
                  tabIndex={0}
                  role="img"
                  aria-label={`${DAY_FULL[d.day]}: ${d.daily + d.some} routes, ${d.daily} daily and ${d.some} on some days`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none focus-visible:[&>rect]:stroke-[var(--accent)]"
                >
                  <rect x={cx - slot / 2 + 1} y={pad.t - 4} width={slot - 2} height={H - pad.t - pad.b + 4} rx="6" fill="transparent" stroke="transparent" strokeWidth="1.5" />
                  <path d={bar(cx, base, yd, d.some === 0)} fill="var(--viz-1)" opacity={dim ? 0.45 : 1} />
                  <path d={bar(cx, yd - gap, yt, true)} fill="var(--viz-2)" opacity={dim ? 0.45 : 1} />
                  {(labelled.has(i) || hover === i) && (
                    <text x={cx} y={yt - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--fg-2)" className="tnum">
                      {d.daily + d.some}
                    </text>
                  )}
                  <text x={cx} y={H - pad.b + 13} textAnchor="middle" fontSize="10" fill={d.day === today ? 'var(--fg)' : 'var(--fg-3)'} fontWeight={d.day === today ? 600 : 400}>
                    {WEEKDAYS[d.day]}
                  </text>
                  {d.day === today && (
                    <text x={cx} y={H - pad.b + 25} textAnchor="middle" fontSize="8.5" fill="var(--fg-3)">
                      today
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-[130px] rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] shadow-xl"
              style={{ left: `clamp(0px, calc(${((pad.l + slot * hover + slot / 2) / W) * 100}% - 65px), calc(100% - 130px))` }}
            >
              <div className="font-semibold text-fg">{DAY_FULL[data[hover]!.day]}</div>
              <div className="tnum text-fg-2">{data[hover]!.daily + data[hover]!.some} routes</div>
              <div className="tnum text-fg-3">
                {data[hover]!.daily} daily · {data[hover]!.some} some days
              </div>
            </div>
          )}
        </figure>
      )}
    </div>
  );
}
