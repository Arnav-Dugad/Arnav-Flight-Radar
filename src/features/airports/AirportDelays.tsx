// Delays tab: seven days of (simulated) punctuality at an airport, plus the real TAF
// turned into an hour-by-hour capacity outlook (AirportForecast).
import { CloudFog, CloudLightning, CloudRain, Snowflake, Sun, Wind, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AirportDetail } from '@shared/types';
import { Section } from '@/components/ui/Glass';
import { simAirportHistory, type DayStats } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { useTimeZone } from '@/lib/tz';
import { AirportForecast } from './AirportForecast';

const WEATHER_INFO: Record<DayStats['weather'], { icon: LucideIcon; label: string }> = {
  fine: { icon: Sun, label: 'Fine' },
  rain: { icon: CloudRain, label: 'Rain' },
  storms: { icon: CloudLightning, label: 'Storms' },
  fog: { icon: CloudFog, label: 'Fog' },
  snow: { icon: Snowflake, label: 'Snow' },
  wind: { icon: Wind, label: 'Wind' },
};

/** Fill for modelled (not observed) values: a 135° hatch of the series colour. */
const HATCH = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--viz-1) 62%, transparent) 0 1.5px, color-mix(in srgb, var(--viz-1) 20%, transparent) 1.5px 4.5px)';

const dayFmt = new Map<string, { short: Intl.DateTimeFormat; long: Intl.DateTimeFormat }>();
function fmtDay(ms: number, tz: string | null) {
  const key = tz ?? 'UTC';
  let f = dayFmt.get(key);
  if (!f) {
    try {
      f = {
        short: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: key }),
        long: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: key }),
      };
    } catch {
      f = {
        short: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }),
        long: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
      };
    }
    dayFmt.set(key, f);
  }
  // Midday UTC lands on the same calendar day almost everywhere.
  return { short: f.short.format(ms + 12 * 3_600_000), long: f.long.format(ms + 12 * 3_600_000) };
}

const hasData = (d: DayStats) => d.movements > 0;

export function AirportDelays({ a, station }: { a: AirportDetail; station: string | null }) {
  const now = useNow(60_000);
  const tz = useTimeZone(a.lat, a.lon);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => simAirportHistory(a.ident), [a.ident, Math.floor(now / 60_000)]);
  return (
    <div className="space-y-5">
      {days?.some(hasData) ? (
        <Section title="Punctuality · last 7 days">
          <PunctualityChart days={days} tz={tz} />
          <Summary days={days} />
          <p className="text-[11px] leading-snug text-fg-3">
            Simulated. Today comes from the running simulation (a departure within 15 minutes of schedule counts as on time); earlier days are modelled from today’s traffic, the
            weekday pattern and typical weather for the season.
          </p>
        </Section>
      ) : (
        <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">
          No scheduled airline traffic at this airport in the simulation, so there is no punctuality record.
        </p>
      )}
      <AirportForecast a={a} station={station} tz={tz} />
    </div>
  );
}

// ---------------------------------------------------------------- 7-day chart

