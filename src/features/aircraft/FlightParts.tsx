// Flight building blocks (FR24-style): airline logo, alliance badge, status chip and
// the big route block with scheduled / actual / estimated times.
import { motion } from 'motion/react';
import { useState } from 'react';
import { PlaneIcon } from '@/components/icons';
import { airlineHue } from '@/data/airlines';
import { airlineLogo, useMediaTable } from '@/data/media';
import type { FlightInfo, FlightStatus } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtDistance, fmtHmUTC } from '@/lib/format';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { useSettings } from '@/state/settings';

/** Monogram badge drawn from the airline's code (fallback when no free logo exists). */
export function AirlineBadge({ code, size = 40 }: { code: string; size?: number }) {
  const hue = airlineHue(code);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center font-bold tracking-[0.02em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
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
  /** List rows / headers: a wider chip so wordmark logos stay legible. */
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

const ALLIANCE_STYLE: Record<string, string> = {
  'Star Alliance': 'bg-[rgba(255,255,255,0.08)] text-fg ring-[rgba(255,255,255,0.25)]',
  oneworld: 'bg-[rgba(64,96,200,0.16)] text-[#b9c8ff] ring-[rgba(120,150,255,0.35)]',
  SkyTeam: 'bg-[rgba(70,150,230,0.14)] text-[#9fd3ff] ring-[rgba(110,180,255,0.35)]',
};

/** Text badge for an alliance (alliance logos are trademarks, so none are drawn). */
export function AllianceBadge({ name }: { name: string }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1', ALLIANCE_STYLE[name] ?? 'bg-[var(--line)] text-fg-2 ring-[var(--line)]')}>
      {name}
    </span>
  );
}

export const STATUS_TONE: Record<FlightStatus, string> = {
  Scheduled: 'bg-[var(--line)] text-fg-2',
  Boarding: 'bg-[rgba(255,210,138,0.16)] text-[#ffd28a]',
  Delayed: 'bg-[rgba(255,181,71,0.16)] text-[#ffb547]',
  Canceled: 'bg-[rgba(255,93,115,0.16)] text-[#ff8a9a]',
  Holding: 'bg-[rgba(255,181,71,0.16)] text-[#ffb547]',
  Diverted: 'bg-[rgba(255,93,115,0.16)] text-[#ff8a9a]',
  'Go-around': 'bg-[rgba(255,181,71,0.16)] text-[#ffb547]',
  Taxiing: 'bg-[rgba(255,210,138,0.16)] text-[#ffd28a]',
  Departed: 'bg-[rgba(61,220,151,0.14)] text-[#7ee2a8]',
  'En route': 'bg-[rgba(61,220,151,0.14)] text-[#7ee2a8]',
  Approach: 'bg-[rgba(92,225,255,0.14)] text-[#5ce1ff]',
  Landed: 'bg-[rgba(92,225,255,0.14)] text-[#5ce1ff]',
  Arrived: 'bg-[var(--line)] text-fg-2',
  Emergency: 'bg-[rgba(255,93,115,0.22)] text-[#ff8a9a] ring-1 ring-[rgba(255,93,115,0.5)]',
  'Gate hold': 'bg-[rgba(255,181,71,0.16)] text-[#ffb547]',
  'De-icing': 'bg-[rgba(140,200,255,0.16)] text-[#9fd2ff]',
  'On station': 'bg-[rgba(61,220,151,0.14)] text-[#7ee2a8]',
  Soaring: 'bg-[rgba(61,220,151,0.14)] text-[#7ee2a8]',
};

/** Plain text colour per status (boards). */
export const STATUS_TEXT: Record<FlightStatus, string> = {
  Scheduled: 'text-fg-3',
  Boarding: 'text-[#ffd28a]',
  Delayed: 'text-[#ffb547]',
  Canceled: 'text-[#ff8a9a]',
  Holding: 'text-[#ffb547]',
  Diverted: 'text-[#ff8a9a]',
  'Go-around': 'text-[#ffb547]',
  Taxiing: 'text-[#ffd28a]',
  Departed: 'text-[#7ee2a8]',
  'En route': 'text-[#7ee2a8]',
  Approach: 'text-[#5ce1ff]',
  Landed: 'text-[#5ce1ff]',
  Arrived: 'text-fg-2',
  Emergency: 'text-[#ff8a9a]',
  'Gate hold': 'text-[#ffb547]',
  'De-icing': 'text-[#9fd2ff]',
  'On station': 'text-[#7ee2a8]',
  Soaring: 'text-[#7ee2a8]',
};

export function StatusChip({ status }: { status: FlightStatus }) {
  return <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold', STATUS_TONE[status])}>{status}</span>;
}

function TimeCell({
  label,
  sched,
  actual,
  est,
  tz,
  align = 'left',
}: {
  label: string;
  sched: number;
  actual?: number | undefined;
  est?: number | undefined;
  tz: string | null;
  align?: 'left' | 'right';
}) {
  const t = actual ?? est;
  const late = t !== undefined && t - sched > 5 * 60_000;
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-fg-3">{label}</p>
      <p className="tnum mt-0.5 text-[12.5px] text-fg-2">
        Scheduled <span className="font-semibold text-fg">{fmtHmIn(sched, tz)}</span>
      </p>
      {t !== undefined && (
        <p className={cn('tnum text-[12.5px]', late ? 'text-[#ffb547]' : 'text-[#7ee2a8]')}>
          {actual !== undefined ? 'Actual' : 'Estimated'} <span className="font-semibold">{fmtHmIn(t, tz)}</span>
        </p>
      )}
      <p className="tnum text-[10.5px] text-fg-3">
        {tzAbbrev(sched, tz)} · {fmtHmUTC(sched)} UTC
      </p>
    </div>
  );
}

