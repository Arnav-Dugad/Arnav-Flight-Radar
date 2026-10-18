// A favourite airport pinned to the map: local time, weather, runway in use, and —
// in demo mode — the next simulated departures and arrivals. Live mode shows
// observed traffic only (live data has no schedule).
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { distanceNm } from '@shared/geo';
import { airportByCode, loadMajorAirports } from '@/data/airports';
import { demoBoard, demoNow, demoRunwayInUse, useDemo, type BoardRow } from '@/data/demo';
import { api } from '@/lib/api';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { FLIGHT_CAT_COLOR } from '@/map/overlays';
import { useBookmarks } from '@/state/bookmarks';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { AirlineLogo } from '@/features/aircraft/RouteCard';

function Row({ r, tz, dep }: { r: BoardRow; tz: string | null; dep: boolean }) {
  const select = useUI((s) => s.select);
  const late = r.delayMin > 5;
  return (
    <button
      type="button"
      onClick={() => traffic.get(r.id) && select(r.id)}
      className="flex w-full items-center gap-2 rounded-[10px] px-1.5 py-1 text-left hover:bg-[var(--line)]"
    >
      <span className="tnum w-[38px] shrink-0 text-[12px] font-semibold text-fg">{fmtHmIn(r.scheduled, tz)}</span>
      <AirlineLogo icao={r.airlineIcao} code={r.airlineIata ?? r.flight.slice(0, 2)} size={22} name={r.airline} wide />
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
        {dep ? '→' : '←'} {r.other.iata ?? r.other.ident} <span className="text-fg-3">{r.flightIata ?? r.flight}</span>
      </span>
      <span className={`shrink-0 text-[10.5px] font-semibold ${r.status === 'Diverted' ? 'text-[#ff8a9a]' : late ? 'text-[#ffb547]' : 'text-fg-3'}`}>{r.status}</span>
    </button>
  );
}

export function PinnedAirport() {
  const ident = useBookmarks((s) => s.pinnedAirport);
  const unpin = useBookmarks((s) => s.setPinnedAirport);
  const selectAirport = useUI((s) => s.selectAirport);
  const demo = useDemo((s) => s.active);
  const [collapsed, setCollapsed] = useState(false);
  const now = useNow(10_000);
  useTrafficVersion();
  // Make sure the airport index is loaded so the pinned code resolves after a reload.
  const idx = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
  const a = ident && idx.data ? airportByCode(ident) : undefined;
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
  const board = useMemo(
    () => (demo && a ? demoBoard(a.ident, { pastMin: 0, aheadMin: 120 }) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demo, a?.ident, Math.floor(now / 20_000)],
  );
  const near = useMemo(() => {
    if (!a) return { air: 0, ground: 0 };
    let air = 0;
    let ground = 0;
    for (const t of traffic.tracks.values()) {
      if (Math.abs(t.ac.lat - a.lat) > 0.6 || distanceNm(a.lat, a.lon, t.ac.lat, t.ac.lon) > 30) continue;
      if (t.ac.onGround) ground++;
      else air++;
    }
    return { air, ground };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, traffic.version]);
  if (!ident || !a) return null;
  const m = metar.data?.data[0];
  const rw = demo ? demoRunwayInUse(a.ident) : undefined;
  const clock = demo ? demoNow() : Date.now();
  return (
    <AnimatePresence>
      <motion.section
        key={ident}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8 }}
        className="glass pointer-events-auto absolute left-[88px] top-[84px] z-10 w-[296px] rounded-[22px] p-3"
        aria-label={`Pinned airport ${a.iata ?? a.ident}`}
      >
        <header className="flex items-center gap-2">
          <button type="button" onClick={() => selectAirport(a.ident)} className="min-w-0 flex-1 text-left">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{a.iata ?? a.ident}</span>
              <span className="tnum text-[12px] text-fg-2">
                {fmtHmIn(clock, tz)} {tzAbbrev(clock, tz)}
              </span>
            </div>
            <div className="truncate text-[11px] text-fg-3">{a.name}</div>
          </button>
          <button type="button" aria-label={collapsed ? 'Expand pinned airport' : 'Collapse pinned airport'} onClick={() => setCollapsed((c) => !c)} className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)]">
            {collapsed ? <Plus size={14} /> : <Minus size={14} />}
          </button>
          <button type="button" aria-label="Unpin airport" onClick={() => unpin(null)} className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-[var(--line)]">
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
              {!demo && (
                <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-fg-2">
                  {near.air} airborne · {near.ground} on ground (30 NM)
                </span>
              )}
            </div>
            {demo && board && (
              <div className="space-y-0.5">
                {board.departures.slice(0, 4).map((r) => (
                  <Row key={`d${r.id}${r.scheduled}`} r={r} tz={tz} dep />
                ))}
                {board.arrivals.slice(0, 3).map((r) => (
                  <Row key={`a${r.id}${r.scheduled}`} r={r} tz={tz} dep={false} />
                ))}
                <p className="px-1.5 pt-0.5 text-[10px] text-fg-3">Simulated schedule (demo).</p>
              </div>
            )}
            {!demo && <p className="text-[10.5px] text-fg-3">Live data has no schedule; counts are observed aircraft. Weather: NOAA AWC.</p>}
          </div>
        )}
      </motion.section>
    </AnimatePresence>
  );
}
