// Departure (SID) and arrival (STAR) procedures for the runways in use (lazy chunk of the
// airport panel). US airports list the REAL published FAA CIFP procedures; elsewhere the
// simulator generates procedure-style ones over real navaids, labelled as simulated.
// Choosing one draws it on the map and as a small plan-view diagram here.
import { Navigation2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AirportDetail } from '@shared/types';
import { SegmentedControl } from '@/components/ui/Controls';
import { Skeleton } from '@/components/ui/Feedback';
import { simAirportProcedures } from '@/data/world';
import type { Fix, Procedure } from '@/data/sim/procedures';
import { cn } from '@/lib/cn';
import { useUI, type AirportOverlayFix } from '@/state/ui';

/** A fix with an optional published altitude constraint (feet). */
type ProcFix = Fix & { altMin?: number; altMax?: number };

const ft = (v: number) => (v >= 18_000 ? `FL${Math.round(v / 100)}` : v.toLocaleString('en-US'));

/** "≥5,000" (at or above), "≤11,000" (at or below), "9,000" (at), "11,000–13,000" (window). */
export function fmtConstraint(f: { altMin?: number; altMax?: number }): string | undefined {
  const { altMin: lo, altMax: hi } = f;
  if (lo === undefined && hi === undefined) return undefined;
  if (lo !== undefined && hi !== undefined) return lo === hi ? ft(lo) : `${ft(lo)}–${ft(hi)}`;
  return lo !== undefined ? `≥${ft(lo)}` : `≤${ft(hi!)}`;
}

/** Fixes of a procedure in flight order (simulated procedures have just their exit / entry fix). */
export function procedureFixes(p: Procedure): ProcFix[] {
  return (p.fixes?.length ? p.fixes : [p.fix]) as ProcFix[];
}

const W = 320;
const H = 176;
const PAD = 26;

