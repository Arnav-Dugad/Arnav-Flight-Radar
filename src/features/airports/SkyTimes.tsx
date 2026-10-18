// Sunrise / sunset, civil twilight and moonrise / moonset for an airport, computed
// locally from the sub-solar and sub-lunar points (accurate to a few minutes).
import { useMemo } from 'react';
import { moonPosition, solarElevation, subsolarPoint } from '@/map/extraOverlays';
import { fmtHmIn } from '@/lib/tz';

type Crossing = { rise?: number; set?: number };

/** Times in [t0, t0+24h) when `elev(t)` crosses `h` upward (rise) and downward (set). */
export function crossings(elev: (t: number) => number, t0: number, h: number, stepMin = 5): Crossing {
  const out: Crossing = {};
  const step = stepMin * 60_000;
  let prevT = t0;
  let prev = elev(t0) - h;
  for (let t = t0 + step; t <= t0 + 86_400_000; t += step) {
    const v = elev(t) - h;
    if (prev < 0 && v >= 0 && out.rise === undefined) out.rise = prevT + (step * -prev) / (v - prev);
    if (prev >= 0 && v < 0 && out.set === undefined) out.set = prevT + (step * prev) / (prev - v);
    prev = v;
    prevT = t;
  }
  return out;
}

export function sunTimes(lat: number, lon: number, dayStart: number) {
  const elev = (t: number) => solarElevation(lat, lon, subsolarPoint(t));
  return { sun: crossings(elev, dayStart, -0.833), civil: crossings(elev, dayStart, -6) };
}

export function moonTimes(lat: number, lon: number, dayStart: number) {
  const elev = (t: number) => {
    const m = moonPosition(t);
    return solarElevation(lat, lon, { lat: m.lat, lon: m.lon });
  };
  return crossings(elev, dayStart, 0.125, 10);
}

/** Local midnight (in `tz`) of the day containing `t`. */
function localMidnight(t: number, tz: string | null): number {
  if (!tz) return Math.floor(t / 86_400_000) * 86_400_000;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return t - (h * 60 + m) * 60_000 - (t % 60_000);
  } catch {
    return Math.floor(t / 86_400_000) * 86_400_000;
  }
}

export function SkyTimesCard({ lat, lon, tz, now }: { lat: number; lon: number; tz: string | null; now: number }) {
  const day = localMidnight(now, tz);
  const s = useMemo(() => sunTimes(lat, lon, day), [lat, lon, day]);
  const m = useMemo(() => moonTimes(lat, lon, day), [lat, lon, day]);
  const phase = moonPosition(now);
  const pct = Math.round(phase.illumination * 100);
  const t = (v?: number) => (v === undefined ? '—' : fmtHmIn(v, tz));
  const cells: [string, string][] = [
    ['Sunrise', s.sun.rise === undefined && s.sun.set === undefined ? (solarElevation(lat, lon, subsolarPoint(now)) > 0 ? 'Midnight sun' : 'Polar night') : t(s.sun.rise)],
    ['Sunset', t(s.sun.set)],
    ['First light', t(s.civil.rise)],
    ['Last light', t(s.civil.set)],
    ['Moonrise', t(m.rise)],
    ['Moonset', t(m.set)],
  ];
  return (
    <div className="glass-2 rounded-[16px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Sun &amp; moon (local time)</span>
        <span className="tnum text-[11px] text-fg-3">
          Moon {pct}% · {phase.waxing ? 'waxing' : 'waning'}
        </span>
      </div>
      <div className="tnum grid grid-cols-3 gap-x-3 gap-y-2">
        {cells.map(([l, v]) => (
          <div key={l}>
            <div className="text-[10.5px] text-fg-3">{l}</div>
            <div className="text-[13.5px] font-semibold text-fg">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-fg-3">Computed from astronomical formulas; first and last light are civil twilight.</p>
    </div>
  );
}
