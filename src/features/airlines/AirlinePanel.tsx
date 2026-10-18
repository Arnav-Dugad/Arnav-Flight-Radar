// Airline page: logo, alliance, hubs, fleet, its weekly route pattern and every flight it
// is operating right now in the simulated world.
import { useState } from 'react';
import { PlaneIcon } from '@/components/icons';
import { Tabs } from '@/components/ui/Data';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { daysLabel, WEEKDAYS } from '@/data/sim/schedule';
import { allianceOf, simAirline, simNow, useSim } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { flyTo, focusAircraft } from '@/map/controller';
import { useUI } from '@/state/ui';
import { AirlineLogo, AllianceBadge, STATUS_TEXT } from '@/features/aircraft/FlightParts';
import { MON_FIRST, routeWeek, weekCounts } from './routeWeek';
import { WeekChart } from './WeekChart';

type Tab = 'flights' | 'week' | 'fleet' | 'hubs';
const AIRBORNE = ['En route', 'Holding', 'Approach', 'Diverted', 'Go-around'];
const apCode = (a: { iata?: string; ident: string }) => a.iata ?? a.ident;

function Loading() {
  return (
    <div className="space-y-4 pt-1" aria-busy="true" aria-label="Loading airline">
      <div className="flex items-center gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-[62px]" />
        <Skeleton className="h-[62px]" />
        <Skeleton className="h-[62px]" />
      </div>
      <Skeleton className="h-9" />
      <Skeleton className="h-64" />
    </div>
  );
}

/** Mon–Sun cells for a route's days of operation. */
function DayDots({ mask }: { mask: number }) {
  return (
    <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
      {MON_FIRST.map((d) => {
        const on = ((mask >> d) & 1) === 1;
        return (
          <span key={d} className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[9px] font-semibold', on ? 'bg-[color-mix(in_srgb,var(--viz-1)_24%,transparent)] text-fg' : 'bg-[var(--line)] text-fg-3 opacity-55')}>
            {WEEKDAYS[d]!.charAt(0)}
          </span>
        );
      })}
    </span>
  );
}

