import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { InspectorIcon } from '@/components/icons';
import { CopyButton } from '@/components/ui/Data';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { api } from '@/lib/api';
import { useSelectedTrack } from '@/lib/hooks';
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

export function InspectorPanel() {
  const open = useUI((s) => s.panel === 'inspector');
  const openPanel = useUI((s) => s.openPanel);
  const t = useSelectedTrack();
  const [wantRaw, setWantRaw] = useState(false);
  const hex = t?.ac.icao24;
  const raw = useQuery({
    queryKey: ['raw', hex],
    queryFn: ({ signal }) => api.aircraft(hex!, true, signal),
    enabled: open && wantRaw && !!hex && !hex.startsWith('~'),
    staleTime: 10_000,
  });

  return (
    <Panel open={open} onClose={() => openPanel(t ? 'aircraft' : null)} title="Data inspector" icon={<InspectorIcon size={18} />} ariaLabel="Data inspector" subtitle={t ? `${t.ac.callsign ?? t.ac.icao24.toUpperCase()} · normalized and raw fields` : 'Select an aircraft'}>
      {!t ? (
        <EmptyState icon={<InspectorIcon />} title="No aircraft selected" body="Select an aircraft on the map to inspect its data." />
      ) : (
        <div className="space-y-5 pt-1">
          <Section title="Normalized record (what the app uses)">
            <Json value={t.ac} />
            <p className="text-[11px] text-fg-3">Units: feet, knots, ft/min, degrees true, epoch milliseconds. Absent keys mean the provider did not report the value.</p>
          </Section>
          <Section title="Tracking state">
            <Json
              value={{
                positionAgeAtFetchMs: Math.round(t.ageAtFetch),
                fetchedAt: t.fetchedAt,
                lost: t.lost,
                outsideRegion: t.outsideRegion,
                trailPoints: t.trail.length,
                firstSeenAtClient: t.firstSeenAt,
              }}
            />
          </Section>
          <Section title="Raw provider record">
            {!wantRaw ? (
              <div className="space-y-2">
                <p className="text-[12px] text-fg-3">Loading the raw adsb.fi record makes one extra (rate-limited, cached) request.</p>
                <GlassButton size="sm" onClick={() => setWantRaw(true)} disabled={t.ac.icao24.startsWith('~')}>
                  <Download size={14} /> Load raw record
                </GlassButton>
              </div>
            ) : raw.isPending ? (
              <div className="flex items-center gap-2 text-[12px] text-fg-3">
                <Spinner size={14} /> Requesting…
              </div>
            ) : raw.isError ? (
              <ErrorState title="Raw record unavailable" body={(raw.error as Error).message} />
            ) : (
              <>
                <Json value={raw.data.raw ?? []} />
                <p className="text-[11px] text-fg-3">Source: adsb.fi open data (ADSBexchange-v2-compatible fields). Personal, non-commercial use.</p>
              </>
            )}
          </Section>
        </div>
      )}
    </Panel>
  );
}
