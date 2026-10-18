// "Right now" widgets in the spirit of a commercial flight tracker: busiest airports,
// disruption index, and notable flights — all computed from the simulated world.
import { useMemo } from 'react';
import { AnalyticsIcon } from '@/components/icons';
import { Section } from '@/components/ui/Glass';
import { Skeleton } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { simWidgets, useSim, type NotableFlight } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtAltitude, fmtSpeed } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { flyTo, focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';

const DISRUPTION = ['#3ddc97', '#9be15d', '#ffd166', '#ffb547', '#ff8a5c', '#ff5d73'];
export const disruptionColor = (v: number) => DISRUPTION[Math.min(5, Math.max(0, Math.round(v)))]!;

export function WidgetsPanel() {
  const open = useUI((s) => s.panel === 'widgets');
  const openPanel = useUI((s) => s.openPanel);
  const selectAirport = useUI((s) => s.selectAirport);
  const select = useUI((s) => s.select);
  const loading = useSim((s) => s.loading);
  const airborne = useSim((s) => s.airborne);
  const units = useSettings((s) => s.units);
  const now = useNow(10_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const w = useMemo(() => (open && !loading ? simWidgets() : undefined), [open, loading, Math.floor(now / 10_000)]);
  const busiest = w ? [...w.airports].sort((a, b) => b.movements - a.movements).slice(0, 10) : [];
  const disrupted = w ? [...w.airports].filter((a) => a.disruption > 0.2).sort((a, b) => b.disruption - a.disruption).slice(0, 8) : [];

  const openAirport = (ident: string, lon: number, lat: number) => {
    selectAirport(ident);
    flyTo(lon, lat, 10);
  };
  const openFlight = (f: NotableFlight) => {
    select(f.id);
    focusAircraft(f.id, 7);
  };
  const flightList = (list: NotableFlight[], fmt: (v: number) => string) => (
    <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
      {list.map((f, i) => (
        <li key={f.id}>
          <button type="button" onClick={() => openFlight(f)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
            <span className="tnum w-4 text-[11px] text-fg-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
              <span className="font-semibold">{f.flight}</span>{' '}
              <span className="text-fg-2">
                {f.from.iata ?? f.from.ident} → {f.to.iata ?? f.to.ident} · {f.type}
              </span>
            </span>
            <span className="tnum shrink-0 text-[12px] font-semibold text-fg">{fmt(f.value)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Right now" icon={<AnalyticsIcon size={18} />} ariaLabel="World activity widgets" subtitle="Busiest airports, disruptions and notable flights in the simulated world">
      {!w ? (
        <div className="space-y-3 pt-1">
          <Skeleton className="h-24 rounded-[16px]" />
          <Skeleton className="h-64 rounded-[16px]" />
        </div>
      ) : (
        <div className="space-y-6 pt-1">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="glass-2 rounded-[14px] px-2 py-3">
              <div className="tnum text-[24px] font-semibold text-fg">{airborne.toLocaleString()}</div>
              <div className="text-[10.5px] text-fg-3">aircraft flying</div>
            </div>
            <div className="glass-2 rounded-[14px] px-2 py-3">
              <div className="tnum text-[24px] font-semibold text-fg">{w.airports.reduce((s, a) => s + a.movements, 0).toLocaleString()}</div>
              <div className="text-[10.5px] text-fg-3">take-offs &amp; landings, last hour</div>
            </div>
          </div>

          <Section title="Busiest airports (last hour)">
            <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
              {busiest.map((a, i) => (
                <li key={a.airport.ident}>
                  <button type="button" onClick={() => openAirport(a.airport.ident, a.airport.lon, a.airport.lat)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                    <span className="tnum w-4 text-[11px] text-fg-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                      <span className="mr-1.5 font-semibold text-[var(--accent)]">{a.airport.iata ?? a.airport.ident}</span>
                      {a.airport.city ?? a.airport.name}
                    </span>
                    <span className="tnum shrink-0 text-[11.5px] text-fg-2">
                      ↓{a.arrivals} ↑{a.departures}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Airport disruptions">
            {disrupted.length === 0 ? (
              <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">Operations are running smoothly everywhere.</p>
            ) : (
              <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                {disrupted.map((a) => (
                  <li key={a.airport.ident}>
                    <button type="button" onClick={() => openAirport(a.airport.ident, a.airport.lon, a.airport.lat)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                      <span className="tnum grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-bold text-[#04101c]" style={{ background: disruptionColor(a.disruption) }}>
                        {a.disruption.toFixed(1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-fg">
                          <span className="mr-1.5 font-semibold">{a.airport.iata ?? a.airport.ident}</span>
                          {a.airport.city ?? a.airport.name}
                        </span>
                        <span className={cn('block truncate text-[11px] text-fg-3')}>
                          {[a.avgDelayMin > 0 && `avg delay ${a.avgDelayMin} min`, a.holding > 0 && `${a.holding} holding`, a.diverted > 0 && `${a.diverted} diverted`, a.canceled > 0 && `${a.canceled} canceled`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-fg-3">Disruption index 0–5 from delays, holding, diversions and cancellations over the last hour. Real METAR weather drives much of it.</p>
          </Section>

          <Section title="Longest flights in the air">{flightList(w.longest, (v) => `${Math.round(v).toLocaleString()} NM`)}</Section>
          <Section title="Fastest ground speed (jet streams)">{flightList(w.fastest, (v) => fmtSpeed(v, units.speed))}</Section>
          <Section title="Highest">{flightList(w.highest, (v) => fmtAltitude(v, units.altitude))}</Section>
        </div>
      )}
    </Panel>
  );
}
