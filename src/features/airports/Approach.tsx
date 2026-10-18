import { useMemo } from 'react';
import { approachTargets, runwayEnds, type ApproachTarget } from '@shared/approach';
import type { AirportDetail } from '@shared/types';
import { fmtAltitude, fmtDistance } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

const W = 340;
const H = 132;
const P = { l: 34, r: 14, t: 12, b: 22 };
const MAX_NM = 15;
const MAX_FT = 5000;

function ApproachChart({ runway, targets }: { runway: string; targets: ApproachTarget[] }) {
  const units = useSettings((s) => s.units);
  const select = useUI((s) => s.select);
  // Threshold on the right, aircraft approach from the left.
  const x = (nm: number) => P.l + (1 - Math.min(nm, MAX_NM) / MAX_NM) * (W - P.l - P.r);
  const y = (ft: number) => P.t + (1 - Math.min(Math.max(ft, 0), MAX_FT) / MAX_FT) * (H - P.t - P.b);
  const glide = (nm: number) => Math.tan((3 * Math.PI) / 180) * nm * 6076.12;
  return (
    <figure className="glass-2 rounded-[16px] p-2.5">
      <figcaption className="flex items-center justify-between px-1 pb-1">
        <span className="text-[12.5px] font-semibold text-fg">Approach to {runway}</span>
        <span className="text-[10.5px] text-fg-3">{targets.length} observed · dashed = 3° reference</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Observed aircraft approaching runway ${runway} by distance and height`}>
        {[0, 2500, 5000].map((ft) => (
          <g key={ft}>
            <line x1={P.l} x2={W - P.r} y1={y(ft)} y2={y(ft)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={P.l - 5} y={y(ft) + 3.5} textAnchor="end" fontSize="9" fill="var(--fg-3)" className="tnum">
              {ft === 0 ? '0' : `${ft / 1000}k`}
            </text>
          </g>
        ))}
        {[15, 10, 5, 0].map((nm) => (
          <text key={nm} x={x(nm)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--fg-3)" className="tnum">
            {nm === 0 ? 'THR' : `${nm} NM`}
          </text>
        ))}
        <line x1={x(MAX_NM)} y1={y(glide(MAX_NM))} x2={x(0)} y2={y(0)} stroke="var(--fg-3)" strokeWidth="1" strokeDasharray="4 3" />
        {targets.map((t) => (
          <g key={t.id} transform={`translate(${x(t.distNm)} ${y(t.heightFt)})`} className="cursor-pointer" onClick={() => {
            select(t.id);
            focusAircraft(t.id);
          }}>
            <circle r="9" fill="transparent" />
            <circle r="4.5" fill="var(--viz-1)" stroke="var(--surface-solid)" strokeWidth="2" />
            <text y={-8} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--fg)">
              {t.label}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-1 space-y-0.5 px-1">
        {targets.map((t) => (
          <li key={t.id} className="tnum flex justify-between text-[11px] text-fg-2">
            <span className="font-semibold text-fg">{t.label}</span>
            <span>
              {fmtDistance(t.distNm, units.distance)} · {fmtAltitude(Math.round(t.heightFt / 10) * 10, units.altitude === 'fl' ? 'ft' : units.altitude)} above threshold · {t.angleDeg.toFixed(1)}°
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function ApproachExplorer({ a }: { a: AirportDetail }) {
  useTrafficVersion();
  const ends = useMemo(() => runwayEnds(a.runways), [a.runways]);
  const targets = approachTargets(ends, a.elevationFt, traffic.current());
  const byRunway = new Map<string, ApproachTarget[]>();
  for (const t of targets) byRunway.set(t.runway, [...(byRunway.get(t.runway) ?? []), t]);
  if (!ends.length) return null;
  return (
    <section className="space-y-2.5">
      <h3 className="eyebrow">Approach explorer</h3>
      {byRunway.size === 0 ? (
        <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] leading-relaxed text-fg-3">
          No aircraft currently observed lined up with a runway within {15} NM. Aircraft appear here when their position, track and height fit an
          approach to one of the runway ends.
        </p>
      ) : (
        [...byRunway.entries()].map(([rw, list]) => <ApproachChart key={rw} runway={rw} targets={list} />)
      )}
      <p className="text-[11px] leading-relaxed text-fg-3">
        Inferred from reported positions and runway geometry — not an ATC sequence or landing information. The map shows dashed extended centrelines.
      </p>
    </section>
  );
}
