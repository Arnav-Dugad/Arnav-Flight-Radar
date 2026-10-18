// Every logo and photo shown on the site, with its author, licence and a link to the
// file on Wikimedia Commons.
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataIcon } from '@/components/icons';
import { Tabs } from '@/components/ui/Data';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { cleanTitle, loadMedia } from '@/data/media';
import { useUI } from '@/state/ui';

type Kind = 'logos' | 'liveries' | 'types';
const LIMIT = 150;

export function CreditsPanel() {
  const open = useUI((s) => s.panel === 'credits');
  const openPanel = useUI((s) => s.openPanel);
  const [kind, setKind] = useState<Kind>('logos');
  const [q, setQ] = useState('');
  const media = useQuery({ queryKey: ['media'], queryFn: loadMedia, staleTime: Infinity, enabled: open });
  const rows = useMemo(() => {
    const table = media.data?.[kind] ?? {};
    const needle = q.trim().toLowerCase();
    return Object.entries(table)
      .map(([key, r]) => ({ key, title: r[1], caption: cleanTitle(r[1]), license: r[2], artist: r[3] }))
      .filter((r) => !needle || `${r.key} ${r.caption} ${r.artist} ${r.license}`.toLowerCase().includes(needle))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [media.data, kind, q]);
  const counts = media.data ? { logos: Object.keys(media.data.logos).length, liveries: Object.keys(media.data.liveries).length, types: Object.keys(media.data.types).length } : null;

  return (
    <Panel open={open} onClose={() => openPanel('data')} title="Image credits" icon={<DataIcon size={18} />} ariaLabel="Image credits" subtitle="Every logo and photo, with its author and licence">
      <div className="space-y-4 pt-1">
        <p className="text-[12px] leading-relaxed text-fg-3">
          All images come from Wikimedia Commons, which only hosts freely licensed or public-domain files. Airline logos are trademarks of their owners and identify the
          operator only. Photos show real aircraft of the same type (and, where available, the same airline) — never the simulated flight itself.
        </p>
        <Tabs
          label="Image type"
          value={kind}
          onChange={setKind}
          tabs={[
            { id: 'logos', label: `Logos${counts ? ` (${counts.logos})` : ''}` },
            { id: 'liveries', label: `Liveries${counts ? ` (${counts.liveries})` : ''}` },
            { id: 'types', label: `Types${counts ? ` (${counts.types})` : ''}` },
          ]}
        />
        <label className="glass-2 flex h-10 items-center gap-2 rounded-[12px] px-3">
          <Search size={15} className="text-fg-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by airline, aircraft, author or licence" aria-label="Filter credits" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3" />
        </label>
        {media.isPending ? (
          <Skeleton className="h-64 rounded-[16px]" />
        ) : media.isError ? (
          <ErrorState title="Credits unavailable" body={(media.error as Error).message} />
        ) : (
          <>
            <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
              {rows.slice(0, LIMIT).map((r) => (
                <li key={r.key} className="px-3.5 py-2">
                  <a
                    href={`https://commons.wikimedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_')).replace(/%3A/gi, ':')}`}
                    target="_blank"
                    rel="noopener"
                    className="group flex items-start gap-2"
                  >
                    <span className="tnum w-[72px] shrink-0 pt-0.5 text-[11px] font-semibold text-fg-2">{r.key.replace('|', ' · ')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-fg group-hover:text-[var(--accent)]">{r.caption}</span>
                      <span className="block truncate text-[11px] text-fg-3">
                        {r.artist ? `${r.artist} · ` : ''}
                        {r.license}
                      </span>
                    </span>
                    <ExternalLink size={12} className="mt-1 shrink-0 text-fg-3" />
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-fg-3">
              {rows.length > LIMIT ? `Showing ${LIMIT} of ${rows.length} — filter to narrow down.` : `${rows.length} files.`} Data: Wikidata (CC0) and Wikimedia Commons.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
