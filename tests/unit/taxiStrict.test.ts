import majorRaw from '../../public/data/airports/index-major.json?raw';
import runwaysRaw from '../../public/data/airports/runways-major.json?raw';
import standsRaw from '../../public/data/ground/stands.json?raw';
import lhrRaw from '../../public/data/ground/EGLL.json?raw';
import { describe, expect, it, vi } from 'vitest';
import { decodeRow, type AirportRow } from '@shared/airports';
import { bearingDeg, distanceNm } from '@shared/geo';
import { World, type Pt, type TaxiGraph } from '@/data/sim/engine';
import { attach, fillet, pushbackPath, routeOnGraph } from '@/data/sim/taxiGeo';

vi.setConfig({ testTimeout: 90_000 });

const airports = (JSON.parse(majorRaw) as { rows: AirportRow[] }).rows.map(decodeRow);
const runways = (JSON.parse(runwaysRaw) as { runways: Record<string, never[]> }).runways;
const NOW = Date.UTC(2026, 9, 18, 9, 0, 0);

function graphOf(j: { nodes: Pt[]; edges: [number, number, number?][]; names?: string[]; holds?: [number, number, string][] }): TaxiGraph {
  const adj: number[][] = j.nodes.map(() => []);
  const edgeNames = new Map<string, string>();
  for (const [x, y, nm] of j.edges) {
    adj[x]!.push(y);
    adj[y]!.push(x);
    if (nm !== undefined && nm >= 0 && j.names?.[nm]) edgeNames.set(x < y ? `${x}-${y}` : `${y}-${x}`, j.names[nm]!);
  }
  return { nodes: j.nodes, adj, edgeNames, holds: (j.holds ?? []).map(([la, lo, ref]) => ({ pt: [la, lo] as Pt, ref })) };
}

/** Distance (NM) from a point to the nearest edge of the graph. */
function offNetwork(g: TaxiGraph, p: Pt): number {
  const a = attach(g, p);
  return a ? a.d : Infinity;
}

describe('taxi geometry', () => {
  // A plus-shaped network with a stray fragment far away.
  const nodes: Pt[] = [
    [51.47, -0.46],
    [51.47, -0.45],
    [51.47, -0.44],
    [51.475, -0.45],
    [51.465, -0.45],
    [51.49, -0.40],
    [51.491, -0.40],
  ];
  const g: TaxiGraph = { nodes, adj: [[1], [0, 2, 3, 4], [1], [1], [1], [6], [5]], edgeNames: new Map([['0-1', 'A'], ['1-2', 'A'], ['1-3', 'B'], ['1-4', 'B']]) };

  it('joins the network on an edge, not at the nearest vertex', () => {
    const a = attach(g, [51.4703, -0.455])!;
    expect(a.d).toBeLessThan(0.03);
    expect(Math.abs(a.pt[0] - 51.47)).toBeLessThan(1e-6);
  });

  it('routes along the centre lines and names the taxiways', () => {
    const r = routeOnGraph(g, [51.4702, -0.458], [51.4745, -0.4502])!;
    expect(r.via).toEqual(['A', 'B']);
    for (const p of r.pts.slice(1, -1)) expect(offNetwork(g, p)).toBeLessThan(0.001);
  });

  it('ignores disconnected fragments of the network', () => {
    // The point is nearest the stray fragment, but the route stays on the main network.
    const a = attach(g, [51.4905, -0.401])!;
    expect([a.u, a.v].some((n) => n >= 5)).toBe(false);
  });

  it('rounds corners but keeps the ends', () => {
    const pts: Pt[] = [
      [51.47, -0.46],
      [51.47, -0.45],
      [51.475, -0.45],
    ];
    const f = fillet(pts, 0.02);
    expect(f[0]).toEqual(pts[0]);
    expect(f[f.length - 1]).toEqual(pts[2]);
    expect(f.length).toBeGreaterThan(4);
    // No single heading change on the curve is near 90°.
    let maxTurn = 0;
    for (let i = 1; i < f.length - 1; i++) {
      const d = Math.abs((((bearingDeg(f[i]![0], f[i]![1], f[i + 1]![0], f[i + 1]![1]) - bearingDeg(f[i - 1]![0], f[i - 1]![1], f[i]![0], f[i]![1])) % 360) + 540) % 360 - 180);
      maxTurn = Math.max(maxTurn, d);
    }
    expect(maxTurn).toBeLessThan(35);
  });

  it('pushes back onto the taxilane, away from the direction of taxi', () => {
    const stand: Pt = [51.4708, -0.452];
    const p = pushbackPath(g, stand, [51.47, -0.46])!;
    expect(p[0]).toEqual(stand);
    const end = p[p.length - 1]!;
    expect(offNetwork(g, end)).toBeLessThan(0.001);
    // Pushed east, so it can taxi west.
    expect(end[1]).toBeGreaterThan(-0.452);
  });
});

