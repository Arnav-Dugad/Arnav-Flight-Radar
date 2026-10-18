import { ArrowRight, Clock, CornerDownLeft, MapPin, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { searchAirports, type SearchableAirport } from '@shared/airports';
import { classifyAircraft, type AircraftClass } from '@shared/classify';
import { formatLatLon, parseCoordinates } from '@shared/geo';
import type { Aircraft, AirportIndexEntry, Country } from '@shared/types';
import { AircraftGlyph, AirportIcon, GlobeIcon, PlaneIcon } from '@/components/icons';
import { Kbd } from '@/components/ui/Feedback';
import { HUBS, airportByCode, loadAllAirports, loadCountries, loadMajorAirports } from '@/data/airports';
import type { TypeSpec } from '@/data/sim/typeSpecs';

// Aircraft-type data is fetched the first time someone types a query.
let typesMod: typeof import('@/data/sim/typeSpecs') | null = null;
import { simAirlineSearch, simRouteSearch, simSearch, useSim } from '@/data/world';
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

/** An airport code or a city/airport name → matching airports (largest first). */
function resolvePlace(token: string, airports: SearchableAirport[]): SearchableAirport[] {
  const t = token.trim();
  const up = t.toUpperCase();
  if (/^[A-Z0-9]{3,4}$/i.test(t)) {
    const byCode = airports.find((a) => a.iata === up || a.icao === up || a.ident === up);
    if (byCode) return [byCode];
  }
  const f = fold(t);
  if (f.length < 3) return [];
  const city = airports.filter((a) => a._city === f || a._city.startsWith(`${f} `) || a._city.startsWith(`${f},`));
  const list = city.length ? city : airports.filter((a) => a._name.startsWith(f) || a._name.includes(` ${f}`));
  return list
    .filter((a) => a.type === 'large_airport' || a.type === 'medium_airport')
    .sort((a, b) => Number(b.type === 'large_airport') - Number(a.type === 'large_airport'))
    .slice(0, 6);
}

/** "LHR JFK", "LHR-JFK", "LHR → JFK", "London to New York" → both ends, or null. */
function parseRoute(q: string, airports: SearchableAirport[]): { from: SearchableAirport[]; to: SearchableAirport[]; fromLabel: string; toLabel: string } | null {
  const s = q.trim();
  let parts = s.split(/\s*(?:→|->|–|—|>|\/|\s-\s|-(?=[A-Za-z]{3,4}$)|\bto\b)\s*/i).filter(Boolean);
  if (parts.length !== 2) {
    const m = /^([A-Za-z]{3,4})\s+([A-Za-z]{3,4})$/.exec(s);
    parts = m ? [m[1]!, m[2]!] : [];
  }
  if (parts.length !== 2) return null;
  const from = resolvePlace(parts[0]!, airports);
  const to = resolvePlace(parts[1]!, airports);
  if (!from.length || !to.length || from.some((a) => to.includes(a))) return null;
  const label = (list: SearchableAirport[], raw: string) => (list.length === 1 ? (list[0]!.iata ?? list[0]!.ident) : raw.trim().replace(/\b\w/g, (c) => c.toUpperCase()));
  return { from, to, fromLabel: label(from, parts[0]!), toLabel: label(to, parts[1]!) };
}

export function SearchCommand() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  return createPortal(<AnimatePresence>{open && <SearchDialog onClose={() => setOpen(false)} />}</AnimatePresence>, document.body);
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const simRev = useSim((s) => s.rev); // re-render when the simulation worker answers
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [airports, setAirports] = useState<SearchableAirport[] | null>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [typesReady, setTypesReady] = useState(!!typesMod);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const select = useUI((s) => s.select);
  const selectAirport = useUI((s) => s.selectAirport);
  const selectAirline = useUI((s) => s.selectAirline);
  const selectType = useUI((s) => s.selectType);
  const recents = useBookmarks((s) => s.recents);
  const addRecent = useBookmarks((s) => s.addRecent);
  const clearRecents = useBookmarks((s) => s.clearRecents);
  const altUnit = useSettings((s) => s.units.altitude);

  useEffect(() => {
    if (q.trim().length < 2 || typesMod) return;
    void import('@/data/sim/typeSpecs').then((m) => {
      typesMod = m;
      setTypesReady(true);
    });
  }, [q]);

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
    void simRev; // recompute when worker answers arrive
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

    // A route ("LHR JFK", "LHR-JFK", "London to New York"): flights between the two places.
    const route = airports ? parseRoute(query, airports) : null;
    if (route) {
      const hits = simRouteSearch(route.from.map((a) => a.ident), route.to.map((a) => a.ident), 10);
      const label = `${route.fromLabel} → ${route.toLabel}`;
      if (!hits)
        out.push({ key: 'route-wait', group: `Route ${label}`, icon: <ArrowRight size={17} />, title: 'Looking for flights on this route…', sub: 'Searching the simulated world', run: () => goAirport(route.from[0]!) });
      else if (!hits.length)
        out.push({ key: 'route-none', group: `Route ${label}`, icon: <ArrowRight size={17} />, title: 'No simulated flights on this route right now', sub: 'Try the airports’ departure boards, or another pair of cities', run: () => goAirport(route.from[0]!) });
      for (const h of hits ?? []) {
        const live = traffic.get(h.id);
        out.push({
          key: `route-${h.id}-${h.std}`,
          group: `Route ${label}`,
          icon: h.airlineIcao ? <AirlineLogo icao={h.airlineIcao} code={h.flight.slice(0, 2)} size={22} name={h.airline} /> : <PlaneIcon size={17} />,
          title: (
            <span>
              <span className="font-semibold">{h.flight}</span>
              <span className="ml-2 text-fg-3">
                {h.from.iata ?? h.from.ident} → {h.to.iata ?? h.to.ident}
              </span>
            </span>
          ),
          sub: [h.airline, h.type, h.status, live ? null : `departs ${new Date(h.std).toISOString().slice(11, 16)}Z`].filter(Boolean).join(' · '),
          run: () => {
            if (live) goAircraft(live.ac);
            else {
              selectAirport(h.from.ident);
              onClose();
            }
          },
        });
      }
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

    // Aircraft types (opens the type page). An exact ICAO designator ("A388", "B77W")
    // ranks right after an exact airport code; anything else goes after the airports.
    const typeHits = query.length >= 2 && typesReady && typesMod ? typesMod.searchTypes(query, 5) : [];
    const exactType = typeHits.length > 0 && typeHits[0]!.code === up;
    const typeResults: Result[] = typeHits.map((s) =>
      typeResult(s, () => {
        selectType(s.code);
        onClose();
      }),
    );
    if (exactType) out.push(...typeResults);

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

    // Airports, then aircraft types
    if (!exactAirport) out.push(...airportResults);
    if (!exactType) out.push(...typeResults);

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
  }, [q, recents, airports, countries, altUnit, addRecent, goAirport, goAircraft, onClose, select, selectAirport, selectAirline, selectType, typesReady, simRev]);

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
            placeholder="Flight, airline, airport, aircraft type, city or lat, lon"
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
                Try a flight (BA117), an airline (Emirates), an airport code (LHR), an aircraft type (A350), a city or coordinates (51.47, -0.45).
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

