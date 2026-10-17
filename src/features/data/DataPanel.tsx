import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { DataIcon } from '@/components/icons';
import { BarList } from '@/components/ui/Charts';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Row, Rows } from '@/components/ui/Data';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { useFeed } from '@/data/feed';
import { api } from '@/lib/api';
import { fmtAge, fmtAgo } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { flyTo } from '@/map/controller';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

const STATUS_TONE = { ok: 'ok', degraded: 'warn', down: 'danger', unknown: 'neutral' } as const;

export function DataPanel() {
  const open = useUI((s) => s.panel === 'data');
  const openPanel = useUI((s) => s.openPanel);
  const now = useNow(1000);
  useTrafficVersion();
  const feed = useFeed();
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), enabled: open, refetchInterval: open ? 30_000 : false });
  const providers = useQuery({ queryKey: ['providers'], queryFn: ({ signal }) => api.providers(signal), enabled: open, staleTime: Infinity });
  const meta = traffic.meta;

  const quality = useMemo(() => {
    const list = traffic.current();
    const n = list.length || 1;
    const has = (f: (a: (typeof list)[number]) => unknown) => list.filter((a) => f(a) !== undefined).length;
    return {
      n: list.length,
      rows: [
        { key: 'cs', label: 'Callsign', value: has((a) => a.callsign) },
        { key: 'reg', label: 'Registration', value: has((a) => a.registration) },
        { key: 'type', label: 'Type code', value: has((a) => a.aircraftType) },
        { key: 'alt', label: 'Altitude', value: list.filter((a) => a.onGround || a.altitudeBarometric !== undefined || a.altitudeGeometric !== undefined).length },
        { key: 'gs', label: 'Ground speed', value: has((a) => a.groundSpeed) },
        { key: 'trk', label: 'Track', value: has((a) => a.track) },
        { key: 'vr', label: 'Vertical rate', value: has((a) => a.verticalRate) },
        { key: 'sq', label: 'Squawk', value: has((a) => a.squawk) },
      ].map((r) => ({ ...r, total: n })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traffic.version]);

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Data & coverage" icon={<DataIcon size={18} />} ariaLabel="Data sources and coverage" subtitle="Where every number on this map comes from">
      <div className="space-y-6 pt-1">
        <Section title="Live feed">
          <Rows>
            <Row label="Status" value={<Badge tone={feed.status === 'live' ? 'ok' : feed.status === 'degraded' ? 'warn' : feed.status === 'error' ? 'danger' : 'neutral'}>{feed.status}</Badge>} />
            {feed.message && <Row label="Note" value={feed.message} />}
            <Row label="Live area" value={meta ? `${meta.region.radiusNm} NM around ${meta.region.lat.toFixed(3)}, ${meta.region.lon.toFixed(3)}` : undefined} mono />
            <Row label="Snapshot age" value={meta ? fmtAge(traffic.serverNow(now) - meta.fetchedAt) : undefined} mono />
            <Row label="Shared snapshot" value={meta ? (meta.cacheHit ? `Yes — fetched ${fmtAge(meta.cacheAgeMs)} before your request` : 'No — freshly fetched for you') : undefined} />
            <Row label="Aircraft in snapshot" value={meta ? String(meta.count) : undefined} mono />
            <Row label="Next refresh" value={feed.nextAt ? (feed.nextAt > now ? `in ${Math.ceil((feed.nextAt - now) / 1000)} s` : 'now') : undefined} mono />
            <Row label="Requests from this tab" value={String(feed.requests)} mono />
            <Row label="Clock offset vs server" value={`${Math.round(traffic.clockOffset)} ms`} mono hint="Ages are computed on the server clock, so a wrong device clock cannot make data look fresher." />
          </Rows>
          {feed.viewportClipped && (
            <p className="rounded-[12px] border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] px-3 py-2 text-[12px] text-[#ffd59a]">
              Your view is wider than the provider’s 250 NM query radius. Only the outlined area is live; the rest of the world is not being tracked right now.
            </p>
          )}
        </Section>

        <Section title="Provider health (global coordinator)">
          {health.isPending ? (
            <Skeleton className="h-24 rounded-[16px]" />
          ) : health.isError ? (
            <ErrorState title="Health check failed" body={(health.error as Error).message} />
          ) : (
            <div className="space-y-2">
              {health.data.providers.map((p) => (
                <div key={p.id} className="glass-2 rounded-[14px] px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-fg">{p.id === 'adsbfi' ? 'adsb.fi' : 'AviationWeather.gov'}</span>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </div>
                  <div className="tnum mt-1 text-[11.5px] text-fg-3">
                    {p.upstreamCalls} upstream calls · {p.cacheHits} cache hits since coordinator start
                    {p.lastSuccessAt && ` · last success ${fmtAgo(now - p.lastSuccessAt)}`}
                    {p.lastError && ` · last error: ${p.lastError}`}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-fg-3">One Durable Object paces every upstream request worldwide (adsb.fi ≥ 1.1 s apart), coalesces duplicates and serves shared snapshots.</p>
            </div>
          )}
        </Section>

        <Section title="Data completeness (current sample)">
          {quality.n === 0 ? (
            <p className="text-[12px] text-fg-3">No aircraft in the current sample.</p>
          ) : (
            <BarList data={quality.rows} total={quality.n} valueLabel={(d) => `${d.value}/${quality.n}`} />
          )}
          <p className="text-[11px] text-fg-3">Missing fields are shown as “Not available” — never filled with guesses.</p>
        </Section>

        <Section title="Areas queried this session">
          {traffic.regionsQueried.length === 0 ? (
            <p className="text-[12px] text-fg-3">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {[...traffic.regionsQueried].reverse().map((r, i) => (
                <li key={`${r.region.lat},${r.region.lon},${r.region.radiusNm}`}>
                  <button type="button" onClick={() => flyTo(r.region.lon, r.region.lat, 7)} className="tnum flex w-full items-center justify-between rounded-[10px] px-3 py-1.5 text-left text-[12px] hover:bg-[var(--line)]">
                    <span className="text-fg-2">
                      {i === 0 ? 'Current · ' : ''}
                      {r.region.radiusNm} NM @ {r.region.lat.toFixed(2)}, {r.region.lon.toFixed(2)}
                    </span>
                    <span className="text-fg-3">{fmtAgo(now - r.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Sources, licences & limits">
          {providers.isPending ? (
            <Skeleton className="h-40 rounded-[16px]" />
          ) : providers.isError ? (
            <ErrorState title="Could not load provider list" body={(providers.error as Error).message} />
          ) : (
            <div className="space-y-2">
              {providers.data.providers.map((p) => (
                <div key={p.id} className="glass-2 rounded-[14px] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <a href={p.attribution.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-fg hover:text-[var(--accent)]">
                      {p.name} <ExternalLink size={11} />
                    </a>
                    <Badge tone={p.enabled ? 'ok' : 'neutral'}>{p.enabled ? 'In use' : 'Not used'}</Badge>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-2">{p.scope}</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
                    <span className="text-fg-2">Limits:</span> {p.limits}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
                    <span className="text-fg-2">Terms:</span> {p.terms} · {p.attribution.license}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Panel>
  );
}
