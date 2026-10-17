import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { AIRPORT_TYPE_LABEL, searchAirports } from '@shared/airports';
import type { AirportIndexEntry, AirportType } from '@shared/types';
import { AirportIcon, GlobeIcon } from '@/components/icons';
import { Chip, SegmentedControl, TextField } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { HUBS, airportByCode, loadAllAirports, loadCountries, loadMajorAirports } from '@/data/airports';
import { fitBounds, flyTo } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useUI } from '@/state/ui';
import { useView } from '@/state/view';

type Mode = 'explore' | 'countries';

export function AirportsBrowser() {
  const open = useUI((s) => s.panel === 'airports');
  const openPanel = useUI((s) => s.openPanel);
  const [mode, setMode] = useState<Mode>('explore');
  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Airports" icon={<AirportIcon size={18} />} ariaLabel="Airport explorer" subtitle="20,000+ airports from OurAirports">
      <div className="space-y-5 pt-1">
        <SegmentedControl
          label="Airport explorer view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'explore', label: 'Explore' },
            { value: 'countries', label: 'Countries' },
          ]}
        />
        {mode === 'explore' ? <Explore /> : <Countries />}
      </div>
    </Panel>
  );
}

function useGoAirport() {
  const selectAirport = useUI((s) => s.selectAirport);
  const addRecent = useBookmarks((s) => s.addRecent);
  return (a: AirportIndexEntry) => {
    addRecent({ kind: 'airport', id: a.ident, label: a.iata ? `${a.iata} · ${a.name}` : a.name, sub: [a.city, a.country].filter(Boolean).join(', '), lat: a.lat, lon: a.lon });
    selectAirport(a.ident);
    flyTo(a.lon, a.lat, a.type === 'large_airport' ? 10.5 : 11.5);
  };
}

function AirportRow({ a, onClick }: { a: AirportIndexEntry; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--line)]">
      <span className="tnum w-11 shrink-0 text-[13px] font-semibold text-[var(--accent)]">{a.iata ?? '—'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{a.name}</span>
        <span className="block truncate text-[11.5px] text-fg-3">
          {[a.icao ?? a.ident, a.city, a.country].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-[10.5px] text-fg-3">{AIRPORT_TYPE_LABEL[a.type].replace(' airport', '')}</span>
    </button>
  );
}

function Explore() {
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<AirportType[]>([]);
  const go = useGoAirport();
  const favs = useBookmarks((s) => s.airports);
  const zoom = useView((s) => s.zoom);
  const lat = useView((s) => s.lat);
  const lon = useView((s) => s.lon);
  const major = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
  const all = useQuery({ queryKey: ['all-airports'], queryFn: loadAllAirports, staleTime: Infinity, enabled: q.trim().length >= 2 });
  const list = all.data ?? major.data;

  const results = useMemo(() => (list && q.trim().length >= 2 ? searchAirports(list, q, { limit: 30, types: types.length ? types : undefined }) : []), [list, q, types]);

  // Airports around the current map centre (rough box scaled by zoom).
  const inView = useMemo(() => {
    if (!major.data) return [];
    const span = 180 / 2 ** Math.max(0, zoom - 1);
    return major.data
      .filter((a) => Math.abs(a.lat - lat) < span * 0.6 && Math.abs(a.lon - lon) < span)
      .sort((a, b) => (a.type === b.type ? Number(b.scheduled) - Number(a.scheduled) : a.type === 'large_airport' ? -1 : b.type === 'large_airport' ? 1 : 0))
      .slice(0, 12);
  }, [major.data, zoom, lat, lon]);

  return (
    <div className="space-y-5">
      <TextField label="Search airports" value={q} onChange={setQ} placeholder="IATA, ICAO, name or city" icon={<Search size={14} />} />
      <div className="flex flex-wrap gap-1.5">
        {(['large_airport', 'medium_airport', 'small_airport', 'heliport'] as AirportType[]).map((t) => (
          <Chip key={t} active={types.includes(t)} onClick={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
            {AIRPORT_TYPE_LABEL[t]}
          </Chip>
        ))}
      </div>

      {q.trim().length >= 2 ? (
        <Section title={all.isFetching ? 'Searching all airports…' : `Results (${results.length})`}>
          {results.length ? (
            <div className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
              {results.map((a) => (
                <AirportRow key={a.ident} a={a} onClick={() => go(a)} />
              ))}
            </div>
          ) : (
            <EmptyState title="No airports match" body="Try a code (DXB), a name (Heathrow) or a city (Mumbai)." />
          )}
        </Section>
      ) : (
        <>
          <Section title="Featured hubs">
            {!major.data ? (
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-[14px]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {HUBS.map((h, i) => {
                  const a = airportByCode(h.ident);
                  if (!a) return null;
                  return (
                    <motion.button
                      key={h.ident}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.025 }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => go(a)}
                      className="glass-2 rounded-[14px] px-3 py-2.5 text-left hover:border-[var(--line-strong)]"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-[13px] font-semibold text-fg">{h.city}</span>
                        <span className="tnum text-[12px] font-semibold text-[var(--accent)]">{a.iata}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-fg-3">{a.name}</div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </Section>

          {favs.length > 0 && (
            <Section title="Favourite airports">
              <div className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                {favs.map((id) => {
                  const a = airportByCode(id);
                  return a ? <AirportRow key={id} a={a} onClick={() => go(a)} /> : null;
                })}
              </div>
            </Section>
          )}

          <Section title="Around the map centre">
            {inView.length ? (
              <div className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                {inView.map((a) => (
                  <AirportRow key={a.ident} a={a} onClick={() => go(a)} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-fg-3">No major airports near the map centre.</p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Countries() {
  const [q, setQ] = useState('');
  const countries = useQuery({ queryKey: ['countries'], queryFn: loadCountries, staleTime: Infinity });
  const addRecent = useBookmarks((s) => s.addRecent);
  const [continent, setContinent] = useState<string>('all');
  const list = (countries.data ?? []).filter((c) => (continent === 'all' || c.continent === continent) && c.name.toLowerCase().includes(q.toLowerCase()));
  const CONT: [string, string][] = [
    ['all', 'All'],
    ['EU', 'Europe'],
    ['AS', 'Asia'],
    ['NA', 'N. America'],
    ['SA', 'S. America'],
    ['AF', 'Africa'],
    ['OC', 'Oceania'],
  ];
  return (
    <div className="space-y-4">
      <TextField label="Find a country" value={q} onChange={setQ} placeholder="e.g. Japan" icon={<Search size={14} />} />
      <div className="flex flex-wrap gap-1.5">
        {CONT.map(([id, l]) => (
          <Chip key={id} active={continent === id} onClick={() => setContinent(id)}>
            {l}
          </Chip>
        ))}
      </div>
      {countries.isPending ? (
        <Skeleton className="h-40 rounded-[16px]" />
      ) : (
        <div className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
          {list.slice(0, 80).map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => {
                addRecent({ kind: 'country', id: c.code, label: c.name, lat: c.lat, lon: c.lon });
                fitBounds(...c.bbox);
              }}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--line)]"
            >
              <GlobeIcon size={16} className="shrink-0 text-fg-3" />
              <span className="flex-1 truncate text-[13px] text-fg">{c.name}</span>
              <span className="tnum text-[11px] font-semibold text-fg-3">{c.code}</span>
            </button>
          ))}
          {list.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-fg-3">No countries match.</p>}
        </div>
      )}
      <p className="text-[11px] text-fg-3">Country extents are computed from their airports in the OurAirports dataset.</p>
    </div>
  );
}