const code = (a: { iata?: string; ident: string }) => a.iata ?? a.ident;

/** The FR24-style route block: big airport codes, a progress line with the aircraft, and times. */
export function FlightRoute({ info }: { info: FlightInfo }) {
  const unit = useSettings((s) => s.units.distance);
  const dest = info.canceledTo ?? info.to;
  const fromTz = useTimeZone(info.from.lat, info.from.lon);
  const toTz = useTimeZone(dest.lat, dest.lon);
  const pct = Math.round(info.progress * 100);
  const w = info.wind;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div className="min-w-0">
          <p className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-fg">{code(info.from)}</p>
          <p className="mt-1 truncate text-[12px] text-fg-2" title={info.from.name}>
            {info.from.city ?? info.from.name}
          </p>
          {info.gateFrom && <p className="tnum text-[11px] text-fg-3">Stand {info.gateFrom}</p>}
        </div>
        <span className="mb-6 text-fg-3" aria-hidden="true">
          <PlaneIcon size={18} style={{ transform: 'rotate(90deg)' }} />
        </span>
        <div className="min-w-0 text-right">
          <p className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-fg">{code(dest)}</p>
          <p className="mt-1 truncate text-[12px] text-fg-2" title={dest.name}>
            {dest.city ?? dest.name}
          </p>
          {info.gateTo && <p className="tnum text-[11px] text-fg-3">Stand {info.gateTo}</p>}
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Route progress">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#ffb547,#ffd28a)]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
        <motion.span
          className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface-solid)] text-[#ffb547] shadow ring-1 ring-[var(--line-strong)]"
          initial={false}
          animate={{ left: `${pct}%` }}
          transition={{ duration: 0.6 }}
        >
          <PlaneIcon size={13} style={{ transform: 'rotate(90deg)' }} />
        </motion.span>
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
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3">
        <TimeCell label="Departure" sched={info.std} actual={info.atd} est={info.atd ? undefined : info.std} tz={fromTz} />
        <TimeCell label="Arrival" sched={info.sta} actual={info.ata} est={info.ata ? undefined : info.eta} tz={toTz} align="right" />
      </div>
    </div>
  );
}
