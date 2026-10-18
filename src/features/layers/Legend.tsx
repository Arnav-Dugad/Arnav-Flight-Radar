import { ALTITUDE_STOPS, GROUND_COLOR, SPEED_STOPS, VERTICAL_STOPS, type Stop } from '@/lib/colors';
import { useSettings } from '@/state/settings';

function Gradient({ stops, labels }: { stops: Stop[]; labels: [number, string][] }) {
  const min = stops[0]![0];
  const max = stops[stops.length - 1]![0];
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const css = `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${pct(v)}%`).join(', ')})`;
  return (
    <div>
      <div className="h-2.5 rounded-full" style={{ background: css }} />
      <div className="tnum relative mt-1.5 h-4 text-[10.5px] text-fg-3">
        {labels.map(([v, l], i) => (
          <span
            key={v}
            className="absolute"
            style={{ left: `${pct(v)}%`, transform: i === 0 ? 'none' : i === labels.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Legend for the current aircraft colour mode (colour is never the only channel: values are labelled). */
export function Legend() {
  const mode = useSettings((s) => s.colorMode);
  const palette = useSettings((s) => s.altitudePalette);
  if (mode === 'altitude')
    return (
      <div className="space-y-2">
        <Gradient
          stops={ALTITUDE_STOPS[palette]}
          labels={[
            [0, '0'],
            [10000, '10k'],
            [26000, '26k'],
            [ALTITUDE_STOPS[palette].at(-1)![0], '41k+ ft'],
          ]}
        />
        <div className="flex items-center gap-4 text-[11px] text-fg-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: GROUND_COLOR }} /> On ground
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#c3cfdd]" /> Altitude not reported
          </span>
        </div>
      </div>
    );
  if (mode === 'speed')
    return (
      <Gradient
        stops={SPEED_STOPS}
        labels={[
          [0, '0'],
          [200, '200'],
          [350, '350'],
          [550, '550+ kt'],
        ]}
      />
    );
  if (mode === 'vertical')
    return (
      <Gradient
        stops={VERTICAL_STOPS}
        labels={[
          [-3000, '−3000'],
          [0, 'Level'],
          [3000, '+3000 ft/min'],
        ]}
      />
    );
  if (mode === 'freshness')
    return (
      <div className="flex gap-4 text-[11.5px] text-fg-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#5ce1ff]" /> Live
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#7d8ea5]" /> Stale / lost (also faded)
        </span>
      </div>
    );
  if (mode === 'classic')
    return (
      <div className="flex gap-4 text-[11.5px] text-fg-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ffcc33]" /> Airborne
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#c9a74d]" /> On the ground
        </span>
      </div>
    );
  return <p className="text-[11.5px] text-fg-3">All aircraft drawn in one colour.</p>;
}
