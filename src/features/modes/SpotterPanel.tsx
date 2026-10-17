import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { searchAirports } from '@shared/airports';
import { classifyAircraft } from '@shared/classify';
import { bearingDeg, distanceNm } from '@shared/geo';
import { FT_PER_M } from '@shared/units';
import { AircraftGlyph, SpotterIcon } from '@/components/icons';
import { Slider, TextField } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/Feedback';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { airportByCode, loadMajorAirports } from '@/data/airports';
import { fmtAltitude, fmtDistance } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { flyTo, focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const point = (deg: number) => COMPASS[Math.round(deg / 22.5) % 16];

/**
 * Where to look: azimuth and elevation angle of each aircraft as seen from the
 * airport, computed from reported positions (flat-earth approximation with an
 * Earth-curvature correction, adequate for spotting).
 */
function lookAngles(fromLat: number, fromLon: number, fromElevFt: number, lat: number, lon: number, altFt: number) {
  const dNm = distanceNm(fromLat, fromLon, lat, lon);
  const dFt = dNm * 1852 * FT_PER_M;
  const curvatureDrop = (dFt * dFt) / (2 * 20_902_231); // Earth radius in ft
  const elev = (Math.atan2(altFt - fromElevFt - curvatureDrop, dFt) * 180) / Math.PI;
  return { dNm, az: bearingDeg(fromLat, fromLon, lat, lon), elev };
}

export function SpotterPanel() {
  const open = useUI((s) => s.panel === 'spotter');
  const openPanel = useUI((s) => s.openPanel);
  const ident = useUI((s) => s.spotterAirport);
  const setSpotter = useUI((s) => s.setSpotter);
  const select = useUI((s) => s.select);
  const units = useSettings((s) => s.units);
  const [radius, setRadius] = useState(25);
  const [q, setQ] = useState('');
  useTrafficVersion();
  const major = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
  const airport = ident ? airportByCode(ident) : undefined;

  const list = useMemo(() => {
    if (!airport) return [];
    return traffic
      .current()
      .filter((a) => !a.onGround)
      .map((a) => ({ a, ...lookAngles(airport.lat, airport.lon, airport.elevationFt ?? 0, a.lat, a.lon, a.altitudeGeometric ?? a.altitudeBarometric ?? 0) }))
      .filter((x) => x.dNm <= radius)
      .sort((x, y) => x.dNm - y.dNm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport, radius, traffic.version]);

  const results = major.data && q.trim().length >= 2 ? searchAirports(major.data, q, { limit: 6 }) : [];

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Spotter mode" icon={<SpotterIcon size={18} />} ariaLabel="Aircraft spotter mode" subtitle={airport ? `${airport.iata ?? airport.ident} · ${airport.name}` : 'Choose an airport'}>
      <div className="space-y-5 pt-1">
        <TextField label="Spotting location (airport)" value={q} onChange={setQ} placeholder="e.g. LHR, Bengaluru" icon={<Search size={14} />} />
        {results.length > 0 && (
          <ul className="glass-2 divide-y divide-[var(--line)] rounded-[14px]">
            {results.map((r) => (
              <li key={r.ident}>
                <button
                  type="button"
                  onClick={() => {
                    setSpotter(r.ident);
                    setQ('');
                    flyTo(r.lon, r.lat, 10);
                  }}
                  className="w-full truncate px-3 py-2 text-left text-[12.5px] text-fg hover:bg-[var(--line)]"
                >
                  <span className="mr-2 font-semibold text-[var(--accent)]">{r.iata ?? r.ident}</span>
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!airport ? (
          <EmptyState icon={<SpotterIcon />} title="Pick where you are spotting from" body="Search an airport above, or open an airport and choose “Spotter mode”." />
        ) : (
          <>
            <Slider label="Spotting radius" min={5} max={60} step={5} value={radius} onChange={setRadius} format={(v) => `${v} NM`} />
            <Section title={`Airborne within ${radius} NM (${list.length})`}>
              {list.length === 0 ? (
                <p className="text-[12px] text-fg-3">Nothing airborne in range right now. Make sure the airport is inside the live area.</p>
              ) : (
                <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
                  {list.slice(0, 40).map(({ a, dNm, az, elev }) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          select(a.id);
                          focusAircraft(a.id, 10.5);
                        }}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--line)]"
                      >
                        <AircraftGlyph cls={classifyAircraft(a)} size={22} rotate={a.track ?? 0} className="shrink-0 text-fg-2" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-fg">{a.callsign ?? a.registration ?? a.icao24.toUpperCase()}</div>
                          <div className="truncate text-[11px] text-fg-3">
                            {a.typeDescription ?? a.aircraftType ?? 'Type not reported'} · {fmtAltitude(a.altitudeBarometric ?? a.altitudeGeometric, units.altitude)}
                          </div>
                        </div>
                        <div className="tnum shrink-0 text-right">
                          <div className="text-[13px] font-semibold text-[var(--accent)]">
                            {point(az)} · {Math.max(0, elev).toFixed(0)}° up
                          </div>
                          <div className="text-[11px] text-fg-3">{fmtDistance(dNm, units.distance)}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] leading-relaxed text-fg-3">
                “NE · 12° up” means look north-east, 12° above the horizon from the airport reference point. Computed from reported positions; terrain
                and buildings are not considered.
              </p>
            </Section>
          </>
        )}
      </div>
    </Panel>
  );
}
