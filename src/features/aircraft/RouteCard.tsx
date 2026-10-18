// Operator & route card.
//  • Live: the operator is inferred from the callsign prefix (OpenFlights). Route
//    and schedule data is not shown — the free route databases may not be
//    republished without the maintainers' permission.
//  • Demo: the simulated flight's route, schedule and progress.
import { motion } from 'motion/react';
import { airlineHue, useAirline } from '@/data/airlines';
import { demoFlight, type DemoFlightInfo } from '@/data/demo';
import { fmtDistance, fmtHmUTC } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useSettings } from '@/state/settings';
import type { Aircraft } from '@shared/types';

/** Monogram badge drawn from the airline's code. Deliberately NOT the airline's logo (trademarks). */
export function AirlineBadge({ code, size = 40 }: { code: string; size?: number }) {
  const hue = airlineHue(code);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[12px] font-bold tracking-[0.02em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
      style={{
        width: size,
        height: size,
        fontSize: size * (code.length > 2 ? 0.3 : 0.38),
        background: `linear-gradient(140deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 65% 34%))`,
      }}
    >
      {code}
    </span>
  );
}

const STATUS_TONE: Record<DemoFlightInfo['status'], string> = {
  Scheduled: 'text-fg-2',
  Boarding: 'text-[#ffd28a]',
  Taxiing: 'text-[#ffd28a]',
  Departed: 'text-[#7ee2a8]',
  'En route': 'text-[#7ee2a8]',
  Approach: 'text-[#5ce1ff]',
  Landed: 'text-[#5ce1ff]',
  Arrived: 'text-fg-2',
};

function Time({ label, sched, actual, est }: { label: string; sched: number; actual?: number | undefined; est?: number | undefined }) {
  const t = actual ?? est;
  const late = t !== undefined && t - sched > 5 * 60_000;
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-fg-3">{label}</p>
      <p className="tnum text-[13px] text-fg">{fmtHmUTC(sched)}</p>
      {t !== undefined && (
        <p className={`tnum text-[11px] ${late ? 'text-[#ffb547]' : 'text-[#7ee2a8]'}`}>
          {actual !== undefined ? 'Actual' : 'Est.'} {fmtHmUTC(t)}
        </p>
      )}
    </div>
  );
}

function DemoRoute({ info }: { info: DemoFlightInfo }) {
  const unit = useSettings((s) => s.units.distance);
  const code = info.airline?.iata || info.airline?.icao || info.flight.slice(0, 2);
  const pct = Math.round(info.progress * 100);
  const from = info.from.iata ?? info.from.ident;
  const to = info.to.iata ?? info.to.ident;
  return (
    <div className="glass-2 space-y-3 rounded-[18px] p-3.5">
      <div className="flex items-center gap-3">
        <AirlineBadge code={code} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-fg">{info.airline?.name ?? 'General aviation'}</p>
          <p className="tnum truncate text-[12px] text-fg-3">
            {info.flightIata ? `${info.flightIata} · ` : ''}
            {info.flight}
          </p>
        </div>
        <span className={`text-[12px] font-semibold ${STATUS_TONE[info.status]}`}>{info.status}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-fg">{from}</p>
          <p className="mt-1 truncate text-[11.5px] text-fg-3" title={info.from.name}>
            {info.from.city ?? info.from.name}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-fg">{to}</p>
          <p className="mt-1 truncate text-[11.5px] text-fg-3" title={info.to.name}>
            {info.to.city ?? info.to.name}
          </p>
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Route progress">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#2e8bff,#5ce1ff)]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
        <motion.div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5ce1ff] bg-[var(--bg)]" initial={false} animate={{ left: `${pct}%` }} transition={{ duration: 0.6 }} />
      </div>
      <p className="tnum flex justify-between text-[11px] text-fg-3">
        <span>{fmtDistance(info.flownNm, unit)} flown</span>
        <span>{fmtDistance(Math.max(0, info.totalNm - info.flownNm), unit)} to go</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Time label="Departure" sched={info.std} actual={info.atd} est={info.atd ? undefined : info.std} />
        <div className="text-right [&>div]:ml-auto">
          <Time label="Arrival" sched={info.sta} actual={info.ata} est={info.ata ? undefined : info.eta} />
        </div>
      </div>
      <p className="text-[10.5px] leading-snug text-fg-3">Simulated schedule (demo). Real airline, airports and aircraft type; the flight itself is invented. Times UTC.</p>
    </div>
  );
}

function LiveOperator({ ac }: { ac: Aircraft }) {
  const q = useAirline(ac.callsign);
  if (!q.data) return null;
  const a = q.data;
  return (
    <div className="glass-2 flex items-center gap-3 rounded-[18px] p-3">
      <AirlineBadge code={a.iata ?? a.icao} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-fg">{a.name}</p>
        <p className="truncate text-[11.5px] text-fg-3">{[a.telephony && `“${a.telephony}”`, a.country].filter(Boolean).join(' · ')}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-fg-3">Operator inferred from the callsign prefix {a.icao} · OpenFlights (ODbL)</p>
      </div>
    </div>
  );
}

export function RouteCard({ ac }: { ac: Aircraft }) {
  useNow(2000);
  if (ac.provider === 'demo') {
    const info = demoFlight(ac.id);
    return info ? <DemoRoute info={info} /> : null;
  }
  return <LiveOperator ac={ac} />;
}
