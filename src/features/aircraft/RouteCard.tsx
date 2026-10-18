// Operator & route card.
//  • Live: the operator is inferred from the callsign prefix (OpenFlights). Route
//    and schedule data is not shown — the free route databases may not be
//    republished without the maintainers' permission.
//  • Demo: the simulated flight's route, schedule, gates, codeshares and progress.
import { motion } from 'motion/react';
import { useState } from 'react';
import { airlineHue, useAirline } from '@/data/airlines';
import { demoFlight, type DemoFlightInfo } from '@/data/demo';
import { airlineLogo, useMediaTable } from '@/data/media';
import { fmtDistance, fmtHmUTC } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { useSettings } from '@/state/settings';
import type { Aircraft } from '@shared/types';

/** Monogram badge drawn from the airline's code (fallback when no free logo exists). */
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

/**
 * Airline logo from Wikimedia Commons (freely licensed / public-domain files only),
 * on a white tile like an app icon; falls back to the monogram.
 */
export function AirlineLogo({
  icao,
  code,
  size = 40,
  name,
  wide = false,
}: {
  icao?: string | undefined;
  code: string;
  size?: number;
  name?: string | undefined;
  /** List rows: a wider chip so wordmark logos stay legible. */
  wide?: boolean;
}) {
  const media = useMediaTable();
  const logo = airlineLogo(media.data, icao);
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return <AirlineBadge code={code} size={size} />;
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.25)]"
      style={{ width: wide ? size * 2.2 : size, height: size, borderRadius: Math.round(size * 0.28), padding: Math.max(2, Math.round(size * 0.1)) }}
      title={`${name ?? icao} logo · ${logo.license}${logo.artist ? ` · ${logo.artist}` : ''} · Wikimedia Commons`}
    >
      <img src={logo.src} alt={`${name ?? icao} logo`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
    </span>
  );
}

const STATUS_TONE: Record<DemoFlightInfo['status'], string> = {
  Scheduled: 'text-fg-2',
  Boarding: 'text-[#ffd28a]',
  Delayed: 'text-[#ffb547]',
  Holding: 'text-[#ffb547]',
  Diverted: 'text-[#ff8a9a]',
  Taxiing: 'text-[#ffd28a]',
  Departed: 'text-[#7ee2a8]',
  'En route': 'text-[#7ee2a8]',
  Approach: 'text-[#5ce1ff]',
  Landed: 'text-[#5ce1ff]',
  Arrived: 'text-fg-2',
};

function Time({
  label,
  sched,
  actual,
  est,
  tz,
  gate,
  align = 'left',
}: {
  label: string;
  sched: number;
  actual?: number | undefined;
  est?: number | undefined;
  tz: string | null;
  gate?: string | undefined;
  align?: 'left' | 'right';
}) {
  const t = actual ?? est;
  const late = t !== undefined && t - sched > 5 * 60_000;
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-fg-3">{label}</p>
      <p className="tnum text-[17px] font-semibold leading-tight text-fg">
        {fmtHmIn(sched, tz)} <span className="text-[10.5px] font-medium text-fg-3">{tzAbbrev(sched, tz)}</span>
      </p>
      <p className="tnum text-[11px] text-fg-3">{fmtHmUTC(sched)} UTC</p>
      {t !== undefined && (
        <p className={`tnum text-[11.5px] font-medium ${late ? 'text-[#ffb547]' : 'text-[#7ee2a8]'}`}>
          {actual !== undefined ? 'Actual' : 'Estimated'} {fmtHmIn(t, tz)}
        </p>
      )}
      {gate && <p className="tnum mt-0.5 text-[11px] text-fg-2">Stand {gate}</p>}
    </div>
  );
}

function DemoRoute({ info }: { info: DemoFlightInfo }) {
  const unit = useSettings((s) => s.units.distance);
  const fromTz = useTimeZone(info.from.lat, info.from.lon);
  const toTz = useTimeZone(info.to.lat, info.to.lon);
  const code = info.airline?.iata || info.airline?.icao || info.flight.slice(0, 2);
  const pct = Math.round(info.progress * 100);
  const from = info.from.iata ?? info.from.ident;
  const to = info.to.iata ?? info.to.ident;
  const w = info.wind;
  return (
    <div className="glass-2 space-y-3 rounded-[20px] p-3.5">
      <div className="flex items-center gap-3">
        {info.airline ? <AirlineLogo icao={info.airline.icao} code={code} name={info.airline.name} /> : <AirlineBadge code="GA" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-fg">{info.airline?.name ?? 'General aviation'}</p>
          <p className="tnum truncate text-[12px] text-fg-3">
            {info.flightIata ? `${info.flightIata} · ` : ''}
            {info.flight}
          </p>
        </div>
        <span className={`text-[12px] font-semibold ${STATUS_TONE[info.status]}`}>{info.status}</span>
      </div>
      {info.codeshares.length > 0 && <p className="tnum -mt-1 text-[11px] text-fg-3">Also sold as {info.codeshares.join(' · ')}</p>}
      {info.divertedFrom && (
        <p className="rounded-[12px] bg-[rgba(255,138,154,0.12)] px-3 py-2 text-[11.5px] text-[#ffb3bd]">
          Diverted from {info.divertedFrom.iata ?? info.divertedFrom.ident} ({info.divertedFrom.city ?? info.divertedFrom.name}) — weather below limits there.
        </p>
      )}
      {info.status === 'Holding' && (
        <p className="rounded-[12px] bg-[rgba(255,181,71,0.12)] px-3 py-2 text-[11.5px] text-[#ffd59a]">Holding for an arrival slot ({info.holdMin} min planned).</p>
      )}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-fg">{from}</p>
          <p className="mt-1 truncate text-[11.5px] text-fg-3" title={info.from.name}>
            {info.from.city ?? info.from.name}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-fg">{to}</p>
          <p className="mt-1 truncate text-[11.5px] text-fg-3" title={info.to.name}>
            {info.to.city ?? info.to.name}
          </p>
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Route progress">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#2e8bff,#5ce1ff)]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
        <motion.div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5ce1ff] bg-[var(--surface-solid)]"
          initial={false}
          animate={{ left: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
      <p className="tnum flex justify-between gap-2 text-[11px] text-fg-3">
        <span>{fmtDistance(info.flownNm, unit)} flown</span>
        {w && (
          <span title="Simulated winds aloft">
            {w.comp >= 0 ? 'Tailwind' : 'Headwind'} {Math.abs(Math.round(w.comp))} kt
          </span>
        )}
        <span>{fmtDistance(Math.max(0, info.totalNm - info.flownNm), unit)} to go</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Time label="Departure" sched={info.std} actual={info.atd} est={info.atd ? undefined : info.std} tz={fromTz} gate={info.gateFrom} />
        <Time label="Arrival" sched={info.sta} actual={info.ata} est={info.ata ? undefined : info.eta} tz={toTz} gate={info.gateTo} align="right" />
      </div>
      <p className="text-[10.5px] leading-snug text-fg-3">
        Simulated flight (demo): real airline, airports and aircraft type; invented schedule, codeshares and times. Stands from OpenStreetMap where mapped. Local
        times, with UTC below.
      </p>
    </div>
  );
}

function LiveOperator({ ac }: { ac: Aircraft }) {
  const q = useAirline(ac.callsign);
  if (!q.data) return null;
  const a = q.data;
  return (
    <div className="glass-2 flex items-center gap-3 rounded-[20px] p-3">
      <AirlineLogo icao={a.icao} code={a.iata ?? a.icao} size={38} name={a.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-fg">{a.name}</p>
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
