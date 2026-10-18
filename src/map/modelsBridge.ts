// Feeds the 3D model layer with the aircraft in view (loaded on demand, only when the
// user zooms in close or flies the chase view). Each model gets its type's real length
// and span, its airline's livery colours, a pitch attitude from the climb/descent rate
// and a bank angle from the rate of turn.

import type { Map as MlMap } from 'maplibre-gl';
import { AIRLINE_EXTRA } from '@/data/sim/airlineInfo';
import { specOf } from '@/data/sim/typeSpecs';
import { simElevationFt } from '@/data/world';
import { getSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui } from '@/state/ui';
import { installModels, type ModelInstance, type ModelsHandle } from './models3d';

const hexRgb = (h: string): [number, number, number] => {
  const n = Number.parseInt(h.replace('#', '').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const MIL: [number, number, number] = [0.47, 0.5, 0.52];
const WHITE: [number, number, number] = [0.95, 0.96, 0.97];
const GA_TAIL: [number, number, number] = [0.16, 0.34, 0.62];

const turn = new Map<string, { trk: number; t: number; bank: number }>();

function attitude(id: string, trk: number, gs: number, vr: number, onGround: boolean, now: number): { pitch: number; roll: number } {
  if (onGround) return { pitch: gs > 60 ? 0 : 0, roll: 0 };
  const prev = turn.get(id);
  let bank = prev?.bank ?? 0;
  if (prev && now - prev.t > 200) {
    const d = ((trk - prev.trk + 540) % 360) - 180;
    const rate = (d / ((now - prev.t) / 1000)) * (Math.PI / 180); // rad/s
    const v = gs * 0.5144;
    const target = Math.max(-35, Math.min(35, (Math.atan((v * rate) / 9.81) * 180) / Math.PI));
    bank += (target - bank) * 0.35;
    turn.set(id, { trk, t: now, bank });
  } else if (!prev) turn.set(id, { trk, t: now, bank: 0 });
  // Flight-path angle plus a few degrees of body attitude (nose up when slow).
  const gamma = (Math.atan2(vr / 60, Math.max(60, gs) * 1.688) * 180) / Math.PI;
  const body = gs < 200 ? 4 : 2;
  return { pitch: Math.max(-6, Math.min(18, gamma + body)), roll: bank };
}

function instances(map: MlMap): ModelInstance[] {
  if (!getSettings().show3dModels) return [];
  const now = Date.now();
  const b = map.getBounds();
  const w = b.getWest();
  const e = b.getEast();
  const s = b.getSouth();
  const n = b.getNorth();
  const selected = ui().selectedId;
  const out: ModelInstance[] = [];
  for (const t of traffic.tracks.values()) {
    const a = t.ac;
    const pos = traffic.displayPosition(t, now);
    if (pos.lat < s || pos.lat > n || pos.lon < w || pos.lon > e) {
      if (t.id !== selected) continue;
    }
    const spec = a.aircraftType ? specOf(a.aircraftType) : undefined;
    if (!spec) continue;
    const icao = a.callsign?.slice(0, 3) ?? '';
    const extra = AIRLINE_EXTRA[icao];
    const body = a.military ? MIL : extra ? hexRgb(extra.body) : WHITE;
    const tail = a.military ? MIL : extra ? hexRgb(extra.tail) : GA_TAIL;
    const altFt = a.onGround ? (simElevationFt(t.id) ?? 0) : (a.altitudeBarometric ?? 0);
    const trk = pos.trk ?? a.track ?? 0;
    const att = attitude(t.id, trk, a.groundSpeed ?? 0, a.verticalRate ?? 0, a.onGround, now);
    const inst: ModelInstance = {
      id: t.id,
      lat: pos.lat,
      lon: pos.lon,
      altM: altFt * 0.3048,
      hdg: trk,
      pitch: att.pitch,
      roll: att.roll,
      shape: spec.shape,
      lengthM: spec.lengthM,
      spanM: spec.spanM,
      body,
      tail,
      selected: t.id === selected,
    };
    if (spec.engines.kind === 'turboprop' || spec.engines.kind === 'piston' || spec.engines.kind === 'turboshaft') inst.rotorRpm = a.onGround && (a.groundSpeed ?? 0) < 2 ? 0 : 1;
    out.push(inst);
    if (out.length >= 300) break;
  }
  return out;
}

export function startModels(map: MlMap): ModelsHandle {
  return installModels(map, () => instances(map), { minZoom: 12.5, ...(map.getLayer('ac-labels') ? { beforeId: 'ac-labels' } : {}) });
}
