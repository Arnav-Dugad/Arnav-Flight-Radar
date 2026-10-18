// Airline page: logo, alliance, hubs, fleet and every flight it is operating right now
// in the simulated world.
import { useState } from 'react';
import { PlaneIcon } from '@/components/icons';
import { Tabs } from '@/components/ui/Data';
import { EmptyState } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { allianceOf, simAirline, useSim } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { flyTo, focusAircraft } from '@/map/controller';
import { useUI } from '@/state/ui';
import { AirlineLogo, AllianceBadge, STATUS_TEXT } from '@/features/aircraft/FlightParts';

type Tab = 'flights' | 'fleet' | 'hubs';

export function AirlinePanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const open = useUI((s) => s.panel === 'airline');
  const icao = useUI((s) => s.selectedAirline);
  const openPanel = useUI((s) => s.openPanel);
  const select = useUI((s) => s.select);
  const selectAirport = useUI((s) => s.selectAirport);
  useNow(5000);
  const [tab, setTab] = useState<Tab>('flights');
  const [filter, setFilter] = useState<'all' | 'air'>('air');
  const info = (open ? simAirline(icao) : undefined);
  const alliance = allianceOf(icao ?? undefined);
  const airborne = info?.flights.filter((f) => f.transmitting && ['En route', 'Holding', 'Approach', 'Diverted', 'Go-around'].includes(f.status)).length ?? 0;
  const flights = info ? (filter === 'air' ? info.flights.filter((f) => f.transmitting) : info.flights) : [];

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
        <EmptyState title="Airline not found" body="This airline is not flying in the simulated world." />
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
                <div className="tnum text-[20px] font-semibold text-fg">{v}</div>
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
              { id: 'fleet', label: 'Fleet' },
              { id: 'hubs', label: 'Hubs' },
            ]}
          />
          {tab === 'flights' && (
            <>
              <div className="flex gap-1.5">
                {(['air', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn('h-7 rounded-full border px-3 text-[11.5px] font-medium', filter === f ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3')}
                  >
                    {f === 'air' ? 'Transmitting now' : 'All flights today'}
                  </button>
                ))}
              </div>
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
                      className="flex w-full items-center gap-3 px-3.5 py-2 text-left enabled:hover:bg-[var(--line)] disabled:cursor-default"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="tnum truncate text-[12.5px] font-semibold text-fg">
                          {f.flightIata ?? f.flight} <span className="font-normal text-fg-2">{f.from.iata ?? f.from.ident} → {f.to.iata ?? f.to.ident}</span>
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
              {flights.length > 80 && <p className="text-[11px] text-fg-3">Showing 80 of {flights.length}.</p>}
            </>
          )}
          {tab === 'fleet' && (
            <ul className="space-y-2">
              {info.fleet.map((f) => (
                <li key={f.type} className="glass-2 rounded-[14px] px-3.5 py-2.5">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-semibold text-fg">{f.desc}</span>
                    <span className="tnum text-fg-2">{f.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line)]">
                    <div className="h-1.5 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.max(3, (f.count / info.fleet[0]!.count) * 100)}%` }} />
                  </div>
                </li>
              ))}
              <li className="text-[11px] text-fg-3">Representative fleet mix for the simulation, sized to the airline&rsquo;s real fleet.</li>
            </ul>
          )}
          {tab === 'hubs' && (
            <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
              {info.hubs.map((h) => (
                <li key={h.ident}>
                  <button
                    type="button"
                    onClick={() => {
                      selectAirport(h.ident);
                      flyTo(h.lon, h.lat, 10.5);
                    }}
                    className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-[var(--line)]"
                  >
                    <span className="text-[12.5px] text-fg">
                      <span className="mr-2 font-semibold text-[var(--accent)]">{h.iata ?? h.ident}</span>
                      {h.name}
                    </span>
                    <span className="text-[11px] text-fg-3">{h.city}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
