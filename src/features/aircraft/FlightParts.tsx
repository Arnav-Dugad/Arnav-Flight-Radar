// Flight building blocks (FR24-style): airline logo, alliance badge, status chip and
// the big route block with scheduled / actual / estimated times.
import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { PlaneIcon } from '@/components/icons';
import { airlineHue } from '@/data/airlines';
import { airlineIcon, airlineLogo, makerLogo, useMediaTable } from '@/data/media';
import type { TypeSpec } from '@/data/sim/typeSpecs';
import { LogoTile, logoCredit, MakerLogo } from './MakerLogo';
import type { FlightInfo, FlightStatus } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtDistance, fmtHmUTC } from '@/lib/format';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { useSettings } from '@/state/settings';

/** Monogram chip drawn from the airline's code (fallback when no free logo exists). */
export function AirlineBadge({ code, size = 40, wide = false }: { code: string; size?: number; wide?: boolean }) {
  const hue = airlineHue(code);
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center" style={{ width: wide ? size * 2.2 : size, height: size }}>
      <span
        className="tnum grid place-items-center font-bold tracking-[0.02em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.25)]"
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
    </span>
  );
}

/**
 * Airline logo from Wikimedia Commons (freely licensed / public-domain files only).
 * Compact (square) badges prefer the airline's square icon / tail mark; wide chips use
 * the wordmark. Dark logos get a light tile on dark themes (see LogoTile); falls back to
 * the IATA-code chip when there is no logo or it fails to load.
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
  const wordmark = airlineLogo(media.data, icao);
  const icon = wide ? undefined : airlineIcon(media.data, icao);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const logo = [icon, wordmark].find((m) => m && !failed.has(m.src));
  if (!logo) return <AirlineBadge code={code} size={size} wide={wide} />;
  const label = name ?? icao ?? code;
  return (
    <LogoTile
      key={logo.src}
      item={logo}
      alt={`${label} logo`}
      width={wide ? size * 2.2 : size}
      height={size}
      title={logoCredit(label, logo)}
      onError={() => setFailed((s) => new Set(s).add(logo.src))}
    />
  );
}

/** Marketing names that the variant string leaves out. */
const NICKNAME: Record<string, string> = { B788: 'Dreamliner', B789: 'Dreamliner', B78X: 'Dreamliner' };

/** Full model name, e.g. "Airbus A350-900", "Boeing 787-9 Dreamliner", "ATR 72-600". */
export function modelName(spec: Pick<TypeSpec, 'code' | 'maker' | 'model'>): string {
  const base = spec.maker === 'Various' || spec.model.toLowerCase().startsWith(spec.maker.toLowerCase()) ? spec.model : `${spec.maker} ${spec.model}`;
  const nick = NICKNAME[spec.code];
  return nick ? `${base} ${nick}` : base;
}

/** "AIRBUS A-320neo" (ICAO doc style) → "Airbus A-320neo" for types without a spec. */
const titleCase = (s: string) => s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());

/**
 * The aircraft at a glance (flight pane header): manufacturer logo, full model name, type
 * code, registration and engines. Opens the aircraft-type page.
 */
export function AircraftModelCard({
  code,
  spec,
  description,
  registration,
  onOpen,
}: {
  code: string | undefined;
  spec: TypeSpec | undefined;
  description?: string | undefined;
  registration?: string | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const media = useMediaTable();
  if (!code && !description) return null;
  const name = spec ? modelName(spec) : titleCase(description ?? code ?? '');
  const hasLogo = !!spec && !!makerLogo(media.data, spec.maker);
  // "CFM CFM56-5B" → "CFM56-5B" (the maker is in the designation).
  const engineName = spec?.engines.name.replace(/^(\S+) (?=\1)/i, '');
  const engines = spec && spec.engines.count > 0 && engineName && engineName !== '—' ? `${spec.engines.count}× ${engineName}` : undefined;
  const facts = [code, registration, engines].filter(Boolean);
  const body = (
    <>
      <span className="grid h-10 w-[88px] shrink-0 place-items-center" aria-hidden={!hasLogo}>
        {hasLogo ? (
          <MakerLogo maker={spec.maker} size={26} maxWidth={88} />
        ) : (
          <span className="grid size-10 place-items-center rounded-[12px] bg-[var(--line)] text-fg-2">
            <PlaneIcon size={20} style={{ transform: 'rotate(45deg)' }} />
          </span>
        )}
      </span>
      <span className="h-8 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold leading-tight tracking-[-0.01em] text-fg" title={name}>
          {name}
        </span>
        <span className="tnum mt-0.5 block truncate text-[11.5px] text-fg-3">
          {facts.map((f, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <span className={i < 2 ? 'font-medium text-fg-2' : undefined}>{f}</span>
            </span>
          ))}
        </span>
      </span>
    </>
  );
  const cls = 'glass-2 flex w-full items-center gap-3 rounded-[18px] py-2.5 pl-2.5 pr-3 text-left';
  if (!onOpen) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open the ${name} type page`}
      className={`${cls} group transition-[border-color,transform] duration-150 hover:border-[var(--line-strong)] focus-visible:shadow-[var(--focus)] active:scale-[0.99]`}
    >
      {body}
      <ChevronRight size={16} className="shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2" aria-hidden="true" />
    </button>
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
