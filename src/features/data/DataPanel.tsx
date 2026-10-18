import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { DataIcon } from '@/components/icons';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Row, Rows } from '@/components/ui/Data';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { simStats, useSim } from '@/data/world';
import { api } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import { useUI } from '@/state/ui';

/** About the simulation: what is simulated, what is real, and every data source. */
export function DataPanel() {
  const open = useUI((s) => s.panel === 'data');
  const openPanel = useUI((s) => s.openPanel);
  useNow(5000);
  const speed = useSim((s) => s.speed);
  const stats = open ? simStats() : undefined;
  const providers = useQuery({ queryKey: ['providers'], queryFn: ({ signal }) => api.providers(signal), enabled: open, staleTime: Infinity });

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="About & data" icon={<DataIcon size={18} />} ariaLabel="About the simulation and its data sources" subtitle="What is simulated, what is real, and where it comes from">
      <div className="space-y-6 pt-1">
        <Section title="A simulated world">
          <div className="glass-2 space-y-2 rounded-[16px] px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
            <p>
              Every aircraft on this map is <strong className="text-fg">simulated</strong>. Real airlines fly real aircraft types between real airports on great-circle routes,
              gate to gate. That includes stands, taxiing, departure queues, winds aloft, holding, diversions, approaches and landings.
            </p>
            <p>
              Flights, flight numbers, registrations, schedules and positions are <strong className="text-fg">invented</strong>. Use this site to explore how air traffic works,
              not to track a real flight.
            </p>
            <p>
              <strong className="text-fg">Real inputs:</strong> airports and runways (OurAirports), airline names (OpenFlights), live weather (NOAA METAR/TAF) that sets the
              runway in use and capacity, precipitation radar (RainViewer), airspace (FAA, openAIP), stands and taxiways (OpenStreetMap), and logos and photos from Wikimedia
              Commons.
            </p>
          </div>
        </Section>

        {stats && (
          <Section title="The world right now">
            <Rows>
              <Row label="Aircraft airborne" value={stats.airborne.toLocaleString()} mono />
              <Row label="Aircraft on the ground (transmitting)" value={stats.ground.toLocaleString()} mono />
              <Row label="Airframes in the world" value={stats.airframes.toLocaleString()} mono />
              <Row label="Airlines flying" value={stats.airlines.toLocaleString()} mono />
              <Row label="Airports served" value={stats.airports.toLocaleString()} mono />
              <Row label="Airports with real stands & taxiways" value={stats.groundAirports.toLocaleString()} mono />
              <Row label="Airports using live weather" value={stats.metarAirports.toLocaleString()} mono />
              <Row label="Holding right now" value={stats.holding.toLocaleString()} mono />
              <Row label="Diverted today" value={stats.diverted.toLocaleString()} mono />
              <Row label="Clock speed" value={`${speed}×`} mono />
            </Rows>
          </Section>
        )}

        <Section title="Sources, licences & limits">
          {providers.isPending ? (
            <Skeleton className="h-40 rounded-[16px]" />
          ) : providers.isError ? (
            <ErrorState title="Could not load the source list" body={(providers.error as Error).message} />
          ) : (
            <div className="space-y-2">
              {providers.data.providers
                .filter((p) => p.enabled)
                .map((p) => (
                  <div key={p.id} className="glass-2 rounded-[14px] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <a href={p.attribution.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-fg hover:text-[var(--accent)]">
                        {p.name} <ExternalLink size={11} />
                      </a>
                      <Badge tone="ok">{p.attribution.license}</Badge>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-2">{p.scope}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
                      <span className="text-fg-2">Terms:</span> {p.terms}
                    </p>
                  </div>
                ))}
            </div>
          )}
          <GlassButton size="sm" onClick={() => openPanel('credits')}>
            Image credits (every logo and photo)
          </GlassButton>
        </Section>
      </div>
    </Panel>
  );
}
