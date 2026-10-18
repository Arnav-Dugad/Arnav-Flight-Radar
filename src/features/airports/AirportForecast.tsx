// Forecast impact: the real TAF (NOAA AWC) turned into a 24-hour arrival-capacity outlook.
// Shares the Weather tab's TAF query and feeds the forecast into the simulation.
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AirportDetail } from '@shared/types';
import { decodeWeather } from '@shared/weather';
import { Section } from '@/components/ui/Glass';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { applyForecast, simNow } from '@/data/world';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtSpeed } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import * as lib from '@/lib/tafImpact';
import { fmtHmIn, tzAbbrev } from '@/lib/tz';
import { useSettings } from '@/state/settings';

type Level = 0 | 1 | 2 | 3;

/** Reserved status palette (mid-tones legible on both themes). Always shown with icon + label. */
const LEVEL: Record<Level, { label: string; long: string; color: string; icon: LucideIcon }> = {
  0: { label: 'Normal', long: 'No disruption', color: '#2fb67c', icon: CircleCheck },
  1: { label: 'Minor', long: 'Minor impact', color: '#d6a419', icon: Info },
  2: { label: 'Moderate', long: 'Moderate impact', color: '#ee7d2b', icon: TriangleAlert },
  3: { label: 'Severe', long: 'Severe impact', color: '#e5484d', icon: OctagonAlert },
};

function LevelChip({ level, className }: { level: Level; className?: string }) {
  const L = LEVEL[level];
  return (
    <span
      className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold text-fg', className)}
      style={{ background: `color-mix(in srgb, ${L.color} 14%, transparent)`, borderColor: `color-mix(in srgb, ${L.color} 40%, transparent)` }}
    >
      <L.icon size={13} strokeWidth={2.25} style={{ color: L.color }} />
      {L.long}
    </span>
  );
}

const fmtVis = (sm: number) =>
  sm >= 6 ? '6+ sm (10 km+)' : `${sm < 1 ? sm.toFixed(2).replace(/0$/, '') : Math.round(sm * 10) / 10} sm (${(sm * 1.609).toFixed(sm < 3 ? 1 : 0)} km)`;

export function AirportForecast({ a, station, tz }: { a: AirportDetail; station: string | null; tz: string | null }) {
  return (
    <Section title={station ? `Forecast impact · next 24 h · ${station}` : 'Forecast impact'}>
      {station ? (
        <ForecastBody a={a} station={station} tz={tz} />
      ) : (
        <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] leading-snug text-fg-3">
          This airfield has no four-letter ICAO identifier, so there is no TAF to look up. The simulation plans its runway capacity from simulated weather.
        </p>
      )}
    </Section>
  );
}

