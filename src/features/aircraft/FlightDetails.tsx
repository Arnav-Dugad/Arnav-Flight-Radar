// Flight plan details for the Flight tab (route string, procedures, stands, taxi routes,
// approach, wake category, days of operation, delays) and the emergency banner.
// Everything here comes from the simulation; procedure designators are generated.
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Emergency, RouteInfo, TaxiInfo } from '@/data/sim/engine';
import { otsLabel } from '@/data/sim/procedures';
import { daysLabel, iataSeason, WEEKDAYS, type RouteDays } from '@/data/sim/schedule';
import { legKindLabel, type FlightInfo } from '@/data/world';
import { cn } from '@/lib/cn';

const NAV_KIND = ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'];
const WAKE: Record<string, string> = {
  J: 'Super',
  H: 'Heavy',
  M: 'Medium',
  L: 'Light',
};

const apCode = (a: { iata?: string; ident: string }) => a.iata ?? a.ident;

/** Red banner for a simulated in-flight emergency (MAYDAY / PAN PAN). */
export function EmergencyBanner({ e }: { e: Emergency }) {
  const medical = e.kind === 'medical';
  const squawk = e.squawk ?? (medical ? undefined : '7700');
  const what =
    e.kind === 'engine'
      ? 'MAYDAY — engine failure'
      : e.kind === 'pressurisation'
        ? 'MAYDAY — loss of cabin pressure'
        : e.kind === 'birdstrike'
          ? `${squawk ? 'MAYDAY' : 'PAN PAN'} — bird strike, returning`
          : 'PAN PAN — medical';
  return (
    <div role="alert" className="mx-5 mb-3 flex items-start gap-2.5 rounded-[14px] bg-[rgba(255,93,115,0.16)] px-3.5 py-2.5 ring-1 ring-[rgba(255,93,115,0.45)]">
      <TriangleAlert size={16} className="mt-px shrink-0 text-[#ff8a9a]" aria-hidden="true" />
      <div className="min-w-0 text-[12px] leading-snug text-[#ffb3bd]">
        <p className="font-semibold text-[#ff8a9a]">
          {what}
          {squawk && <span className="tnum ml-1.5 rounded-[6px] bg-[rgba(255,93,115,0.22)] px-1.5 py-px text-[11px] font-semibold">Squawk {squawk}</span>}
        </p>
        <p className="mt-0.5">
          Diverting to {e.divertTo.city ?? e.divertTo.name} ({apCode(e.divertTo)}). Simulated scenario.
        </p>
      </div>
    </div>
  );
}

function Item({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 border-b border-[var(--line)] py-2 last:border-b-0">
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className={cn('min-w-0 break-words text-[12.5px] font-medium leading-snug text-fg', mono && 'tnum')}>{children}</dd>
    </div>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <span className="block text-[11px] font-normal text-fg-3">{children}</span>;

function fixLabel(f: { ident: string; name?: string; real: boolean; kind?: number }) {
  const kind = f.real ? `real ${f.kind !== undefined ? (NAV_KIND[f.kind] ?? 'navaid') : 'navaid'}` : 'generated waypoint';
  return `${f.ident}${f.name ? ` (${f.name})` : ''} · ${kind}`;
}

function Procedure({ p }: { p: NonNullable<RouteInfo['sid']> }) {
  return (
    <>
      <span className="font-mono text-[12px]">{p.name}</span>
      {p.published && <span className="ml-1.5 rounded-full bg-[rgba(61,220,151,0.14)] px-1.5 py-px text-[10px] font-semibold text-[#7ee2a8]">Published · {p.published}</span>}
      <Sub>{p.fixes ? p.fixes.map((f) => f.ident).join(' · ') : fixLabel(p.fix)}</Sub>
    </>
  );
}

/** Mon–Sun strip showing the days a route operates. */
function WeekStrip({ days }: { days: RouteDays }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <span className="mt-1 flex gap-1" aria-label={`Operates ${daysLabel(days)}`}>
      {order.map((d) => {
        const on = ((days.mask >> d) & 1) === 1;
        return (
          <span
            key={d}
            className={cn(
              'flex h-5 w-7 items-center justify-center rounded-[6px] text-[10px] font-semibold',
              on ? 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent)]' : 'bg-[var(--line)] text-fg-3 opacity-60',
            )}
          >
            {WEEKDAYS[d]!.slice(0, 2)}
          </span>
        );
      })}
    </span>
  );
}