function Diagram({ p, kind, a }: { p: Procedure; kind: 'sid' | 'star'; a: AirportDetail }) {
  const fixes = procedureFixes(p);
  const k = Math.cos((a.lat * Math.PI) / 180);
  const raw = fixes.map((f) => [(f.lon - a.lon) * k, f.lat - a.lat] as const);
  const xs = [0, ...raw.map((r) => r[0])];
  const ys = [0, ...raw.map((r) => r[1])];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((W - PAD * 2) / Math.max(1e-4, x1 - x0), (H - PAD * 2) / Math.max(1e-4, y1 - y0));
  const cx = (W - (x1 - x0) * s) / 2 - x0 * s;
  const cy = (H - (y1 - y0) * s) / 2 + y1 * s;
  const P = (x: number, y: number) => [cx + x * s, cy - y * s] as const;
  const pts = raw.map(([x, y]) => P(x, y));
  const apt = P(0, 0);
  const path = (kind === 'sid' ? [apt, ...pts] : [...pts, apt]).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const published = !!p.published;
  // Thin out labels on long procedures so they stay legible.
  const every = fixes.length > 9 ? 2 : 1;
  return (
    <figure className="glass-2 overflow-hidden rounded-[16px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${p.name} ${kind === 'sid' ? 'departure' : 'arrival'}: ${kind === 'sid' ? `${a.iata ?? a.ident}, ` : ''}${fixes.map((f) => f.ident).join(', ')}${kind === 'star' ? `, ${a.iata ?? a.ident}` : ''}`}>
        <defs>
          <marker id="proc-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#c4b5fd" />
          </marker>
        </defs>
        <text x={W - 10} y={16} fontSize="9" textAnchor="end" fill="var(--fg-3)" fontWeight="700">
          N ↑
        </text>
        <path d={path} fill="none" stroke="var(--canvas)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" opacity="0.6" />
        <path d={path} fill="none" stroke="#c4b5fd" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={published ? undefined : '5 4'} markerEnd="url(#proc-arrow)" />
        <circle cx={apt[0]} cy={apt[1]} r="6" fill="var(--accent)" stroke="var(--canvas)" strokeWidth="2" />
        <text x={apt[0]} y={apt[1] + 17} fontSize="9.5" textAnchor="middle" fill="var(--accent)" fontWeight="700">
          {a.iata ?? a.ident}
        </text>
        {fixes.map((f, i) => {
          const [x, y] = pts[i]!;
          const c = fmtConstraint(f);
          const show = i % every === 0 || i === fixes.length - 1 || !!c;
          // Label beside the route (perpendicular to it at this fix), always on the same side,
          // so fixes along a straight leg do not stack their names on top of each other.
          const order = kind === 'sid' ? [apt, ...pts] : [...pts, apt];
          const j = kind === 'sid' ? i + 1 : i;
          const prev = order[Math.max(0, j - 1)]!;
          const next = order[Math.min(order.length - 1, j + 1)]!;
          let [ux, uy] = [-(next[1] - prev[1]), next[0] - prev[0]];
          const len = Math.hypot(ux, uy) || 1;
          [ux, uy] = [ux / len, uy / len];
          if (ux < -0.05 || (Math.abs(ux) <= 0.05 && uy < 0)) [ux, uy] = [-ux, -uy];
          if (ux > 0.35 && x > W - 64) [ux, uy] = [-ux, -uy]; // no room on the right edge
          const lx = Math.max(14, Math.min(W - 14, x + ux * 11));
          const ly = Math.max(10, Math.min(H - (c ? 14 : 4), y + uy * 11 + 3));
          const anchor = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
          return (
            <g key={`${f.ident}${i}`}>
              {f.real ? (
                <circle cx={x} cy={y} r="3.6" fill="var(--canvas)" stroke="#c4b5fd" strokeWidth="1.8" />
              ) : (
                <path d={`M${x},${y - 4.2} L${x + 4},${y + 3} L${x - 4},${y + 3} z`} fill="var(--canvas)" stroke="#c4b5fd" strokeWidth="1.6" />
              )}
              {show && (
                <text x={lx} y={ly} fontSize="8.5" textAnchor={anchor} fill="var(--fg)" fontWeight="700" className="tnum" paintOrder="stroke" stroke="var(--canvas)" strokeWidth="2.5" strokeLinejoin="round">
                  {f.ident}
                  {c && (
                    <tspan x={lx} dy={9.5} fontSize="7.5" fontWeight="600" fill="#ffc56e">
                      {c}
                    </tspan>
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="border-t border-[var(--line)] px-3 py-2.5">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px]" aria-label="Fixes in order">
          {kind === 'sid' && <li className="font-semibold text-[var(--accent)]">{a.iata ?? a.ident}</li>}
          {fixes.map((f, i) => {
            const c = fmtConstraint(f);
            return (
              <li key={`${f.ident}${i}`} className="flex items-center gap-1">
                {(i > 0 || kind === 'sid') && (
                  <span className="text-fg-3" aria-hidden="true">
                    →
                  </span>
                )}
                <span className="tnum rounded-[6px] bg-[var(--line)] px-1.5 py-0.5 font-semibold text-fg">
                  {f.ident}
                  {c && <span className="ml-1 font-medium text-[#ffc56e]">{c}</span>}
                </span>
              </li>
            );
          })}
          {kind === 'star' && (
            <li className="flex items-center gap-1">
              <span className="text-fg-3" aria-hidden="true">
                →
              </span>
              <span className="font-semibold text-[var(--accent)]">{a.iata ?? a.ident}</span>
            </li>
          )}
        </ol>
        {!fixes.some((f) => f.altMin !== undefined || f.altMax !== undefined) && (
          <p className="mt-1.5 text-[10.5px] text-fg-3">{published ? 'Altitude constraints are not shown for this procedure.' : 'Simulated procedure: one exit / entry fix over a real navaid, no altitude constraints.'}</p>
        )}
      </figcaption>
    </figure>
  );
}

export function AirportProcedures({ a }: { a: AirportDetail }) {
  const data = simAirportProcedures(a.ident);
  const [kind, setKind] = useState<'sid' | 'star'>('sid');
  const [chosen, setChosen] = useState<string | null>(null);
  const setOverlay = useUI((s) => s.setAirportOverlay);
  const list = data ? (kind === 'sid' ? data.sids : data.stars) : [];
  const sel = list.find((p) => p.name === chosen) ?? null;
  const fixesKey = sel ? procedureFixes(sel).map((f) => `${f.ident}${f.lat.toFixed(3)}`).join(',') : '';

  useEffect(() => {
    if (!sel) {
      const o = useUI.getState().airportOverlay;
      if (o?.kind === 'procedure') setOverlay(null);
      return;
    }
    const fixes: AirportOverlayFix[] = procedureFixes(sel).map((f) => {
      const c = fmtConstraint(f);
      return { ident: f.ident, lon: f.lon, lat: f.lat, ...(c ? { alt: c } : {}) };
    });
    setOverlay({ kind: 'procedure', airport: a.ident, origin: [a.lon, a.lat], name: sel.name, proc: kind, fixes, published: !!sel.published, fit: `${kind}${sel.name}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sel` is a fresh object every refresh; `fixesKey` captures what matters
  }, [fixesKey, kind, a.ident, a.lon, a.lat, setOverlay]);
  useEffect(
    () => () => {
      const o = useUI.getState().airportOverlay;
      if (o?.kind === 'procedure') useUI.getState().setAirportOverlay(null);
    },
    [],
  );

  if (!data)
    return (
      <section className="space-y-2" aria-busy="true" aria-label="Loading procedures">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-28 rounded-[16px]" />
      </section>
    );
  if (!data.sids.length && !data.stars.length) return null;

  return (
    <section className="space-y-2.5" aria-label="Departure and arrival procedures">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eyebrow">Procedures · runways in use</h3>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            data.published ? 'border-[rgba(61,220,151,0.3)] bg-[rgba(61,220,151,0.12)] text-[#57e3a6]' : 'border-[var(--line)] bg-[var(--line)] text-fg-2',
          )}
          title={data.published ? 'Real published procedures from the FAA Coded Instrument Flight Procedures (public domain). Not for navigation.' : 'Generated by the simulator in the style of real SIDs and STARs over real navaids. Not real procedures.'}
        >
          {data.published ? `Published · ${data.sids[0]?.published ?? data.stars[0]?.published ?? 'FAA CIFP'}` : 'Simulated procedures'}
        </span>
      </div>
      <SegmentedControl
        size="sm"
        label="Procedure type"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setChosen(null);
        }}
        options={[
          { value: 'sid', label: `Departures · ${data.depRunway} (${data.sids.length})` },
          { value: 'star', label: `Arrivals · ${data.arrRunway} (${data.stars.length})` },
        ]}
      />
      {list.length === 0 ? (
        <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">No {kind === 'sid' ? 'departure' : 'arrival'} procedure is listed for runway {kind === 'sid' ? data.depRunway : data.arrRunway}.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5 min-[400px]:grid-cols-3" aria-label={kind === 'sid' ? 'Departure procedures' : 'Arrival procedures'}>
          {list.map((p) => {
            const on = p.name === chosen;
            const fx = procedureFixes(p);
            const end = kind === 'sid' ? fx[fx.length - 1] : fx[0];
            return (
              <li key={p.name}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen(on ? null : p.name)}
                  className={cn(
                    'w-full rounded-[12px] border px-2.5 py-2 text-left transition-colors',
                    on ? 'border-[rgba(167,139,250,0.5)] bg-[rgba(167,139,250,0.14)]' : 'border-[var(--line)] bg-[var(--line)] hover:border-[var(--line-strong)]',
                  )}
                >
                  <span className={cn('tnum block truncate text-[12.5px] font-semibold', on ? 'text-[#c4b5fd]' : 'text-fg')}>{p.name}</span>
                  <span className="tnum mt-0.5 block truncate text-[10.5px] text-fg-3">
                    {kind === 'sid' ? 'exit' : 'entry'} {end?.ident ?? '—'}
                    {fx.length > 1 ? ` · ${fx.length} fixes` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sel ? (
        <Diagram p={sel} kind={kind} a={a} />
      ) : (
        list.length > 0 && (
          <p className="flex items-center gap-1.5 px-0.5 text-[11px] text-fg-3">
            <Navigation2 size={12} aria-hidden="true" /> Choose a procedure to draw it on the map.
          </p>
        )
      )}
      <p className="text-[10.5px] leading-snug text-fg-3">
        {data.published
          ? 'Published US procedures (FAA CIFP, public domain), one representative transition each. Reference only — not for navigation.'
          : 'Simulated procedure-style routes over real navaids (published procedures are not freely licensed here). Not real procedures — not for navigation.'}
      </p>
    </section>
  );
}
