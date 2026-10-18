import { ArrowRight, Clock, CornerDownLeft, MapPin, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { searchAirports, type SearchableAirport } from '@shared/airports';
import { classifyAircraft } from '@shared/classify';
import { formatLatLon, parseCoordinates } from '@shared/geo';
import type { Aircraft, AirportIndexEntry, Country } from '@shared/types';
import { AircraftGlyph, AirportIcon, GlobeIcon, PlaneIcon } from '@/components/icons';
import { Kbd } from '@/components/ui/Feedback';
import { HUBS, airportByCode, loadAllAirports, loadCountries, loadMajorAirports } from '@/data/airports';
import { simAirlineSearch, simSearch } from '@/data/world';
import { AirlineLogo } from '@/features/aircraft/FlightParts';
import { cn } from '@/lib/cn';
import { fmtAltitude } from '@/lib/format';
import { fitBounds, flyTo, focusAircraft } from '@/map/controller';
import { useBookmarks, type Recent } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

interface Result {
  key: string;
  group: string;
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  run: () => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function SearchCommand() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  return createPortal(<AnimatePresence>{open && <SearchDialog onClose={() => setOpen(false)} />}</AnimatePresence>, document.body);
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [airports, setAirports] = useState<SearchableAirport[] | null>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const select = useUI((s) => s.select);
  const selectAirport = useUI((s) => s.selectAirport);
  const selectAirline = useUI((s) => s.selectAirline);
  const recents = useBookmarks((s) => s.recents);
  const addRecent = useBookmarks((s) => s.addRecent);
  const clearRecents = useBookmarks((s) => s.clearRecents);
  const altUnit = useSettings((s) => s.units.altitude);

  useEffect(() => {
    inputRef.current?.focus();
    void loadMajorAirports().then(setAirports).catch(() => setAirports([]));
    void loadCountries().then(setCountries).catch(() => setCountries([]));
  }, []);

  // Upgrade to the full airport index the first time the user types.
  useEffect(() => {
    if (q.trim().length >= 2) void loadAllAirports().then(setAirports).catch(() => undefined);
  }, [q]);


  const goAirport = useCallback(
    (a: AirportIndexEntry) => {
      addRecent({ kind: 'airport', id: a.ident, label: a.iata ? `${a.iata} · ${a.name}` : a.name, sub: [a.city, a.country].filter(Boolean).join(', '), lat: a.lat, lon: a.lon });
      selectAirport(a.ident);
      flyTo(a.lon, a.lat, a.type === 'large_airport' ? 10.5 : 11.5);
      onClose();
    },
    [addRecent, selectAirport, onClose],
  );

  const goAircraft = useCallback(
    (a: Aircraft) => {
      select(a.id);
      focusAircraft(a.id, 9.5);
      onClose();
    },
    [select, onClose],
  );

  const results: Result[] = useMemo(() => {
    const out: Result[] = [];
    const query = q.trim();
    if (!query) {
      recents.slice(0, 6).forEach((r) => out.push(recentResult(r, onClose, select, selectAirport)));
      HUBS.slice(0, 8).forEach((h) => {
        const a = airportByCode(h.ident);
        if (!a) return;
        out.push({
          key: `hub-${h.ident}`,
          group: 'Featured hubs',
          icon: <AirportIcon size={17} />,
          title: h.city,
          sub: `${a.iata ?? a.ident} · ${a.name}`,
          run: () => goAirport(a),
        });
      });
      return out;
    }

    // Coordinates
    const coord = parseCoordinates(query);
    if (coord) {
      out.push({
        key: 'coord',
        group: 'Coordinates',
        icon: <MapPin size={17} />,
        title: formatLatLon(coord[0], coord[1], 4),
        sub: 'Fly to this position',
        run: () => {
          addRecent({ kind: 'coordinates', id: `${coord[0]},${coord[1]}`, label: formatLatLon(coord[0], coord[1], 3), lat: coord[0], lon: coord[1], zoom: 10 });
          flyTo(coord[1], coord[0], 10);
          onClose();
        },
      });
    }

    // An exact airport code (e.g. "LHR", "EGLL") goes straight to the top.
    const up = query.toUpperCase().replace(/\s+/g, '');
    const airportHits = airports ? searchAirports(airports, query, { limit: 7 }) : [];
    const exactAirport = airportHits.length > 0 && (airportHits[0]!.iata === up || airportHits[0]!.icao === up || airportHits[0]!.ident === up);
    const airportResults: Result[] = airportHits.map((a) => ({
      key: `apt-${a.ident}`,
      group: 'Airports',
      icon: <AirportIcon size={17} />,
      title: (
        <span>
          {a.iata && <span className="mr-2 font-semibold text-[var(--accent)]">{a.iata}</span>}
          {a.name}
        </span>
      ),
      sub: [a.icao ?? a.ident, a.city, a.country].filter(Boolean).join(' · '),
      run: () => goAirport(a),
    }));
    if (exactAirport) out.push(...airportResults);

    // Aircraft by callsign, registration, address or type (instant, local)
    const local = [...traffic.tracks.values()]
      .map((t) => t.ac)
      .filter((a) => a.callsign?.includes(up) || a.registration?.replace(/-/g, '').includes(up.replace(/-/g, '')) || a.icao24.toUpperCase().startsWith(up) || a.aircraftType === up)
      .sort((a, b) => Number(b.callsign?.startsWith(up) ?? false) - Number(a.callsign?.startsWith(up) ?? false))
      .slice(0, 6);
    const localIds = new Set(local.map((a) => a.id));
    local.forEach((a) => out.push(aircraftResult(a, 'Flights', altUnit, () => goAircraft(a))));

    // Flights by IATA/ICAO flight number (e.g. "BA117", "UAE5").
    for (const r of simSearch(query, 6)) {
      const t = traffic.get(r.id);
      if (!t || localIds.has(r.id)) continue;
      out.push({
        key: `flight-${r.id}`,
        group: 'Flights',
        icon: <PlaneIcon size={17} />,
        title: r.label,
        sub: r.sub,
        run: () => goAircraft(t.ac),
      });
    }

    // Airlines (opens the airline page with its fleet and flights).
    for (const al of simAirlineSearch(query, 4)) {
      out.push({
        key: `airline-${al.icao}`,
        group: 'Airlines',
        icon: <AirlineLogo icao={al.icao} code={al.iata || al.icao} size={22} name={al.name} />,
        title: al.name,
        sub: `${al.iata ? `${al.iata} · ` : ''}${al.icao} · ${al.airframes.toLocaleString()} aircraft`,
        run: () => {
          selectAirline(al.icao);
          onClose();
        },
      });
    }

    // Airports
    if (!exactAirport) out.push(...airportResults);

    // Cities (derived from airport municipalities) and countries
    if (airports && query.length >= 3) {
      const fq = fold(query);
      const seen = new Set<string>();
      for (const a of airports) {
        if (!a.city || !fold(a.city).startsWith(fq) || a.type === 'small_airport') continue;
        const k = `${a.city}|${a.country}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          key: `city-${k}`,
          group: 'Places',
          icon: <MapPin size={17} />,
          title: a.city,
          sub: `${countries?.find((c) => c.code === a.country)?.name ?? a.country} · near ${a.iata ?? a.ident}`,
          run: () => {
            addRecent({ kind: 'place', id: k, label: a.city!, sub: a.country, lat: a.lat, lon: a.lon, zoom: 9 });
            flyTo(a.lon, a.lat, 9);
            onClose();
          },
        });
        if (seen.size >= 3) break;
      }
    }
    if (countries && query.length >= 2) {
      const fq = fold(query);
      countries
        .filter((c) => fold(c.name).startsWith(fq) || c.code === query.toUpperCase())
        .slice(0, 3)
        .forEach((c) =>
          out.push({
            key: `country-${c.code}`,
            group: 'Countries',
            icon: <GlobeIcon size={17} />,
            title: c.name,
            sub: `${c.code} · ${c.continent}`,
            run: () => {
              addRecent({ kind: 'country', id: c.code, label: c.name, lat: c.lat, lon: c.lon });
              fitBounds(...c.bbox);
              onClose();
            },
          }),
        );
    }

    return out;
  }, [q, recents, airports, countries, altUnit, addRecent, goAirport, goAircraft, onClose, select, selectAirport, selectAirline]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const groups = results.reduce<{ name: string; items: (Result & { index: number })[] }[]>((acc, r, index) => {
    const g = acc.find((x) => x.name === r.group);
    if (g) g.items.push({ ...r, index });
    else acc.push({ name: r.group, items: [{ ...r, index }] });
    return acc;
  }, []);

  const activeId = results[active] ? `sr-${results[active]!.key}` : undefined;

  return (
    <motion.div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[9vh] max-md:pt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }}>
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[4px]" onClick={onClose} aria-hidden="true" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        initial={{ opacity: 0, y: -18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
        className="glass relative flex max-h-[min(640px,82vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[26px]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5">
          <Search size={19} className="shrink-0 text-fg-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Flight, airline, airport, city, country or lat, lon"
            maxLength={60}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            className="h-[60px] min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="grid size-7 place-items-center rounded-lg text-fg-3 hover:bg-[var(--line)] hover:text-fg">
              <X size={15} />
            </button>
          )}
          <Kbd className="max-md:hidden">Esc</Kbd>
        </div>


        <div ref={listRef} id="search-results" role="listbox" aria-label="Search results" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-1">
              <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                <span className="eyebrow">{g.name}</span>
                {g.name === 'Recent' && (
                  <button type="button" onClick={clearRecents} className="text-[11px] text-fg-3 hover:text-fg">
                    Clear
                  </button>
                )}
              </div>
              {g.items.map((r) => (
                <button
                  key={r.key}
                  id={`sr-${r.key}`}
                  data-index={r.index}
                  role="option"
                  aria-selected={r.index === active}
                  type="button"
                  onMouseMove={() => setActive(r.index)}
                  onClick={r.run}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors',
                    r.index === active ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]' : 'hover:bg-[var(--line)]',
                  )}
                >
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-[11px] glass-2', r.index === active ? 'text-[var(--accent)]' : 'text-fg-2')}>{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{r.title}</span>
                    {r.sub && <span className="block truncate text-[12px] text-fg-3">{r.sub}</span>}
                  </span>
                  {r.meta && <span className="tnum shrink-0 text-[12px] text-fg-2">{r.meta}</span>}
                  {r.index === active && <CornerDownLeft size={15} className="shrink-0 text-fg-3" />}
                </button>
              ))}
            </div>
          ))}

          {q.trim() && results.length === 0 && (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] font-semibold text-fg">No matches</p>
              <p className="mt-1 text-[12.5px] text-fg-3">
                Try a flight (BA117), an airline (Emirates), an airport code (LHR), a city or coordinates (51.47, -0.45).
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--line)] px-5 py-2.5 text-[11px] text-fg-3 max-md:hidden">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">Airports: OurAirports · Flights: simulated</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function aircraftResult(a: Aircraft, group: string, altUnit: Parameters<typeof fmtAltitude>[1], run: () => void): Result {
  return {
    key: `${group}-${a.id}`,
    group,
    icon: <AircraftGlyph cls={classifyAircraft(a)} size={20} rotate={a.track ?? 0} />,
    title: a.callsign ?? a.registration ?? a.icao24.toUpperCase(),
    sub: [a.typeDescription ?? a.aircraftType, a.registration, a.icao24.toUpperCase()].filter(Boolean).join(' · '),
    meta: fmtAltitude(a.altitudeBarometric ?? a.altitudeGeometric, altUnit, a.onGround),
    run,
  };
}

function recentResult(r: Recent, onClose: () => void, select: (id: string) => void, selectAirport: (id: string) => void): Result {
  return {
    key: `recent-${r.kind}-${r.id}`,
    group: 'Recent',
    icon: <Clock size={16} />,
    title: r.label,
    sub: r.sub ?? r.kind,
    meta: <ArrowRight size={14} />,
    run: () => {
      if (r.kind === 'aircraft') {
        select(r.id);
        if (traffic.get(r.id)) focusAircraft(r.id, 9.5);
      } else if (r.kind === 'airport') {
        selectAirport(r.id);
        if (r.lat !== undefined && r.lon !== undefined) flyTo(r.lon, r.lat, 10.5);
      } else if (r.lat !== undefined && r.lon !== undefined) flyTo(r.lon, r.lat, r.zoom ?? 7);
      onClose();
    },
  };
}
