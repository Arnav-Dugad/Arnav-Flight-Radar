// Keyboard navigation between aircraft ( [ and ] ), plus spoken selection summaries.
import { useEffect } from 'react';
import { CLASS_LABEL, classifyAircraft } from '@shared/classify';
import { compileFilter } from '@/lib/filters';
import { fmtAltitude, fmtBearing, fmtSpeed } from '@/lib/format';
import { getMap } from '@/map/controller';
import { useFilters } from '@/state/filters';
import { getSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui, useUI } from '@/state/ui';

let suffix = '';

/** Selects the next/previous visible aircraft in a stable (alphabetical) order. */
export function cycleAircraft(dir: 1 | -1) {
  const map = getMap();
  if (!map) return;
  const bounds = map.getBounds();
  const pred = compileFilter(useFilters.getState().filters);
  const label = (id: string) => {
    const a = traffic.get(id)!.ac;
    return a.callsign ?? a.registration ?? a.icao24.toUpperCase();
  };
  const list = traffic
    .list()
    .filter((t) => !t.lost && pred(t.ac) && bounds.contains([t.ac.lon, t.ac.lat]))
    .map((t) => t.id)
    .sort((a, b) => label(a).localeCompare(label(b)));
  if (!list.length) {
    ui().announce('No aircraft in view.');
    return;
  }
  const cur = ui().selectedId;
  let i = cur ? list.indexOf(cur) : -1;
  i = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  suffix = ` Aircraft ${i + 1} of ${list.length} in view.`;
  ui().select(list[i]!);
}

/** Announces every selection change for screen-reader users. */
export function useSelectionAnnouncer() {
  useEffect(
    () =>
      useUI.subscribe((s, p) => {
        if (s.selectedId === p.selectedId) return;
        if (!s.selectedId) {
          ui().announce('Selection cleared.');
          return;
        }
        const t = traffic.get(s.selectedId);
        if (!t) return;
        const a = t.ac;
        const u = getSettings().units;
        const parts = [
          a.callsign ?? a.registration ?? a.icao24.toUpperCase(),
          a.typeDescription ?? CLASS_LABEL[classifyAircraft(a)],
          a.onGround ? 'on the ground' : `altitude ${fmtAltitude(a.altitudeBarometric ?? a.altitudeGeometric, u.altitude)}`,
          `ground speed ${fmtSpeed(a.groundSpeed, u.speed)}`,
          `track ${fmtBearing(a.track)}`,
        ];
        ui().announce(`Selected ${parts.join(', ')}.${suffix}`);
        suffix = '';
      }),
    [],
  );
}