function PunctualityChart({ days, tz }: { days: DayStats[]; tz: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? days[hover] : undefined;
  const label = (d: DayStats) => (d.source === 'sim' ? 'Today' : fmtDay(d.day, tz).short);
  return (
    <figure className="glass-2 rounded-[16px] p-2.5 pb-2">
      <figcaption className="space-y-1 px-1 pb-2">
        <div className="text-[12.5px] font-semibold text-fg">On-time departures</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fg-2">
          <span className="flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-[2px] bg-[var(--viz-1)]" /> Today (simulated so far)
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-[2px] ring-1 ring-inset ring-[color-mix(in_srgb,var(--viz-1)_55%,transparent)]" style={{ backgroundImage: HATCH }} />{' '}
            Modelled (before you opened the site)
          </span>
        </div>
      </figcaption>

      <div className="flex">
        {/* y axis */}
        <div className="tnum relative h-[112px] w-8 shrink-0 text-[9px] text-fg-3" aria-hidden>
          {[100, 50, 0].map((v) => (
            <span key={v} className="absolute right-1.5 -translate-y-1/2 leading-none" style={{ top: `${100 - v}%` }}>
              {v}%
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            className="relative h-[112px]"
            role="img"
            aria-label={`On-time departures by day: ${days.map((d) => `${label(d)} ${hasData(d) ? `${d.onTimePct}% on time, average delay ${d.avgDelayMin} minutes, ${WEATHER_INFO[d.weather].label}` : 'no data yet'}${d.source === 'model' ? ' (modelled)' : ''}`).join('; ')}`}
            onPointerLeave={() => setHover(null)}
          >
            {[0, 50, 100].map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-[var(--viz-grid)]" style={{ top: `${100 - v}%` }} />
            ))}
            <div className="absolute inset-0 grid grid-cols-7">
              {days.map((d, i) => {
                const today = d.source === 'sim';
                return (
                  <div
                    key={d.day}
                    className="relative flex h-full items-end justify-center"
                    style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                  >
                    {hasData(d) ? (
                      <div
                        className={cn(
                          'relative w-[14px] rounded-t-[4px]',
                          today ? 'bg-[var(--viz-1)]' : 'ring-1 ring-inset ring-[color-mix(in_srgb,var(--viz-1)_55%,transparent)]',
                        )}
                        style={{ height: `${d.onTimePct}%`, backgroundImage: today ? undefined : HATCH }}
                      >
                        {today && <span className="tnum absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-fg">{d.onTimePct}%</span>}
                      </div>
                    ) : (
                      <span className="mb-1 text-[10px] text-fg-3">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* per-day labels: weekday, average delay, weather */}
          <div className="grid grid-cols-7 border-t border-[var(--line-strong)] pt-1.5" aria-hidden>
            {days.map((d, i) => {
              const W = WEATHER_INFO[d.weather];
              return (
                <div key={d.day} className="flex min-w-0 flex-col items-center gap-0.5 text-center" style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}>
                  <span className={cn('text-[10.5px] font-semibold leading-tight', d.source === 'sim' ? 'text-fg' : 'text-fg-2')}>{label(d)}</span>
                  <span className="tnum text-[10px] leading-tight text-fg-3">{hasData(d) ? `${d.avgDelayMin} min` : '—'}</span>
                  <W.icon size={14} strokeWidth={1.75} className="mt-1 text-fg-2" />
                  <span className="text-[9.5px] leading-tight text-fg-3">{W.label}</span>
                </div>
              );
            })}
          </div>

          {h && hover !== null && <DayTooltip d={h} i={hover} tz={tz} />}
        </div>
      </div>
      <p className="px-1 pt-2 text-[10.5px] leading-snug text-fg-3">Bars: share of departures on time. Under each day: average departure delay and the day’s weather.</p>
    </figure>
  );
}

function DayTooltip({ d, i, tz }: { d: DayStats; i: number; tz: string | null }) {
  const W = WEATHER_INFO[d.weather];
  const left = `${((i + 0.5) / 7) * 100}%`;
  const shift = i <= 1 ? '-15%' : i >= 5 ? '-85%' : '-50%';
  return (
    <div
      className="tnum pointer-events-none absolute bottom-[calc(100%-8px)] z-10 w-max whitespace-nowrap rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] text-fg shadow-lg"
      style={{ left, transform: `translateX(${shift})` }}
    >
      <div className="font-semibold">
        {d.source === 'sim' ? 'Today' : fmtDay(d.day, tz).long}
        <span className="font-normal text-fg-3"> · {d.source === 'sim' ? 'simulated so far' : 'modelled'}</span>
      </div>
      {hasData(d) ? (
        <>
          <div className="text-fg-2">
            {d.onTimePct}% on time · avg delay {d.avgDelayMin} min
          </div>
          <div className="text-fg-2">
            {d.movements.toLocaleString()} movements · {d.canceled} canceled · {d.diverted} diverted
          </div>
        </>
      ) : (
        <div className="text-fg-2">No departures yet today</div>
      )}
      <div className="mt-0.5 flex items-center gap-1 text-fg-2">
        <W.icon size={12} /> {W.label}
      </div>
    </div>
  );
}

function Summary({ days }: { days: DayStats[] }) {
  const withData = days.filter(hasData);
  const n = Math.max(1, withData.length);
  const onTime = Math.round(withData.reduce((s, d) => s + d.onTimePct, 0) / n);
  const delay = Math.round(withData.reduce((s, d) => s + d.avgDelayMin, 0) / n);
  const canceled = days.reduce((s, d) => s + d.canceled, 0);
  const diverted = days.reduce((s, d) => s + d.diverted, 0);
  const tiles: [string, string, string][] = [
    ['On time', withData.length ? `${onTime}%` : '—', '7-day avg'],
    ['Avg delay', withData.length ? `${delay} min` : '—', '7-day avg'],
    ['Canceled', canceled.toLocaleString(), '7-day total'],
    ['Diverted', diverted.toLocaleString(), '7-day total'],
  ];
  return (
    <dl className="glass-2 grid grid-cols-4 divide-x divide-[var(--line)] rounded-[16px] py-2.5">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="flex min-w-0 flex-col px-2.5">
          <dt className="truncate text-[10.5px] font-medium text-fg-2">{label}</dt>
          <dd className="tnum mt-1 truncate text-[17px] font-semibold leading-none tracking-[-0.01em] text-fg">{value}</dd>
          <dd className="mt-1 truncate text-[10px] text-fg-3">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}
