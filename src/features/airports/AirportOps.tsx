// Airport operations for the simulated world: runway in use, hourly movements,
// aircraft on the ground and the departure queue (boards: AirportBoards.tsx, lazy).
import { useState } from 'react';
import type { AirportDetail } from '@shared/types';
import { RunwayIcon } from '@/components/icons';
import { simDepartureQueue, simMovementsByHour, simNow, simRunwayInUse, simStands } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtHmUTC } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { fmtHmIn, useTimeZone } from '@/lib/tz';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

// ---------------------------------------------------------------- runway in use

export function RunwayInUseCard({ a }: { a: AirportDetail }) {
  useNow(10_000);
  const rw = simRunwayInUse(a.ident);
  if (!rw) return null;
  return (
    <div className="glass-2 flex items-center gap-3 rounded-[16px] p-3">
      <div className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-[rgba(92,225,255,0.12)] text-[var(--accent)]">
        <RunwayIcon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Runway in use</div>
        <div className="tnum text-[20px] font-semibold leading-tight text-fg">{rw.runway}</div>
        <p className="text-[11px] leading-snug text-fg-3">
          {rw.basis === 'metar' ? `Best aligned with the real reported wind (${rw.wind}).` : 'Chosen from the simulated wind (no recent weather report).'}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- movement chart

export interface MovementBucket {
  t: number;
  arrivals: number;
  departures: number;
}

const CW = 340;
const CH = 132;
const CP = { l: 26, r: 8, t: 10, b: 20 };

export function MovementChart({ buckets, binMin, title, note, nowT, tz }: { buckets: MovementBucket[]; binMin: number; title: string; note: string; nowT?: number; tz?: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.arrivals, b.departures)));
  const nice = max <= 4 ? 4 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const slot = (CW - CP.l - CP.r) / Math.max(1, buckets.length);
  const bw = Math.max(2, Math.min(14, (slot - 4) / 2));
  const y = (v: number) => CP.t + (1 - v / nice) * (CH - CP.t - CP.b);
  const h = hover !== null ? buckets[hover] : undefined;
  const label = (t: number) => (tz ? fmtHmIn(t, tz) : fmtHmUTC(t).slice(0, 5));
  return (
    <figure className="glass-2 relative rounded-[16px] p-2.5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[12.5px] font-semibold text-fg">{title}</span>
        <span className="flex items-center gap-3 text-[10.5px] text-fg-2">
          <span className="flex items-center gap-1">
            <i className="inline-block size-2 rounded-[2px] bg-[var(--viz-1)]" /> Arrivals
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block size-2 rounded-[2px] bg-[var(--viz-2)]" /> Departures
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="w-full"
        role="img"
        aria-label={`${title}: ${buckets.map((b) => `${label(b.t)} ${b.arrivals} arrivals ${b.departures} departures`).join('; ')}`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, nice / 2, nice].map((v) => (
          <g key={v}>
            <line x1={CP.l} x2={CW - CP.r} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" />
            <text x={CP.l - 5} y={y(v) + 3.5} textAnchor="end" fontSize="9" fill="var(--fg-3)" className="tnum">
              {v}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x0 = CP.l + i * slot + slot / 2;
          const future = nowT !== undefined && b.t > nowT;
          return (
            <g key={b.t} opacity={hover === null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)}>
              <rect x={CP.l + i * slot} y={CP.t} width={slot} height={CH - CP.t - CP.b} fill="transparent" />
              {b.arrivals > 0 && <rect x={x0 - bw - 1} y={y(b.arrivals)} width={bw} height={y(0) - y(b.arrivals)} rx={Math.min(3, bw / 2)} fill="var(--viz-1)" opacity={future ? 0.45 : 1} />}
              {b.departures > 0 && <rect x={x0 + 1} y={y(b.departures)} width={bw} height={y(0) - y(b.departures)} rx={Math.min(3, bw / 2)} fill="var(--viz-2)" opacity={future ? 0.45 : 1} />}
              {(i % Math.ceil(buckets.length / 6) === 0 || i === buckets.length - 1) && (
                <text x={x0} y={CH - 6} textAnchor="middle" fontSize="9" fill="var(--fg-3)" className="tnum">
                  {label(b.t)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="tnum pointer-events-none absolute right-3 top-9 rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] text-fg shadow-lg">
          <div className="font-semibold">
            {label(h.t)}–{label(h.t + binMin * 60_000)}
          </div>
          <div className="text-fg-2">
            {h.arrivals} arrivals · {h.departures} departures
          </div>
        </div>
      )}
      <p className="px-1 pt-1 text-[10.5px] leading-snug text-fg-3">{note}</p>
    </figure>
  );
}

export function HourlyMovements({ a }: { a: AirportDetail }) {
  useNow(60_000);
  const tz = useTimeZone(a.lat, a.lon);
  const hourly = simMovementsByHour(a.ident, 6);
  if (!hourly) return null;
  return <MovementChart buckets={hourly} binMin={60} title="Movements per hour" note="Local time. Faded bars are the hours ahead (simulated schedule)." nowT={Math.floor(simNow() / 3_600_000) * 3_600_000} tz={tz} />;
}

// ---------------------------------------------------------------- on the ground

export function GroundTab({ a }: { a: AirportDetail }) {
  useTrafficVersion();
  useNow(3000);
  const tz = useTimeZone(a.lat, a.lon);
  const select = useUI((s) => s.select);
  const queue = simDepartureQueue(a.ident);
  const stands = simStands(a.ident);
  const onGround = traffic
    .current()
    .filter((ac) => ac.onGround && Math.abs(ac.lat - a.lat) < 0.06 && Math.abs(ac.lon - a.lon) < 0.08)
    .sort((x, y) => (x.callsign ?? '').localeCompare(y.callsign ?? ''));
  const occupied = stands.filter((s) => s.occupied).length;
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="eyebrow">Departure queue</h3>
        {queue.length === 0 ? (
          <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">No departures taxiing right now.</p>
        ) : (
          <ol className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
            {queue.slice(0, 15).map((q, i) => (
              <li key={q.id}>
                <button type="button" onClick={() => select(q.id)} className="tnum flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                  <span className="w-4 text-[11px] text-fg-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                    <span className="font-semibold">{q.flight}</span> <span className="text-fg-2">→ {q.to.iata ?? q.to.ident} · {q.type}</span>
                  </span>
                  <span className={cn('shrink-0 text-[11px] font-semibold', q.state === 'Lining up' ? 'text-[#7ee2a8]' : q.state === 'Holding short' ? 'text-[#ffd28a]' : 'text-fg-2')}>{q.state}</span>
                  <span className="shrink-0 text-[11px] text-fg-3">Rwy {q.runway} · {fmtHmIn(q.takeoff, tz)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {stands.length > 0 && (
        <div className="glass-2 flex items-center justify-between rounded-[14px] px-3.5 py-2.5 text-[12px]">
          <span className="text-fg-2">Stands occupied (OpenStreetMap stands)</span>
          <span className="tnum font-semibold text-fg">
            {occupied} / {stands.length}
          </span>
        </div>
      )}
      <section className="space-y-2">
        <h3 className="eyebrow">On the ground ({onGround.length})</h3>
        <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
          {onGround.slice(0, 60).map((ac) => (
            <li key={ac.id}>
              <button type="button" onClick={() => select(ac.id)} className="tnum flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                <span className="truncate text-[12.5px] text-fg">
                  <span className="font-semibold">{ac.callsign}</span> <span className="text-fg-2">{ac.typeDescription}</span>
                </span>
                <span className="shrink-0 text-[11px] text-fg-3">{(ac.groundSpeed ?? 0) > 2 ? 'Taxiing' : 'Parked'}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-fg-3">Transponders switch on about 40 minutes before departure and off 15 minutes after arrival.</p>
      </section>
    </div>
  );
}