describe('strict taxiway following at Heathrow (real OpenStreetMap network)', () => {
  const g = graphOf(JSON.parse(lhrRaw));
  const stands = JSON.parse(standsRaw) as { airports: Record<string, never> };

  function heathrow() {
    const w = new World(11, airports, runways);
    w.setStands({ EGLL: stands.airports.EGLL! });
    w.setTaxiGraph('EGLL', g, NOW);
    w.populate(NOW, 0.35);
    w.advance(NOW + 3 * 3_600_000);
    return w;
  }

  it('keeps every taxi movement on the taxiway centre lines', () => {
    const w = heathrow();
    let checked = 0;
    let worst = 0;
    for (const af of w.airframes) {
      const leg = af.leg;
      if (!af.airline || (leg.from.ident !== 'EGLL' && leg.to.ident !== 'EGLL')) continue;
      for (const s of leg.segs) {
        if (s.phase !== 'taxi' || s.kind !== 'path' || !s.pts) continue;
        // Skip the lead-ins at both ends (stand → centre line → turn, centre line → runway).
        const first = s.pts[0]!;
        const last = s.pts[s.pts.length - 1]!;
        for (const p of s.pts) {
          if (distanceNm(p[0], p[1], first[0], first[1]) < 0.13 || distanceNm(p[0], p[1], last[0], last[1]) < 0.13) continue;
          worst = Math.max(worst, offNetwork(g, p));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    // Within ~15 m of a centre line (fillets cut corners slightly).
    expect(worst).toBeLessThan(0.0085);
  });

  it('holds short before the departure runway, then lines up and takes off on the centre line', () => {
    const w = heathrow();
    const deps = w.airframes.filter((af) => af.airline && af.leg.from.ident === 'EGLL' && af.leg.tOff > NOW && !af.leg.canceled);
    expect(deps.length).toBeGreaterThan(10);
    const a = w.airports.get('EGLL')!;
    let named = 0;
    for (const af of deps.slice(0, 30)) {
      const leg = af.leg;
      const rw = a.runways.find((r) => r.ident === leg.taxiOut?.runway)!;
      expect(rw).toBeTruthy();
      const tk = leg.segs.find((s) => s.phase === 'takeoff')!;
      // Take-off roll starts on the runway centre line, within the first ~22% of the runway.
      const along = distanceNm(rw.lat, rw.lon, tk.a[0], tk.a[1]);
      expect(along).toBeLessThan(Math.max(0.3, rw.lengthNm * 0.22) + 0.02);
      if (along > 0.05) {
        const off = Math.abs(((bearingDeg(rw.lat, rw.lon, tk.a[0], tk.a[1]) - rw.hdg + 540) % 360) - 180);
        expect(off).toBeLessThan(4);
      }
      if (leg.taxiOut?.hold) named++;
      // The push-back is tail-first along the taxilane.
      const push = leg.segs.find((s) => s.phase === 'pushback');
      if (push?.kind === 'path') expect(push.reverse).toBe(true);
    }
    expect(named).toBeGreaterThan(0);
  });

  it('segregates Heathrow: arrivals on one runway, departures on the other', () => {
    const w = heathrow();
    const a = w.airports.get('EGLL')!;
    w.runwaysAt(a, NOW);
    expect(a.inUseDep).toBeTruthy();
    expect(a.inUseDep!.ident).not.toBe(a.inUse.ident);
    expect(a.inUseDep!.ident.slice(0, 2)).toBe(a.inUse.ident.slice(0, 2));
    // Alternation: at 15:00 local the runways swap.
    const before = [a.inUse.ident, a.inUseDep!.ident];
    w.runwaysAt(a, Date.UTC(2026, 9, 18, 15, 30));
    expect([a.inUse.ident, a.inUseDep!.ident]).toEqual([before[1], before[0]]);
  });
});
