import { ArrowLeftRight, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { classifyAircraft } from '@shared/classify';
import { bearingDeg, distanceNm } from '@shared/geo';
import type { Aircraft } from '@shared/types';
import { AircraftGlyph, CompareIcon } from '@/components/icons';
import { TextField } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/Feedback';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { fmtAltitude, fmtBearing, fmtDistance, fmtSpeed, fmtVRate, NA } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

export function ComparePanel() {
  const open = useUI((s) => s.panel === 'compare');
  const openPanel = useUI((s) => s.openPanel);
  const compare = useUI((s) => s.compare);
  const setCompare = useUI((s) => s.setCompare);
  const units = useSettings((s) => s.units);
  useTrafficVersion();
  const a = traffic.get(compare[0])?.ac;
  const b = traffic.get(compare[1])?.ac;

  const rows: [string, (x: Aircraft) => string][] = [
    ['Type', (x) => x.typeDescription ?? x.aircraftType ?? NA],
    ['Registration', (x) => x.registration ?? NA],
    ['Altitude', (x) => fmtAltitude(x.altitudeBarometric ?? x.altitudeGeometric, units.altitude, x.onGround)],
    ['Ground speed', (x) => fmtSpeed(x.groundSpeed, units.speed)],
    ['Track', (x) => fmtBearing(x.track)],
    ['Vertical rate', (x) => fmtVRate(x.verticalRate, units.verticalRate)],
    ['Mach', (x) => (x.ext?.mach !== undefined ? x.ext.mach.toFixed(2) : NA)],
    ['Squawk', (x) => x.squawk ?? NA],
    ['Position age', (x) => `${Math.round((traffic.serverNow() - x.observedAt) / 1000)} s`],
  ];

  const sep = a && b ? { h: distanceNm(a.lat, a.lon, b.lat, b.lon), brg: bearingDeg(a.lat, a.lon, b.lat, b.lon) } : null;
  const altA = a ? (a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric)) : undefined;
  const altB = b ? (b.onGround ? 0 : (b.altitudeBarometric ?? b.altitudeGeometric)) : undefined;

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Compare aircraft" icon={<CompareIcon size={18} />} ariaLabel="Compare aircraft" subtitle="Telemetry of two observed aircraft side by side">
      <div className="space-y-5 pt-1">
        <div className="grid grid-cols-2 gap-2.5">
          <Slot ac={a} slot={0} onClear={() => setCompare(0, null)} />
          <Slot ac={b} slot={1} onClear={() => setCompare(1, null)} />
        </div>
        {a && b ? (
          <>
            <div className="glass-2 overflow-hidden rounded-[16px]">
              <table className="tnum w-full text-[12px]">
                <tbody>
                  {rows.map(([label, f]) => (
                    <tr key={label} className="border-b border-[var(--line)] last:border-b-0">
                      <td className="w-[38%] px-3 py-2 text-right font-medium text-fg">{f(a)}</td>
                      <th scope="row" className="px-1 py-2 text-center text-[10.5px] font-medium uppercase tracking-wide text-fg-3">
                        {label}
                      </th>
                      <td className="w-[38%] px-3 py-2 text-left font-medium text-fg">{f(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Section title="Relative position">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="glass-2 rounded-[14px] p-2.5">
                  <div className="tnum text-[16px] font-semibold text-fg">{sep ? fmtDistance(sep.h, units.distance) : NA}</div>
                  <div className="text-[10.5px] text-fg-3">Horizontal</div>
                </div>
                <div className="glass-2 rounded-[14px] p-2.5">
                  <div className="tnum text-[16px] font-semibold text-fg">{altA !== undefined && altB !== undefined ? fmtAltitude(Math.abs(altA - altB), units.altitude === 'fl' ? 'ft' : units.altitude) : NA}</div>
                  <div className="text-[10.5px] text-fg-3">Vertical</div>
                </div>
                <div className="glass-2 rounded-[14px] p-2.5">
                  <div className="tnum text-[16px] font-semibold text-fg">{sep ? fmtBearing(sep.brg) : NA}</div>
                  <div className="text-[10.5px] text-fg-3">Bearing A→B</div>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-fg-3">
                Computed from each aircraft’s latest reported position, which can be seconds old and taken at different moments. This is not a
                separation measurement or collision warning.
              </p>
            </Section>
          </>
        ) : (
          <EmptyState icon={<ArrowLeftRight size={18} />} title="Pick two aircraft" body="Use the compare button in an aircraft’s panel, or choose from the list in each slot." />
        )}
      </div>
    </Panel>
  );
}

function Slot({ ac, slot, onClear }: { ac?: Aircraft; slot: 0 | 1; onClear: () => void }) {
  const setCompare = useUI((s) => s.setCompare);
  const [q, setQ] = useState('');
  useTrafficVersion();
  const options = useMemo(() => {
    const up = q.trim().toUpperCase();
    return traffic
      .current()
      .filter((x) => !up || x.callsign?.includes(up) || x.registration?.includes(up) || x.icao24.toUpperCase().startsWith(up))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, traffic.version]);
  if (ac)
    return (
      <div className="glass-2 relative rounded-[16px] p-3">
        <button type="button" aria-label="Remove" onClick={onClear} className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-fg-3 hover:bg-[var(--line)] hover:text-fg">
          <X size={13} />
        </button>
        <span className="text-[10.5px] font-bold text-fg-3">{slot === 0 ? 'A' : 'B'}</span>
        <button type="button" onClick={() => focusAircraft(ac.id)} className="mt-1 flex items-center gap-2 text-left">
          <AircraftGlyph cls={classifyAircraft(ac)} size={22} rotate={ac.track ?? 0} className="text-[var(--accent)]" />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-fg">{ac.callsign ?? ac.registration ?? ac.icao24.toUpperCase()}</span>
            <span className="block truncate text-[11px] text-fg-3">{ac.aircraftType ?? '—'}</span>
          </span>
        </button>
      </div>
    );
  return (
    <div className="glass-2 space-y-2 rounded-[16px] p-2.5">
      <TextField label={`Aircraft ${slot === 0 ? 'A' : 'B'}`} value={q} onChange={setQ} placeholder="Callsign…" />
      <ul className="space-y-0.5">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => setCompare(slot, o.id)} className="w-full truncate rounded-[8px] px-2 py-1 text-left text-[12px] text-fg-2 hover:bg-[var(--line)] hover:text-fg">
              {o.callsign ?? o.registration ?? o.icao24.toUpperCase()}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
