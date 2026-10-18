import { useMemo } from 'react';
import { approachTargets, observedMovements, runwayEnds, type ApproachTarget } from '@shared/approach';
import type { AirportDetail } from '@shared/types';
import { fmtAgo, fmtAltitude, fmtDistance, fmtTimeUTC } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { MovementChart, type MovementBucket } from './AirportOps';

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

export function ObservedMovements({ a }: { a: AirportDetail }) {
  useTrafficVersion();
  const now = useNow(10_000);
  const select = useUI((s) => s.select);
  const movements = observedMovements(
    a.lat,
    a.lon,
    traffic.list().map((t) => ({ id: t.id, label: t.ac.callsign ?? t.ac.registration ?? t.ac.icao24.toUpperCase(), trail: traffic.trailOf(t) })),
  );
  // Trails are kept for the trail-length setting, so that is the counting window.
  const first = traffic.snapshots[0]?.t;
  const since = first !== undefined ? Math.max(first, traffic.serverNow(now) - traffic.trailMs) : undefined;
  const minutes = since ? (traffic.serverNow(now) - since) / 60_000 : 0;
  const BIN = 10 * 60_000;
  const buckets: MovementBucket[] = [];
  if (since !== undefined && minutes >= 10) {
    const end = traffic.serverNow(now);
    for (let t = Math.floor(since / BIN) * BIN; t <= end; t += BIN) buckets.push({ t, arrivals: 0, departures: 0 });
    for (const m of movements) {
      const b = buckets[Math.floor((m.t - buckets[0]!.t) / BIN)];
      if (b) b[m.kind === 'arrival' ? 'arrivals' : 'departures']++;
    }
  }
  const arr = movements.filter((m) => m.kind === 'arrival').length;
  const dep = movements.filter((m) => m.kind === 'departure').length;
  return (
    <section className="space-y-2.5">
      <h3 className="eyebrow">Observed movements this session</h3>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Arrivals', arr],
          ['Departures', dep],
          ['Per hour', minutes >= 20 ? Math.round(((arr + dep) / minutes) * 60) : '—'],
        ].map(([l, v]) => (
          <div key={l} className="glass-2 rounded-[14px] px-1.5 py-2.5">
            <div className="tnum text-[18px] font-semibold text-fg">{v}</div>
            <div className="mt-0.5 text-[10px] text-fg-3">{l}</div>
          </div>
        ))}
      </div>
      {buckets.length > 1 && (
        <MovementChart buckets={buckets} binMin={10} title="Observed movements per 10 minutes" note="Counted from this session's observations — lower bounds, not a schedule." />
      )}
      {movements.length > 0 && (
        <ul className="glass-2 divide-y divide-[var(--line)] rounded-[14px]">
          {movements.slice(0, 8).map((m) => (
            <li key={`${m.id}-${m.t}`}>
              <button type="button" onClick={() => select(m.id)} className="tnum flex w-full items-center justify-between px-3.5 py-1.5 text-left text-[12px] hover:bg-[var(--line)]">
                <span className="font-semibold text-fg">{m.label}</span>
                <span className="text-fg-2">
                  {m.kind === 'arrival' ? 'Landed' : 'Took off'} · {fmtTimeUTC(m.t).slice(0, 5)}Z · {fmtAgo(traffic.serverNow(now) - m.t)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-fg-3">
        {since ? `Watching since ${fmtTimeUTC(since).slice(0, 5)}Z (${Math.round(minutes)} min). ` : ''}
        Counted when an aircraft is seen on the ground here and then airborne nearby, or the reverse, within the trail window (Settings → Trail length). Aircraft without ground reports are missed, so
        these are lower bounds — not a schedule.{minutes < 20 && ' The hourly rate appears after 20 minutes of observation.'}
      </p>
    </section>
  );
}
