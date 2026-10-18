/// <reference lib="webworker" />
// The simulation worker: builds the world, advances it on every tick from the page and
// answers queries. Results are made "light" before posting (airports without their
// stands and runway strips), and the per-tick aircraft state travels as transferred
// typed arrays, so the page's main thread does almost no simulation work.

import * as core from './simCore';

declare const self: DedicatedWorkerGlobalScope;

const SYNC = [
  'simFlight',
  'simBoard',
  'simRunwayInUse',
  'simRoute',
  'simPlannedProfile',
  'simMovementsByHour',
  'simSearch',
  'simStats',
  'simAirline',
  'simAirlineSearch',
  'simWidgets',
  'simDepartureQueue',
  'simStands',
  'simServiceVehicles',
  'simNearestGroundAirport',
  'simHistory',
  'simTypeStats',
  'simAirportHistory',
  'simNatTracks',
  'simElevationFt',
  'simPunctuality',
  'simAirportSummary',
  'simRouteSearch',
  'simRouteFixes',
  'simTaxiPath',
  'simZones',
  'simTrail',
  'simAirportOps',
  'simAirportRoutes',
  'simAirportProcedures',
  'simGroundTraffic',
  'simEtops',
] as const;
const ASYNC = ['simRadio', 'simLoad', 'simAirportRadio', 'simOceanicTracks', 'simSeason'] as const;
export type SyncQuery = (typeof SYNC)[number];
export type AsyncQuery = (typeof ASYNC)[number];
const syncSet = new Set<string>(SYNC);
const asyncSet = new Set<string>(ASYNC);

type AnyFn = (...args: unknown[]) => unknown;
const fn = (name: string) => (core as unknown as Record<string, AnyFn>)[name]!;

// ---------------------------------------------------------------- light copies

const liteAirports = new WeakMap<object, object>();
function liteAirport(a: Record<string, unknown>): object {
  let l = liteAirports.get(a);
  if (!l) {
    l = {};
    for (const k of ['ident', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev', 'large', 'scheduled', 'inUse', 'inUseBasis', 'weather', 'site', 'runways', 'terminals']) {
      if (a[k] !== undefined) (l as Record<string, unknown>)[k] = a[k];
    }
    liteAirports.set(a, l);
  }
  // Weather and the runway in use change over time: refresh those fields.
  Object.assign(l, { inUse: a.inUse, inUseBasis: a.inUseBasis, weather: a.weather });
  return l;
}

/** Deep copy suitable for postMessage, with simulated airports reduced to what the page uses. */
function lite(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v) || v instanceof Map || v instanceof Set || depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => lite(x, depth + 1));
  const o = v as Record<string, unknown>;
  if ('strips' in o && 'runways' in o && 'inUse' in o) return liteAirport(o);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = lite(o[k], depth + 1);
  return out;
}

function callSync(name: string, args: unknown[]): unknown {
  if (!syncSet.has(name)) throw new Error(`unknown query ${name}`);
  return fn(name)(...args);
}

const post = (msg: unknown, transfer?: Transferable[]) => self.postMessage(msg, transfer ?? []);

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; [k: string]: unknown };
  try {
    switch (m.type) {
      case 'init': {
        const r = await core.coreInit(m as unknown as { now: number; seed: number; scale: number });
        post({ type: 'ready', ok: !!r, hubs: r?.hubs ?? [], airframes: r?.airframes ?? 0 });
        if (r) {
          await core.coreLoadExtra(m.scale as number);
          post({ type: 'extra' });
        }
        break;
      }
      case 'tick': {
        const t = core.coreTick(m.sim as number);
        if (!t) {
          post({ type: 'tick', packet: null, results: [], seq: m.seq });
          break;
        }
        const results: [string, unknown][] = [];
        for (const s of m.subs as { key: string; name: string; args: unknown[] }[]) {
          try {
            results.push([s.key, lite(callSync(s.name, s.args))]);
          } catch {
            /* a failing query must not stop the tick */
          }
        }
        post({ type: 'tick', packet: t.packet, results, seq: m.seq }, t.transfer);
        break;
      }
      case 'q': {
        core.setNow(m.sim as number);
        const name = m.name as string;
        const args = m.args as unknown[];
        const value = asyncSet.has(name) ? await (fn(name)(...args) as Promise<unknown>) : callSync(name, args);
        post({ type: 'q', key: m.key, id: m.id, value: lite(value) });
        break;
      }
      case 'weather':
        core.coreSetWeather(m.ident as string, m.w as Parameters<typeof core.coreSetWeather>[1]);
        break;
      case 'forecast':
        await core.coreApplyForecast(m.taf as Parameters<typeof core.coreApplyForecast>[0]);
        break;
      case 'view':
        core.coreViewChanged(m.view as { lat: number; lon: number; zoom: number });
        break;
      case 'ground':
        void core.loadGround(m.ident as string);
        break;
      case 'prepare':
        core.simPrepareFlight(m.id as string);
        break;
      case 'resetMeta':
        core.coreResetMeta();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), id: m.id, key: m.key });
  }
};