/** The aircraft's day: legs flown, this flight, and the next planned leg. */
function Rotation({ legs }: { legs: FlightInfo['rotation'] }) {
  return (
    <ol className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px]" aria-label="Aircraft rotation">
      {legs.map((l, i) => (
        <li key={i} className="flex items-center gap-1">
          {i === 0 && <span className="tnum font-semibold text-fg-3">{apCode(l.from)}</span>}
          <span className={cn('text-fg-3', l.state === 'next' && 'opacity-60')} aria-hidden="true">
            {l.state === 'next' ? '⇢' : '→'}
          </span>
          <span
            className={cn(
              'tnum rounded-[6px] px-1 font-semibold',
              l.state === 'now' ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]' : l.state === 'next' ? 'italic text-fg-3' : 'text-fg-2',
            )}
            title={l.flight ? `${l.flight}${l.state === 'next' ? ' (planned)' : ''}` : 'Planned next leg'}
          >
            {apCode(l.to)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function standText(terminal: string | undefined, gate: string | undefined, remote: boolean): string | undefined {
  const parts: string[] = [];
  if (terminal) parts.push(/^\d+$|^[A-Z]$/.test(terminal) ? `Terminal ${terminal}` : terminal);
  if (gate) parts.push(`Stand ${gate}`);
  if (remote) parts.push('remote stand · bus');
  return parts.length ? parts.join(' · ') : undefined;
}

function taxiOutText(t: TaxiInfo): string {
  const parts: string[] = [];
  if (t.via.length) parts.push(`via ${t.via.join(', ')}`);
  parts.push(t.hold ? `to holding point ${t.hold}, runway ${t.runway}` : `to runway ${t.runway}`);
  const s = parts.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function taxiInText(t: TaxiInfo): string {
  const parts = [`Runway ${t.runway}${t.exit ? `, vacate via ${t.exit}` : ''}`];
  if (t.via.length) parts.push(`taxi via ${t.via.join(', ')}`);
  return parts.join(' · ');
}

/** The "Flight plan" section of the Flight tab. */
export function FlightPlan({ info }: { info: FlightInfo }) {
  const r = info.route;
  const nonAirline = !info.airline && info.operator;
  const depStand = standText(info.terminalFrom, info.gateFrom, info.remoteFrom);
  const arrStand = standText(info.terminalTo, info.gateTo, false);
  const delays = [
    info.crewDelayMin > 0 && `Crew duty limit: waited ${info.crewDelayMin >= 120 ? `${Math.round(info.crewDelayMin / 60)} h` : `${info.crewDelayMin} min`} for a fresh crew`,
    info.gateHoldMin > 0 && `Gate hold ${info.gateHoldMin} min`, info.deiceMin > 0 && `De-icing ${info.deiceMin} min`, info.holdMin > 0 && `Holding ${info.holdMin} min`].filter(
    Boolean,
  ) as string[];
  const wake = WAKE[info.wake];
  return (
    <section aria-label="Flight plan" className="glass-2 rounded-[16px] px-3.5 pb-1 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="eyebrow">Flight plan</span>
        {info.kind !== 'scheduled' && (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--accent)]">{legKindLabel(info.kind)}</span>
        )}
      </div>
      <dl className="mt-1.5">
        {nonAirline && info.operator && (
          <Item label="Operator">
            {info.operator.name}
            <Sub>
              Callsign “{info.operator.tel}” · {info.operator.country}
            </Sub>
          </Item>
        )}
        {r?.text && (
          <Item label="Route">
            <span className="block rounded-[8px] bg-[var(--line)] px-2 py-1 font-mono text-[11.5px] font-normal leading-relaxed text-fg-2">{r.text}</span>
          </Item>
        )}
        {r?.sid && (
          <Item label="Departure">
            <Procedure p={r.sid} />
          </Item>
        )}
        {r?.star && (
          <Item label="Arrival">
            <Procedure p={r.star} />
          </Item>
        )}
        {r?.nat && (
          <Item label="Oceanic" mono>
            {otsLabel(r.nat.system)} {r.nat.letter}: <span className="font-mono text-[12px]">{r.nat.text}</span> · FL
            {r.nat.fl} · M{r.nat.mach.toFixed(2).replace(/^0/, '')}
          </Item>
        )}
        {r?.avoids && r.avoids.length > 0 && (
          <Item label="Re-routed">
            Around closed airspace
            <Sub>{r.avoids.join(' · ')}</Sub>
          </Item>
        )}
        {depStand && (
          <Item label={`Stand ${apCode(info.from)}`} mono>
            {depStand}
          </Item>
        )}
        {arrStand && (
          <Item label={`Stand ${apCode(info.canceledTo ?? info.to)}`} mono>
            {arrStand}
          </Item>
        )}
        {info.taxiOut && (
          <Item label="Taxi out" mono>
            {taxiOutText(info.taxiOut)}
            {info.taxiOut.crossings.length > 0 && <Sub>Crossing runway {info.taxiOut.crossings.join(', ')}</Sub>}
          </Item>
        )}
        {info.taxiIn && (
          <Item label="Taxi in" mono>
            {taxiInText(info.taxiIn)}
            {info.taxiIn.crossings.length > 0 && <Sub>Crossing runway {info.taxiIn.crossings.join(', ')}</Sub>}
          </Item>
        )}
        {info.approach && (
          <Item label="Approach" mono>
            {info.approach}
          </Item>
        )}
        <Item label="Wake" mono>
          {info.wake}
          {wake ? ` · ${wake}` : ''}
        </Item>
        {info.days && (
          <Item label="Operates" mono>
            {daysLabel(info.days)}
            <WeekStrip days={info.days} />
            <Sub>
              IATA season {iataSeason(info.std).name} · {info.days.perWeek}× weekly
            </Sub>
          </Item>
        )}
        {info.rotation.length > 1 && (
          <Item label="Rotation">
            <Rotation legs={info.rotation} />
            <Sub>Earlier legs today, this flight, and the next planned leg</Sub>
          </Item>
        )}
        {delays.length > 0 && (
          <Item label="Delays" mono>
            <span className="text-[#ffb547]">{delays.join(' · ')}</span>
          </Item>
        )}
      </dl>
      <p className="border-t border-[var(--line)] py-2 text-[10.5px] leading-snug text-fg-3">
        {r?.sid?.published || r?.star?.published
          ? 'Procedures marked “Published” are the real FAA procedures (public domain); the rest of the flight is simulated.'
          : 'Procedure names and en-route fixes follow real navaids where possible; designators are generated. Simulated.'}
      </p>
    </section>
  );
}