export function AirlinePanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const simLoading = useSim((s) => s.loading);
  const open = useUI((s) => s.panel === 'airline');
  const icao = useUI((s) => s.selectedAirline);
  const openPanel = useUI((s) => s.openPanel);
  const select = useUI((s) => s.select);
  const selectAirport = useUI((s) => s.selectAirport);
  const now = useNow(2500);
  const [tab, setTab] = useState<Tab>('flights');
  const [filter, setFilter] = useState<'all' | 'air'>('air');
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  // When the panel opens for an airline, give the simulation worker a moment to answer
  // before saying the airline is not flying.
  const [asked, setAsked] = useState<{ icao: string | null; at: number }>({ icao: null, at: 0 });
  if (open && asked.icao !== icao) setAsked({ icao, at: Date.now() });
  const info = open ? simAirline(icao) : undefined;
  const pending = !info && (simLoading || now - asked.at < 4000);
  const alliance = allianceOf(icao ?? undefined);
  const airborne = info?.flights.filter((f) => f.transmitting && AIRBORNE.includes(f.status)).length ?? 0;
  const flights = info ? (filter === 'air' ? info.flights.filter((f) => f.transmitting) : info.flights) : [];
  const routes = info && tab === 'week' ? routeWeek(info).sort((a, b) => a.days.perWeek - b.days.perWeek || apCode(a.from).localeCompare(apCode(b.from)) || apCode(a.to).localeCompare(apCode(b.to))) : [];
  const counts = weekCounts(routes);
  const dailyN = routes.filter((r) => r.days.perWeek === 7).length;
  const weekly = routes.reduce((a, r) => a + r.days.perWeek, 0);
  const today = new Date(simNow()).getUTCDay();
  const shownRoutes = showAllRoutes ? routes : routes.slice(0, 30);

  return (
    <Panel
      open={open}
      onClose={() => openPanel(null)}
      title={info?.profile.name ?? 'Airline'}
      icon={info ? <AirlineLogo icao={info.profile.icao} code={info.profile.iata} size={26} name={info.profile.name} /> : <PlaneIcon size={18} />}
      ariaLabel="Airline details"
      subtitle={info ? `${info.profile.iata} · ${info.profile.icao} · ${info.profile.country}` : undefined}
    >
      {!info ? (
        pending ? (
          <Loading />
        ) : (
          <EmptyState title="Airline not found" body="This airline is not flying in the simulated world right now." />
        )
      ) : (
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <AirlineLogo icao={info.profile.icao} code={info.profile.iata} size={44} name={info.profile.name} wide />
            {alliance && <AllianceBadge name={alliance} />}
            <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">Simulated fleet</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Airborne now', airborne],
              ['Aircraft', info.airframes],
              ['Hubs', info.hubs.length],
            ].map(([l, v]) => (
              <div key={l} className="glass-2 rounded-[14px] px-1.5 py-2.5">
                <div className="tnum text-[20px] font-semibold leading-tight text-fg">{v}</div>
                <div className="mt-0.5 text-[10.5px] text-fg-3">{l}</div>
              </div>
            ))}
          </div>
          <Tabs
            label="Airline information"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'flights', label: 'Flights' },
              { id: 'week', label: 'Week' },
              { id: 'fleet', label: 'Fleet' },
              { id: 'hubs', label: 'Hubs' },
            ]}
          />
          {tab === 'flights' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(['air', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn('h-8 rounded-full border px-3 text-[11.5px] font-medium', filter === f ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3 hover:text-fg-2')}
                  >
                    {f === 'air' ? 'Transmitting now' : 'All flights today'}
                  </button>
                ))}
              </div>
              {flights.length === 0 ? (
                <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">
                  {filter === 'air' ? 'None of this airline’s simulated aircraft are transmitting right now.' : 'No flights in today’s simulated schedule.'}
                </p>
              ) : (
                <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                  {flights.slice(0, 80).map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        disabled={!f.transmitting}
                        onClick={() => {
                          select(f.id);
                          focusAircraft(f.id, 8);
                        }}
                        className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left enabled:hover:bg-[var(--line)] disabled:cursor-default"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="tnum truncate text-[12.5px] font-semibold text-fg">
                            {f.flightIata ?? f.flight} <span className="font-normal text-fg-2">{apCode(f.from)} → {apCode(f.to)}</span>
                          </div>
                          <div className="tnum truncate text-[10.5px] text-fg-3">
                            {f.type} · {f.reg}
                          </div>
                        </div>
                        <span className={cn('shrink-0 text-[11px] font-semibold', STATUS_TEXT[f.status])}>{f.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {flights.length > 80 && <p className="text-[11px] text-fg-3">Showing 80 of {flights.length}.</p>}
            </>
          )}
          {tab === 'week' &&
            (routes.length === 0 ? (
              <EmptyState title="No scheduled routes" body="This airline has no scheduled passenger or cargo routes in today’s simulation." />
            ) : (
              <>
                <section className="glass-2 rounded-[16px] px-3.5 pb-3 pt-3">
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <h3 className="eyebrow">Routes by day of week</h3>
                    <span className="text-[10.5px] text-fg-3">simulated timetable</span>
                  </div>
                  <p className="tnum mb-2.5 text-[12px] text-fg-2">
                    {routes.length} routes · {dailyN === routes.length ? 'all' : dailyN} daily · {weekly.toLocaleString()} flights a week each way
                  </p>
                  <WeekChart data={counts} today={today} />
                </section>
                <section>
                  <h3 className="eyebrow mb-1.5 px-0.5">Days of operation</h3>
                  <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                    {shownRoutes.map((r) => (
                      <li key={r.key} className="flex items-center justify-between gap-2 px-3.5 py-2">
                        <div className="min-w-0">
                          <div className="tnum truncate text-[12.5px] font-semibold text-fg">
                            {apCode(r.from)} – {apCode(r.to)}
                          </div>
                          <div className="truncate text-[10.5px] text-fg-3">
                            {daysLabel(r.days)}
                            {r.days.perWeek < 7 && ` · ${r.days.perWeek}× weekly`}
                          </div>
                        </div>
                        <span className="sr-only">Operates {daysLabel(r.days)}</span>
                        <DayDots mask={r.days.mask} />
                      </li>
                    ))}
                  </ul>
                  {routes.length > 30 && (
                    <button type="button" onClick={() => setShowAllRoutes((v) => !v)} aria-expanded={showAllRoutes} className="mx-auto mt-2 flex h-8 items-center rounded-full border border-[var(--line)] px-3.5 text-[11.5px] font-medium text-fg-2 hover:text-fg">
                      {showAllRoutes ? 'Show fewer routes' : `Show all ${routes.length} routes`}
                    </button>
                  )}
                  <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-fg-3">
                    From the routes this airline flies in today&rsquo;s simulation; trunk and hub routes run daily, thinner and leisure routes on fixed weekdays. Not a real timetable.
                  </p>
                </section>
              </>
            ))}
          {tab === 'fleet' && (
            <ul className="space-y-2">
              {info.fleet.map((f) => (
                <li key={f.type} className="glass-2 rounded-[14px] px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate font-semibold text-fg">{f.desc}</span>
                    <span className="tnum shrink-0 text-fg-2">{f.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--viz-grid)]">
                    <div className="h-1.5 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.max(3, (f.count / info.fleet[0]!.count) * 100)}%` }} />
                  </div>
                </li>
              ))}
              <li className="px-0.5 text-[11px] text-fg-3">Representative fleet mix for the simulation, sized to the airline&rsquo;s real fleet.</li>
            </ul>
          )}
          {tab === 'hubs' &&
            (info.hubs.length === 0 ? (
              <EmptyState title="No hubs listed" body="This airline has no hub airports in the simulation data." />
            ) : (
              <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                {info.hubs.map((h) => (
                  <li key={h.ident}>
                    <button
                      type="button"
                      onClick={() => {
                        selectAirport(h.ident);
                        flyTo(h.lon, h.lat, 10.5);
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--line)]"
                    >
                      <span className="min-w-0 truncate text-[12.5px] text-fg">
                        <span className="mr-2 font-semibold text-[var(--accent)]">{apCode(h)}</span>
                        {h.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-fg-3">{h.city}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </Panel>
  );
}
