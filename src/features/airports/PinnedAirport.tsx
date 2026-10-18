// Favourite airports pinned to the map (up to four): local time, weather, runway in
// use and the next departures and arrivals. Pins also become home-screen shortcuts
// when the site is installed (the manifest link carries them).
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Minus, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { airportByCode, loadMajorAirports } from '@/data/airports';
import { simBoard, simNow, simRunwayInUse, useSim, type BoardRow } from '@/data/world';
import { api } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { FLIGHT_CAT_COLOR } from '@/map/overlays';
import { useBookmarks } from '@/state/bookmarks';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { AirlineLogo, STATUS_TEXT } from '@/features/aircraft/FlightParts';

function Row({ r, tz, dep }: { r: BoardRow; tz: string | null; dep: boolean }) {
  const select = useUI((s) => s.select);
  return (
    <button type="button" onClick={() => traffic.get(r.id) && select(r.id)} className="flex w-full items-center gap-2 rounded-[10px] px-1.5 py-1 text-left hover:bg-[var(--line)]">
      <span className="tnum w-[38px] shrink-0 text-[12px] font-semibold text-fg">{fmtHmIn(r.scheduled, tz)}</span>
      <AirlineLogo icao={r.airlineIcao} code={r.airlineIata ?? r.flight.slice(0, 2)} size={20} name={r.airline} wide />
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
        {dep ? '→' : '←'} {r.other.iata ?? r.other.ident} <span className="text-fg-3">{r.flightIata ?? r.flight}</span>
      </span>
      <span className={`shrink-0 text-[10.5px] font-semibold ${STATUS_TEXT[r.status]}`}>{r.status}</span>
    </button>
  );
}

function PinnedCard({ ident, index, count }: { ident: string; index: number; count: number }) {
  const togglePin = useBookmarks((s) => s.togglePin);
  const movePin = useBookmarks((s) => s.movePin);
  const selectAirport = useUI((s) => s.selectAirport);
  const loading = useSim((s) => s.loading);
  const [collapsed, setCollapsed] = useState(count > 2 && index > 0);
  useNow(10_000);
  const idx = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
  const a = idx.data ? airportByCode(ident) : undefined;
  const tz = useTimeZone(a?.lat, a?.lon);
  const station = a && /^[A-Z]{4}$/.test(a.icao ?? a.ident) ? (a.icao ?? a.ident) : null;
  const metar = useQuery({
    queryKey: ['metar', station],
    queryFn: ({ signal }) => api.metar([station!], signal),
    enabled: !!station,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 0,
  });
  const board = (!loading && a ? simBoard(a.ident, { pastMin: 0, aheadMin: 120 }) : undefined);
  if (!a) return null;
  const m = metar.data?.data[0];
  const rw = simRunwayInUse(a.ident);
  const clock = simNow();
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      className="glass pointer-events-auto w-[296px] shrink-0 rounded-[22px] p-3"
      aria-label={`Pinned airport ${a.iata ?? a.ident}`}
    >
      <header className="flex items-center gap-1">
        <button type="button" onClick={() => selectAirport(a.ident)} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline gap-2">
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{a.iata ?? a.ident}</span>
            <span className="tnum text-[12px] text-fg-2">
              {fmtHmIn(clock, tz)} {tzAbbrev(clock, tz)}
            </span>
          </div>
          <div className="truncate text-[11px] text-fg-3">{a.name}</div>
        </button>
        {count > 1 && (
          <>
            <button type="button" aria-label={`Move ${a.iata ?? a.ident} up`} disabled={index === 0} onClick={() => movePin(ident, -1)} className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)] disabled:opacity-30">
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              aria-label={`Move ${a.iata ?? a.ident} down`}
              disabled={index === count - 1}
              onClick={() => movePin(ident, 1)}
              className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)] disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
          </>
        )}
        <button type="button" aria-label={collapsed ? 'Expand pinned airport' : 'Collapse pinned airport'} onClick={() => setCollapsed((c) => !c)} className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)]">
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button>
        <button type="button" aria-label="Unpin airport" onClick={() => togglePin(ident)} className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)]">
          <X size={14} />
        </button>
      </header>
      {!collapsed && (
        <div className="mt-2 space-y-2">
          <div className="tnum flex flex-wrap items-center gap-1.5 text-[11px]">
            {m?.flightCategory && (
              <span className="rounded-full px-2 py-0.5 font-semibold text-[#04101c]" style={{ background: FLIGHT_CAT_COLOR[m.flightCategory] }}>
                {m.flightCategory}
              </span>
            )}
            {m && (
              <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-fg-2">
                {m.windVariable || m.windDirDeg === undefined ? 'VRB' : `${String(m.windDirDeg).padStart(3, '0')}°`} {m.windSpeedKt ?? 0} kt{m.windGustKt ? ` G${m.windGustKt}` : ''}
              </span>
            )}
            {rw && <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-fg-2">Rwy {rw.runway}</span>}
          </div>
          {board && (
            <div className="space-y-0.5">
              {board.departures.slice(0, 4).map((r) => (
                <Row key={`d${r.id}${r.scheduled}`} r={r} tz={tz} dep />
              ))}
              {board.arrivals.slice(0, 3).map((r) => (
                <Row key={`a${r.id}${r.scheduled}`} r={r} tz={tz} dep={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}

export function PinnedAirports() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const pins = useBookmarks((s) => s.pinnedAirports);
  // Installed-app shortcuts follow the pins (browsers read the manifest when installing).
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    link.href = pins.length ? `/api/manifest.webmanifest?pins=${pins.map(encodeURIComponent).join(',')}` : '/manifest.webmanifest';
  }, [pins]);
  if (!pins.length) return null;
  return (
    <div className="scroll-thin pointer-events-none absolute left-[88px] top-[84px] z-10 flex max-h-[calc(100dvh-170px)] flex-col gap-2 overflow-y-auto pb-1">
      <AnimatePresence>
        {pins.map((p, i) => (
          <PinnedCard key={p} ident={p} index={i} count={pins.length} />
        ))}
      </AnimatePresence>
    </div>
  );
}
