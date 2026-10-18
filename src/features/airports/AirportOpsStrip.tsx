// Operations strip of the airport panel (lazy chunk): runway configuration, low-visibility
// procedures, de-icing, slot coordination, night curfew and upcoming runway closures — all
// from the simulated world (the runway choice follows the real METAR wind when there is one).
import { CalendarClock, CloudFog, Construction, Moon, PlaneLanding, PlaneTakeoff, Snowflake } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AirportDetail } from '@shared/types';
import { RunwayIcon } from '@/components/icons';
import { simAirportOps, simNow, simRunwayInUse, type AirportOps } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { RunwayInUseCard } from './AirportOps';

/** Minutes since local midnight of an "HH:MM" string. */
const minutesOf = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Whether local time `nowHm` ("HH:MM") falls inside a curfew window that may wrap past midnight. */
export function inCurfew(nowHm: string, c: { from: string; to: string }): boolean {
  const n = minutesOf(nowHm);
  const f = minutesOf(c.from);
  const t = minutesOf(c.to);
  return f < t ? n >= f && n < t : n >= f || n < t;
}

/** "in 25 min", "in 2 h 10", "now". */
function until(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

const TONE = {
  neutral: 'border-[var(--line)] bg-[var(--line)] text-fg-2',
  warn: 'border-[rgba(255,181,71,0.34)] bg-[rgba(255,181,71,0.12)] text-[#ffc56e]',
  danger: 'border-[rgba(255,93,115,0.34)] bg-[rgba(255,93,115,0.12)] text-[#ff8a9a]',
  ice: 'border-[rgba(92,225,255,0.32)] bg-[rgba(92,225,255,0.1)] text-[var(--accent)]',
  violet: 'border-[rgba(167,139,250,0.32)] bg-[rgba(167,139,250,0.12)] text-[#c4b5fd]',
} as const;

function Chip({ tone, icon, children, title }: { tone: keyof typeof TONE; icon: ReactNode; children: ReactNode; title: string }) {
  return (
    <li title={title} className={cn('inline-flex min-h-[24px] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-tight', TONE[tone])}>
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
      <span className="sr-only">. {title}</span>
    </li>
  );
}

function RunwayBlock({ icon, label, runway }: { icon: ReactNode; label: string; runway: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-[var(--line)] px-2.5 py-2">
      <span className="text-fg-3" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-medium leading-none text-fg-3">{label}</span>
        <span className="tnum mt-1 block text-[18px] font-semibold leading-none tracking-[-0.01em] text-fg">{runway}</span>
      </span>
    </div>
  );
}

export function AirportOpsStrip({ a }: { a: AirportDetail }) {
  useNow(10_000);
  const tz = useTimeZone(a.lat, a.lon);
  const ops: AirportOps | undefined = simAirportOps(a.ident);
  const rw = simRunwayInUse(a.ident);
  // Not (yet) answered by the simulation: the plain runway card handles its own loading.
  if (!ops || !ops.arrRunway) return <RunwayInUseCard a={a} />;
  const now = simNow();
  const segregated = ops.arrRunway !== ops.depRunway;
  // The simulator's own clock decides (it uses solar local time); the zone-based check is a fallback.
  const curfewNow = ops.curfewActive ?? (ops.curfew && tz ? inCurfew(fmtHmIn(now, tz), ops.curfew) : false);
  const zone = tzAbbrev(now, tz);
  const closures = ops.closures.filter((c) => c.to > now);
  return (
    <section aria-label="Airport operations" className="glass-2 space-y-3 rounded-[16px] p-3">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[rgba(92,225,255,0.12)] text-[var(--accent)]">
          <RunwayIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="eyebrow">Runway in use</span>
            <span
              className={cn('rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.1em]', segregated ? TONE.ice : TONE.neutral)}
              title={segregated ? 'Segregated mode: one runway for landings, another for take-offs.' : 'Mixed mode: landings and take-offs share one runway.'}
            >
              {segregated ? 'Segregated' : 'Mixed mode'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-fg-3">
            {rw?.basis === 'metar' ? `Best aligned with the real reported wind (${rw.wind}).` : 'Chosen from the simulated wind (no recent weather report).'}
          </p>
        </div>
      </div>
      {segregated ? (
        <div className="grid grid-cols-2 gap-2">
          <RunwayBlock icon={<PlaneLanding size={16} />} label="Arrivals" runway={ops.arrRunway} />
          <RunwayBlock icon={<PlaneTakeoff size={16} />} label="Departures" runway={ops.depRunway} />
        </div>
      ) : (
        <RunwayBlock icon={<RunwayIcon size={16} />} label="Mixed mode · arrivals and departures" runway={ops.arrRunway} />
      )}

      {(ops.lvp || ops.deicing || ops.slotCoordinated || ops.curfew) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Operational status">
          {ops.lvp && (
            <Chip tone="warn" icon={<CloudFog size={12} />} title="Low-visibility procedures: stop bars lit, wider spacing between arrivals, fewer movements per hour.">
              LVP active
            </Chip>
          )}
          {ops.deicing && (
            <Chip tone="ice" icon={<Snowflake size={12} />} title="Freezing conditions: departures are de-iced on the pads before take-off, which adds a few minutes each.">
              De-icing in progress
            </Chip>
          )}
          {ops.slotCoordinated && (
            <Chip tone="violet" icon={<CalendarClock size={12} />} title="Fully coordinated (IATA Level 3): every arrival and departure needs an allocated slot.">
              Slot coordinated · IATA Level 3
            </Chip>
          )}
          {ops.curfew && (
            <Chip
              tone={curfewNow ? 'danger' : 'neutral'}
              icon={<Moon size={12} />}
              title={curfewNow ? `Night curfew in force until ${ops.curfew.to} local: no scheduled movements.` : `Night curfew from ${ops.curfew.from} to ${ops.curfew.to} local time.`}
            >
              {curfewNow ? `Curfew in force until ${ops.curfew.to}` : `Night curfew ${ops.curfew.from}–${ops.curfew.to}`}
              <span className="font-medium opacity-75"> {zone === 'UTC' ? 'local' : zone}</span>
            </Chip>
          )}
        </ul>
      )}

      {closures.length > 0 && (
        <ul className="space-y-1" aria-label="Runway closures">
          {closures.map((c) => {
            const active = c.from <= now;
            return (
              <li key={c.from} className={cn('flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11.5px]', active ? TONE.danger : 'border-[var(--line)] text-fg-2')}>
                <Construction size={13} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{active ? 'Runway closed' : 'Closure'}</span> · {c.reason}
                </span>
                <span className="tnum shrink-0 font-medium">
                  {fmtHmIn(c.from, tz)}–{fmtHmIn(c.to, tz)}
                  <span className="ml-1 font-normal opacity-75">{active ? `reopens ${until(c.to - now)}` : until(c.from - now)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10.5px] text-fg-3">Simulated operations · local times ({zone}).</p>
    </section>
  );
}