function ForecastBody({ a, station, tz }: { a: AirportDetail; station: string; tz: string | null }) {
  // Same key and fetcher as the Weather tab's TafCard, so the request is shared.
  const q = useQuery({
    queryKey: ['taf', station],
    queryFn: ({ signal }) => api.taf([station], signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const taf = q.data?.data[0];
  const now = useNow(60_000);
  const hourKey = Math.floor(simNow(now) / 3_600_000);
  const headings = useMemo(
    () => a.runways.filter((r) => !r.closed).flatMap((r) => [r.leHeadingDegT, r.heHeadingDegT].filter((h): h is number => h !== undefined && Number.isFinite(h))),
    [a.runways],
  );
  const hours = useMemo(
    () => (taf ? lib.hourlyForecast(taf, { from: hourKey * 3_600_000, hours: 24, runwayHeadings: headings.length ? headings : undefined }) : []),
    [taf, hourKey, headings],
  );
  const summary = useMemo(() => lib.summarize(hours, (t) => fmtHmIn(t, tz)), [hours, tz]);

  useEffect(() => {
    if (taf) applyForecast(taf, lib);
  }, [taf]);

  if (q.isPending) return <Skeleton className="h-[180px] rounded-[16px]" />;
  if (q.isError) return <ErrorState title="Forecast unavailable" body={(q.error as Error).message} />;
  if (!taf)
    return (
      <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] leading-snug text-fg-3">
        No current TAF for {station}. Forecasts are issued only for larger aerodromes, so the simulation plans runway capacity from simulated weather here.
      </p>
    );
  if (!hours.length)
    return (
      <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] leading-snug text-fg-3">
        The current TAF for {station} does not cover the next 24 hours of simulated time. A new forecast is fetched every 15 minutes.
      </p>
    );

  return (
    <div className="space-y-2.5">
      <div className="glass-2 space-y-2 rounded-[16px] p-3">
        <LevelChip level={summary.level} />
        <p className="text-[13px] font-semibold leading-snug text-fg">{summary.headline}</p>
        {summary.detail.length > 0 && (
          <ul className="space-y-0.5 text-[11.5px] leading-snug text-fg-2">
            {summary.detail.map((d) => (
              <li key={d} className="flex gap-1.5">
                <span aria-hidden className="text-fg-3">
                  •
                </span>
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
      <CapacityStrip hours={hours} from={hourKey * 3_600_000} tz={tz} />
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-fg-2">
        <Info size={13} className="mt-px shrink-0 text-[var(--accent)]" />
        The simulation uses this forecast to plan runway capacity.
      </p>
      <p className="text-[11px] leading-snug text-fg-3">
        Real TAF from NOAA Aviation Weather Center, issued {new Date(taf.issuedAt).toISOString().slice(11, 16)}Z. Capacity is an illustrative model for a busy airport, not an ATFM
        prediction. Times are local ({tzAbbrev(simNow(), tz)}).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- capacity strip

const SLOTS = 24;

function CapacityStrip({ hours, from, tz }: { hours: lib.HourForecast[]; from: number; tz: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  // Always 24 hourly slots so the time axis is stable; hours outside the TAF stay empty.
  const slots = useMemo(() => {
    const byT = new Map(hours.map((x) => [x.t, x]));
    return Array.from({ length: SLOTS }, (_, k) => {
      const t = from + k * 3_600_000;
      const h = byT.get(t);
      return { t, h, level: h ? lib.hourLevel(h) : undefined };
    });
  }, [hours, from]);
  const present = [...new Set(slots.flatMap((x) => (x.level === undefined ? [] : [x.level])))].sort() as Level[];
  const lastCovered = [...slots].reverse().find((x) => x.h);
  const gaps = slots.some((x) => !x.h);
  const hv = hover !== null ? slots[hover] : undefined;
  return (
    <figure className="glass-2 rounded-[16px] p-2.5 pb-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pb-2">
        <span className="text-[12.5px] font-semibold text-fg">Expected arrival capacity</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-fg-2">
          {present.map((l) => {
            const L = LEVEL[l];
            return (
              <span key={l} className="flex items-center gap-1">
                <L.icon size={11} strokeWidth={2.25} style={{ color: L.color }} /> {L.label}
              </span>
            );
          })}
        </span>
      </figcaption>
      <div className="flex pt-3">
        <div className="tnum relative h-[76px] w-8 shrink-0 text-[9px] text-fg-3" aria-hidden>
          {[100, 50, 0].map((v) => (
            <span key={v} className="absolute right-1.5 -translate-y-1/2 leading-none" style={{ top: `${100 - v}%` }}>
              {v}%
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            className="relative h-[76px]"
            role="img"
            aria-label={`Expected arrival capacity by hour: ${slots
              .filter((x) => x.h)
              .map((x) => `${fmtHmIn(x.t, tz)} ${Math.round(x.h!.capacity * 100)}% ${LEVEL[x.level!].label}`)
              .join('; ')}`}
            onPointerLeave={() => setHover(null)}
          >
            {[0, 50].map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-[var(--viz-grid)]" style={{ top: `${100 - v}%` }} />
            ))}
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-[var(--line-strong)]" />
            <div className="absolute inset-0 flex">
              {slots.map((x, i) => {
                if (!x.h || x.level === undefined) return <div key={x.t} className="min-w-0 flex-1" onPointerEnter={() => setHover(null)} />;
                const L = LEVEL[x.level];
                const runStart = x.level >= 1 && slots[i - 1]?.level !== x.level;
                return (
                  <div
                    key={x.t}
                    className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                    style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                  >
                    <div
                      className="relative w-[58%] max-w-[9px] rounded-t-[3px]"
                      style={{ height: `${Math.max(3, x.h.capacity * 100)}%`, background: L.color, opacity: x.h.confidence < 0.9 ? 0.7 : 1 }}
                    >
                      {runStart && <L.icon size={10} strokeWidth={2.5} className="absolute -top-3.5 left-1/2 -translate-x-1/2" style={{ color: L.color }} aria-hidden />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="tnum relative h-4 border-t border-[var(--line-strong)] text-[9px] text-fg-3" aria-hidden>
            {slots.map((x, i) =>
              i % 6 === 0 ? (
                <span key={x.t} className="absolute top-1 -translate-x-1/2" style={{ left: `${((i + 0.5) / SLOTS) * 100}%` }}>
                  {i === 0 ? 'Now' : fmtHmIn(x.t, tz)}
                </span>
              ) : null,
            )}
          </div>
          {hv?.h && hv.level !== undefined && hover !== null && <HourTooltip h={hv.h} i={hover} n={SLOTS} level={hv.level} tz={tz} />}
        </div>
      </div>
      <p className="px-1 pt-1.5 text-[10.5px] leading-snug text-fg-3">
        100% = normal capacity. Paler bars are TEMPO/PROB conditions that may not happen.
        {gaps && lastCovered ? ` The TAF covers until ${fmtHmIn(lastCovered.t + 3_600_000, tz)}.` : ''}
      </p>
    </figure>
  );
}

function HourTooltip({ h, i, n, level, tz }: { h: lib.HourForecast; i: number; n: number; level: Level; tz: string | null }) {
  const speed = useSettings((s) => s.units.speed);
  const L = LEVEL[level];
  const frac = (i + 0.5) / n;
  const shift = frac < 0.25 ? '-10%' : frac > 0.75 ? '-90%' : '-50%';
  const wind =
    h.windKt === undefined
      ? undefined
      : h.windKt === 0
        ? 'Calm'
        : `${h.windDir !== undefined ? `${String(Math.round(h.windDir)).padStart(3, '0')}°` : 'Variable'} ${fmtSpeed(h.windKt, speed)}${h.gustKt ? `, gusts ${fmtSpeed(h.gustKt, speed)}` : ''}`;
  return (
    <div
      className="tnum pointer-events-none absolute bottom-[calc(100%-4px)] z-10 w-[min(240px,80vw)] rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] text-fg shadow-lg"
      style={{ left: `${frac * 100}%`, transform: `translateX(${shift})` }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {fmtHmIn(h.t, tz)}–{fmtHmIn(h.t + 3_600_000, tz)}
        <span className="rounded-[5px] border border-[var(--line-strong)] px-1 text-[10px] font-semibold leading-[15px] text-fg-2">{h.category}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-fg">
        <L.icon size={12} strokeWidth={2.25} style={{ color: L.color }} />
        <span>
          {Math.round(h.capacity * 100)}% capacity · {L.label}
          {level > 0 && h.confidence < 0.9 && <span className="text-fg-3"> · {Math.round(h.confidence * 100)}% chance</span>}
        </span>
      </div>
      <div className="mt-0.5 space-y-px text-fg-2">
        {wind && <div>Wind {wind}</div>}
        {h.visSm !== undefined && <div>Visibility {fmtVis(h.visSm)}</div>}
        <div>{h.ceilingFt !== undefined ? `Ceiling ${h.ceilingFt.toLocaleString()} ft` : 'No ceiling'}</div>
        {h.wx.length > 0 && <div className="first-letter:uppercase">{h.wx.map(decodeWeather).join(', ')}</div>}
      </div>
      {h.causes.length > 0 && <div className="mt-1 border-t border-[var(--line)] pt-1 text-fg">{h.causes.join(' · ')}</div>}
    </div>
  );
}
