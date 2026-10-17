import { useMemo, useRef, useState } from 'react';
import { fmtAltitude, fmtSpeed, fmtTimeUTC } from '@/lib/format';
import { useSettings } from '@/state/settings';
import type { TrailPoint } from '@/state/traffic';

const W = 340;
const H = 120;
const PAD = { l: 34, r: 8, t: 10, b: 20 };

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

/** Altitude profile of OBSERVED positions; segments break at data gaps. */
export function TrailProfile({ points }: { points: TrailPoint[] }) {
  const units = useSettings((s) => s.units);
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => points.filter((p) => p.alt !== undefined), [points]);
  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const t0 = data[0]!.t;
    const t1 = data[data.length - 1]!.t;
    const maxAlt = Math.max(1000, ...data.map((p) => p.alt!));
    const niceMax = Math.ceil(maxAlt / 5000) * 5000;
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (a: number) => PAD.t + (1 - a / niceMax) * (H - PAD.t - PAD.b);
    // Build separate runs so a gap is never drawn as a line.
    const runs: TrailPoint[][] = [];
    for (const p of data) {
      if (p.gap || runs.length === 0) runs.push([p]);
      else runs[runs.length - 1]!.push(p);
    }
    const line = runs.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.alt!).toFixed(1)}`).join('')).join('');
    const area = runs
      .filter((r) => r.length > 1)
      .map((r) => `M${x(r[0]!.t)},${y(0)}${r.map((p) => `L${x(p.t).toFixed(1)},${y(p.alt!).toFixed(1)}`).join('')}L${x(r[r.length - 1]!.t)},${y(0)}Z`)
      .join('');
    return { x, y, line, area, niceMax, t0, t1 };
  }, [data]);

  if (!geom) {
    return (
      <div className="glass-2 grid h-[120px] place-items-center rounded-[16px] px-6 text-center text-[12px] text-fg-3">
        The altitude profile appears after a few position reports have been observed.
      </div>
    );
  }

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    data.forEach((p, i) => {
      const d = Math.abs(geom.x(p.t) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? data[hover] : null;
  const ticks = [0, geom.niceMax / 2, geom.niceMax];

  return (
    <figure className="glass-2 relative rounded-[16px] p-2">
      <figcaption className="eyebrow px-1.5 pb-1">Altitude profile (observed)</figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Altitude profile from ${data.length} observed positions`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geom.y(t)} y2={geom.y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={PAD.l - 6} y={geom.y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--fg-3)" className="tnum">
              {compact(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 4} fontSize="9.5" fill="var(--fg-3)" className="tnum">
          {fmtTimeUTC(geom.t0)}
        </text>
        <text x={W - PAD.r} y={H - 4} fontSize="9.5" fill="var(--fg-3)" textAnchor="end" className="tnum">
          {fmtTimeUTC(geom.t1)}
        </text>
        <path d={geom.area} fill="var(--viz-1)" opacity="0.1" />
        <path d={geom.line} fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <g>
            <line x1={geom.x(hp.t)} x2={geom.x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--fg-3)" strokeWidth="1" />
            <circle cx={geom.x(hp.t)} cy={geom.y(hp.alt!)} r="4" fill="var(--viz-1)" stroke="var(--surface-solid)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{ left: `clamp(8px, calc(${(geom.x(hp.t) / W) * 100}% - 60px), calc(100% - 140px))` }}
        >
          <div className="tnum font-semibold text-fg">{fmtAltitude(hp.alt, units.altitude, hp.alt === 0)}</div>
          <div className="tnum text-fg-3">
            {fmtTimeUTC(hp.t)}
            {hp.gs !== undefined && ` · ${fmtSpeed(hp.gs, units.speed)}`}
          </div>
        </div>
      )}
    </figure>
  );
}