/** Map-symbol class for a reference type, for its glyph. */
function typeGlyph(s: TypeSpec): AircraftClass {
  if (s.role === 'helicopter') return 'helicopter';
  if (s.role === 'glider') return 'glider';
  if (s.role === 'bizjet') return 'bizjet';
  if (s.role === 'fighter' || s.shape === 'high-jet-quad' || s.shape === 'high-quad-turboprop') return 'military';
  if (['wide-twin', 'tri-jet', 'quad', 'b747', 'a380', 'awacs'].includes(s.shape)) return 'widebody';
  if (s.shape === 'narrow') return s.seatsTypical > 0 && s.seatsTypical < 110 ? 'regional' : 'narrowbody';
  if (s.shape === 'rear-jet') return 'regional';
  if (s.shape.includes('turboprop') && !s.shape.startsWith('single')) return 'turboprop';
  return 'light';
}

const ROLE_WORD: Record<TypeSpec['role'], string> = {
  airliner: 'Airliner',
  freighter: 'Freighter',
  bizjet: 'Business jet',
  ga: 'General aviation',
  helicopter: 'Helicopter',
  'military-transport': 'Military transport',
  tanker: 'Tanker',
  fighter: 'Fighter',
  patrol: 'Maritime patrol',
  awacs: 'AEW&C',
  trainer: 'Trainer',
  glider: 'Glider',
  utility: 'Utility',
};

function typeResult(s: TypeSpec, run: () => void): Result {
  return {
    key: `type-${s.code}`,
    group: 'Aircraft types',
    icon: <AircraftGlyph cls={typeGlyph(s)} size={20} />,
    title: (
      <span>
        <span className="mr-2 font-semibold text-[var(--accent)]">{s.code}</span>
        {s.maker} {s.model}
      </span>
    ),
    sub: [ROLE_WORD[s.role], s.family, s.seatsTypical > 0 ? `${s.seatsTypical} seats` : undefined, `${s.rangeNm.toLocaleString('en-US')} NM range`].filter(Boolean).join(' · '),
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
