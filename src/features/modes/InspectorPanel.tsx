import { InspectorIcon } from '@/components/icons';
import { CopyButton } from '@/components/ui/Data';
import { EmptyState } from '@/components/ui/Feedback';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { simFlight } from '@/data/world';
import { useNow, useSelectedTrack } from '@/lib/hooks';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <div className="absolute right-2 top-2">
        <CopyButton text={text} label="Copy JSON" />
      </div>
      <pre className="glass-2 scroll-thin max-h-[42vh] overflow-auto rounded-[14px] p-3 pr-9 font-mono text-[11px] leading-relaxed text-fg-2">{text}</pre>
    </div>
  );
}

/** Developer view of the selected aircraft: the record the map uses and the simulator's flight state. */
export function InspectorPanel() {
  const open = useUI((s) => s.panel === 'inspector');
  const openPanel = useUI((s) => s.openPanel);
  const t = useSelectedTrack();
  useNow(2000);
  const info = t ? simFlight(t.id) : undefined;

  return (
    <Panel open={open} onClose={() => openPanel(t ? 'aircraft' : null)} title="Data inspector" icon={<InspectorIcon size={18} />} ariaLabel="Data inspector" subtitle={t ? `${t.ac.callsign ?? t.id} · the record behind the map` : 'Select an aircraft'}>
      {!t ? (
        <EmptyState icon={<InspectorIcon />} title="No aircraft selected" body="Select an aircraft on the map to inspect its data." />
      ) : (
        <div className="space-y-5 pt-1">
          <Section title="Aircraft record (what the map draws)">
            <Json value={t.ac} />
            <p className="text-[11px] text-fg-3">Units: feet, knots, ft/min, degrees true, epoch milliseconds. Every value is simulated.</p>
          </Section>
          {info && (
            <Section title="Simulated flight state">
              <Json
                value={{
                  flight: info.flight,
                  flightIata: info.flightIata,
                  status: info.status,
                  phase: info.phase,
                  from: info.from.ident,
                  to: info.to.ident,
                  divertedFrom: info.divertedFrom?.ident,
                  canceledTo: info.canceledTo?.ident,
                  scheduledOut: new Date(info.std).toISOString(),
                  scheduledIn: new Date(info.sta).toISOString(),
                  estimatedIn: new Date(info.eta).toISOString(),
                  cruiseFt: info.cruiseFt,
                  progress: Math.round(info.progress * 1000) / 1000,
                  holdMin: info.holdMin,
                  wind: info.wind,
                  codeshares: info.codeshares,
                  standOut: info.gateFrom,
                  standIn: info.gateTo,
                }}
              />
            </Section>
          )}
          <Section title="Rendering state">
            <Json value={{ trailPoints: traffic.trailOf(t).length, firstSeenAtClient: t.firstSeenAt }} />
          </Section>
        </div>
      )}
    </Panel>
  );
}
