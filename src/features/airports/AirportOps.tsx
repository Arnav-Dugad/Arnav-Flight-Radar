// Airport operations: runway in use (inferred), movement chart, and — in demo
// mode only — a simulated arrivals/departures board.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { approachTargets, inferRunwayInUse, runwayEnds } from '@shared/approach';
import type { AirportDetail } from '@shared/types';
import { RunwayIcon } from '@/components/icons';
import { Tabs } from '@/components/ui/Data';
import { demoBoard, demoMovementsByHour, demoNow, demoRunwayInUse, type BoardRow } from '@/data/demo';
import { api } from '@/lib/api';
import { fmtHmUTC } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { focusAircraft } from '@/map/controller';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { AirlineLogo } from '@/features/aircraft/RouteCard';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';

// ---------------------------------------------------------------- runway in use

export function RunwayInUseCard({ a, demo }: { a: AirportDetail; demo: boolean }) {
  useTrafficVersion();
  const station = a.icao && /^[A-Z]{4}$/.test(a.icao) ? a.icao : /^[A-Z]{4}$/.test(a.ident) ? a.ident : null;
  const metar = useQuery({
    queryKey: ['metar', station],
    queryFn: ({ signal }) => api.metar([station!], signal),
    enabled: !!station && !demo,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const ends = useMemo(() => runwayEnds(a.runways), [a.runways]);
  if (demo) {
    const rw = demoRunwayInUse(a.ident);
    if (!rw) return null;
    return (
      <Card
        runway={rw.runway}
        title="Runway in use (simulated)"
        body={
          rw.basis === 'metar'
            ? `Demo traffic uses the runway best aligned with the real reported wind (${rw.wind}).`
            : 'Demo traffic lands and departs on this runway direction (simulated wind).'
        }
      />
    );
  }
  if (!ends.length) return null;
  const m = metar.data?.data[0];
  const guess = inferRunwayInUse(ends, approachTargets(ends, a.elevationFt, traffic.current()), m ? { dirDeg: m.windDirDeg, speedKt: m.windSpeedKt } : undefined);
  if (!guess) {
    return (
      <Card
        runway="—"
        title="Runway in use"
        body={m && (m.windSpeedKt ?? 0) < 3 ? 'Calm or variable wind and no aircraft on final: no reliable guess.' : 'No aircraft on final and no usable wind report: no guess.'}
      />
    );
  }
  return (
    <Card
      runway={guess.runway}
      title="Runway in use · inferred"
      body={
        guess.basis === 'approaches'
          ? `${guess.count} aircraft observed lined up on final for ${guess.runway}.`
          : `Best aligned with the reported wind (${m?.windDirDeg}° ${m?.windSpeedKt} kt, ≈${guess.headwindKt} kt headwind). Wind-based guess — noise rules and ATC choices can differ.`
      }
    />
  );
}

function Card({ runway, title, body }: { runway: string; title: string; body: string }) {
  return (
    <div className="glass-2 flex items-center gap-3 rounded-[16px] p-3">
      <div className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft,rgba(92,225,255,0.12))] text-[var(--accent)]">
        <RunwayIcon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">{title}</div>
        <div className="tnum text-[20px] font-semibold leading-tight text-fg">{runway}</div>
        <p className="text-[11px] leading-snug text-fg-3">{body}</p>
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

export function MovementChart({ buckets, binMin, title, note, nowT }: { buckets: MovementBucket[]; binMin: number; title: string; note: string; nowT?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.arrivals, b.departures)));
  const nice = max <= 4 ? 4 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const slot = (CW - CP.l - CP.r) / Math.max(1, buckets.length);
  const bw = Math.max(2, Math.min(14, (slot - 4) / 2));
  const y = (v: number) => CP.t + (1 - v / nice) * (CH - CP.t - CP.b);
  const h = hover !== null ? buckets[hover] : undefined;
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
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label={`${title}: ${buckets.map((b) => `${fmtHmUTC(b.t)} ${b.arrivals} arrivals ${b.departures} departures`).join('; ')}`} onMouseLeave={() => setHover(null)}>
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
                  {fmtHmUTC(b.t).slice(0, 5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="tnum pointer-events-none absolute right-3 top-9 rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] text-fg shadow-lg">
          <div className="font-semibold">
            {fmtHmUTC(h.t).slice(0, 5)}–{fmtHmUTC(h.t + binMin * 60_000)}
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

// ---------------------------------------------------------------- demo board

const STATUS_COLOR: Record<string, string> = {
  Delayed: 'text-[#ffb547]',
  Holding: 'text-[#ffb547]',
  Diverted: 'text-[#ff8a9a]',
  Scheduled: 'text-fg-3',
  Boarding: 'text-[#ffd28a]',
  Taxiing: 'text-[#ffd28a]',
  'En route': 'text-[#7ee2a8]',
  Approach: 'text-[#5ce1ff]',
  Landed: 'text-[#5ce1ff]',
  Arrived: 'text-fg-2',
  Departed: 'text-[#7ee2a8]',
};

function BoardRows({ rows, dep, tz }: { rows: BoardRow[]; dep: boolean; tz: string | null }) {
  const select = useUI((s) => s.select);
  if (!rows.length) return <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">No simulated {dep ? 'departures' : 'arrivals'} in this window.</p>;
  return (
    <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
      {rows.map((r) => {
        const live = !!traffic.get(r.id);
        const late = r.delayMin > 5;
        return (
          <li key={`${r.id}-${r.scheduled}`}>
            <button
              type="button"
              disabled={!live}
              onClick={() => {
                select(r.id);
                focusAircraft(r.id, 10);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left enabled:hover:bg-[var(--line)] disabled:cursor-default"
            >
              <div className="tnum w-[50px] shrink-0">
                <div className="text-[13px] font-semibold text-fg">{fmtHmIn(r.scheduled, tz)}</div>
                <div className={`text-[10.5px] ${late ? 'text-[#ffb547]' : 'text-fg-3'}`}>{fmtHmIn(r.actual ?? r.estimated, tz)}</div>
                <div className="text-[9.5px] text-fg-3">{fmtHmUTC(r.scheduled).slice(0, 5)}Z</div>
              </div>
              <AirlineLogo icao={r.airlineIcao} code={r.airlineIata ?? r.flight.slice(0, 2)} size={26} name={r.airline} wide />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-fg">
                  {r.other.iata ?? r.other.ident} <span className="font-normal text-fg-2">{r.other.city ?? r.other.name}</span>
                </div>
                <div className="tnum truncate text-[10.5px] text-fg-3">
                  {r.flightIata ?? r.flight} · {r.type}
                  {r.gate ? ` · Stand ${r.gate}` : ''}
                  {r.codeshares.length ? ` · also ${r.codeshares.join(', ')}` : ''}
                </div>
                {r.divertedTo && <div className="text-[10.5px] text-[#ff8a9a]">Diverted to {r.divertedTo.iata ?? r.divertedTo.ident} ({r.divertedTo.city ?? r.divertedTo.name})</div>}
              </div>
              <span className={`shrink-0 text-right text-[11px] font-semibold ${STATUS_COLOR[r.status] ?? 'text-fg-2'}`}>
                {r.status}
                {late && r.status !== 'Arrived' && r.status !== 'Landed' && <span className="block text-[10px] font-normal text-[#ffb547]">+{r.delayMin} min</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DemoAirportOps({ a }: { a: AirportDetail }) {
  const now = useNow(5000);
  const tz = useTimeZone(a.lat, a.lon);
  const [tab, setTab] = useState<'arrivals' | 'departures'>('arrivals');
  const board = useMemo(() => demoBoard(a.ident, { pastMin: 45, aheadMin: 150 }), [a.ident, Math.floor(now / 15_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const hourly = useMemo(() => demoMovementsByHour(a.ident, 6), [a.ident, Math.floor(now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!board) return null;
  const rows = tab === 'arrivals' ? board.arrivals : board.departures;
  return (
    <div className="space-y-3">
      <RunwayInUseCard a={a} demo />
      {hourly && <MovementChart buckets={hourly} binMin={60} title="Movements per hour (simulated)" note="Simulated schedule. Faded bars are the hours ahead." nowT={Math.floor(demoNow() / 3_600_000) * 3_600_000} />}
      <Tabs
        label="Flight board"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'arrivals', label: `Arrivals (${board.arrivals.length})` },
          { id: 'departures', label: `Departures (${board.departures.length})` },
        ]}
      />
      <BoardRows rows={rows.slice(0, 60)} dep={tab === 'departures'} tz={tz} />
      <p className="text-[11px] leading-snug text-fg-3">
        Simulated board (demo mode): real airlines and airports, invented flights, codeshares and times. Local time ({tzAbbrev(demoNow(), tz)}), then the estimate or actual time, then UTC. Stands from OpenStreetMap where mapped.
      </p>
    </div>
  );
}
