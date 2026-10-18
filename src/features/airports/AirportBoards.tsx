// Arrivals / departures boards for the simulated world (lazy chunk of the airport panel):
// CTOT slot times on regulated departures and codeshare-aware rows, like a real FIDS.
import { useQuery } from '@tanstack/react-query';
import { Timer } from 'lucide-react';
import { useState } from 'react';
import type { AirportDetail } from '@shared/types';
import { Toggle } from '@/components/ui/Controls';
import { Skeleton } from '@/components/ui/Feedback';
import { Tooltip } from '@/components/ui/Tooltip';
import { simBoard, simNow, type BoardRow } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { fmtHmIn, tzAbbrev, useTimeZone } from '@/lib/tz';
import { focusAircraft } from '@/map/controller';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { AirlineLogo, STATUS_TEXT } from '@/features/aircraft/FlightParts';

const COMPASS: Record<string, string> = { north: 'N', south: 'S', east: 'E', west: 'W', central: 'C', international: 'I', domestic: 'D', main: 'M' };

/** Board-style terminal code: 'Terminal 5' → 'T5', 'Terminal 2E' → 'T2E', 'North Terminal' → 'N', 'Terminal A' → 'A'. */
export function terminalCode(name: string): string {
  const n = name.trim();
  const num = /^(?:terminal|term\.?|t)\s*(\d+[a-z]?)$/i.exec(n);
  if (num) return `T${num[1]!.toUpperCase()}`;
  const letter = /^(?:terminal|concourse)\s+([a-z])$/i.exec(n);
  if (letter) return letter[1]!.toUpperCase();
  const side = /^(\w+)\s+terminal$/i.exec(n);
  if (side && COMPASS[side[1]!.toLowerCase()]) return COMPASS[side[1]!.toLowerCase()]!;
  if (n.length <= 4) return n.toUpperCase();
  const initials = n
    .split(/[\s-]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .map((w) => (/^\d/.test(w) ? w : w[0]!.toUpperCase()))
    .join('');
  return initials.slice(0, 4) || n.slice(0, 3).toUpperCase();
}

/** "EK1234" → "EK 1234" (two-character IATA airline designator, then the number). */
export const spacedFlight = (code: string) => (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(code) ? `${code.slice(0, 2)} ${code.slice(2)}` : code);

/** One line of the board: the operating flight, or one of its codeshare numbers (`code`). */
export interface BoardEntry {
  row: BoardRow;
  code?: string;
}

/**
 * FIDS-style expansion: by default one line per operating flight; with codeshares shown,
 * every marketing flight number gets its own line straight after the operating one.
 */
export function boardEntries(rows: BoardRow[], showCodeshares: boolean): BoardEntry[] {
  if (!showCodeshares) return rows.map((row) => ({ row }));
  return rows.flatMap((row) => [{ row }, ...row.codeshares.map((code) => ({ row, code }))]);
}

type Partner = { icao: string; name: string };

/** IATA → airline (sim registry, already loaded by the simulation) for codeshare logos and names. */
function usePartners() {
  return useQuery({
    queryKey: ['codeshare-partners'],
    queryFn: async () => {
      const { ALL_AIRLINES } = await import('@/data/sim/airlines');
      const m = new Map<string, Partner>();
      for (const a of ALL_AIRLINES) if (a.iata && !m.has(a.iata)) m.set(a.iata, { icao: a.icao, name: a.name });
      return m;
    },
    staleTime: Infinity,
  }).data;
}

const CTOT_HELP = 'Calculated take-off time: the departure slot given by air traffic flow management at a slot-coordinated or congested airport. The flight must take off within −5 / +10 minutes of it. Simulated.';

function Ctot({ t, tz }: { t: number; tz: string | null }) {
  const hm = fmtHmIn(t, tz);
  return (
    <Tooltip content={<span className="block max-w-[260px] whitespace-normal leading-snug">{CTOT_HELP}</span>} side="top">
      <span className="tnum inline-flex h-[17px] items-center gap-0.5 rounded-[5px] border border-[rgba(167,139,250,0.35)] bg-[rgba(167,139,250,0.12)] px-1 text-[9.5px] font-bold tracking-wide text-[#c4b5fd]">
        <Timer size={9} aria-hidden="true" />
        CTOT {hm}
        <span className="sr-only">. {CTOT_HELP}</span>
      </span>
    </Tooltip>
  );
}

function BoardRows({ entries, dep, tz }: { entries: BoardEntry[]; dep: boolean; tz: string | null }) {
  const select = useUI((s) => s.select);
  const partners = usePartners();
  if (!entries.length)
    return (
      <div className="glass-2 rounded-[16px] px-4 py-6 text-center">
        <p className="text-[12.5px] font-medium text-fg-2">No {dep ? 'departures' : 'arrivals'} in this window</p>
        <p className="mt-1 text-[11.5px] text-fg-3">Nothing is scheduled between 45 minutes ago and three hours from now.</p>
      </div>
    );
  return (
    <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
      {entries.map(({ row: r, code }) => {
        const live = !!traffic.get(r.id);
        const late = r.delayMin > 5;
        const cs = !!code;
        const partner = code ? partners?.get(code.slice(0, 2)) : undefined;
        const operating = r.flightIata ?? r.flight;
        return (
          <li key={`${r.id}-${r.scheduled}-${code ?? ''}`} className={cn(cs && 'bg-[color-mix(in_srgb,var(--line)_45%,transparent)]')}>
            <button
              type="button"
              disabled={!live}
              aria-label={code ? `${spacedFlight(code)}, codeshare operated by ${spacedFlight(operating)}` : undefined}
              onClick={() => {
                select(r.id);
                focusAircraft(r.id, 10);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left enabled:hover:bg-[var(--line)] disabled:cursor-default"
            >
              <div className="tnum w-[50px] shrink-0">
                <div className="text-[13px] font-semibold text-fg">{fmtHmIn(r.scheduled, tz)}</div>
                <div className={cn('text-[10.5px]', r.status === 'Canceled' ? 'text-[#ff8a9a] line-through' : late ? 'text-[#ffb547]' : 'text-fg-3')}>{fmtHmIn(r.actual ?? r.estimated, tz)}</div>
              </div>
              {code ? (
                <AirlineLogo icao={partner?.icao} code={code.slice(0, 2)} size={26} name={partner?.name} wide />
              ) : (
                <AirlineLogo icao={r.airlineIcao} code={r.airlineIata ?? r.flight.slice(0, 2)} size={26} name={r.airline} wide />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-fg">
                  {r.other.iata ?? r.other.ident} <span className="font-normal text-fg-2">{r.other.city ?? r.other.name}</span>
                </div>
                <div className="tnum flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[10.5px] text-fg-3">
                  {code ? (
                    <>
                      <span className="font-semibold text-fg-2">{spacedFlight(code)}</span>
                      <span className="rounded-[4px] bg-[var(--line)] px-1 text-[9px] font-bold uppercase tracking-[0.08em] text-fg-2">Codeshare</span>
                    </>
                  ) : (
                    <span className="truncate">
                      {spacedFlight(operating)} · {r.type}
                      {r.gate || r.terminal ? (
                        <span className="xs:hidden">
                          {r.terminal ? ` · ${terminalCode(r.terminal)}` : ''}
                          {r.gate ? ` · Stand ${r.gate}` : ''}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {!cs && dep && r.ctot !== undefined && r.status !== 'Canceled' && <Ctot t={r.ctot} tz={tz} />}
                </div>
                {cs ? (
                  <div className="tnum truncate text-[10.5px] text-fg-3" title={r.airline ? `Operated by ${r.airline} as ${spacedFlight(operating)}` : undefined}>
                    <abbr title="Operated by" className="no-underline">
                      Op. by
                    </abbr>{' '}
                    <span className="font-semibold text-fg-2">{spacedFlight(operating)}</span>
                  </div>
                ) : (
                  r.codeshares.length > 0 && <div className="tnum truncate text-[10.5px] text-fg-3">also {r.codeshares.map(spacedFlight).join(' · ')}</div>
                )}
                {r.divertedTo && (
                  <div className="text-[10.5px] text-[#ff8a9a]">
                    Diverted to {r.divertedTo.iata ?? r.divertedTo.ident} ({r.divertedTo.city ?? r.divertedTo.name})
                  </div>
                )}
              </div>
              {(r.terminal || r.gate) && (
                <div
                  className="tnum hidden w-[30px] shrink-0 text-center leading-tight xs:block"
                  title={[r.terminal, r.gate && `Stand ${r.gate}`].filter(Boolean).join(' · ')}
                  aria-label={[r.terminal, r.gate && `stand ${r.gate}`].filter(Boolean).join(', ')}
                >
                  <div className="truncate text-[12px] font-semibold text-fg">{r.terminal ? terminalCode(r.terminal) : '—'}</div>
                  {r.gate && <div className="truncate text-[10px] text-fg-3">{r.gate}</div>}
                </div>
              )}
              <span className={cn('w-[60px] shrink-0 break-words text-right text-[11px] font-semibold leading-tight', STATUS_TEXT[r.status])}>
                {r.status}
                {late && r.status !== 'Arrived' && r.status !== 'Landed' && r.status !== 'Canceled' && <span className="block text-[10px] font-normal text-[#ffb547]">+{r.delayMin} min</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function BoardTab({ a, kind }: { a: AirportDetail; kind: 'arrivals' | 'departures' }) {
  useNow(5000);
  const tz = useTimeZone(a.lat, a.lon);
  const board = simBoard(a.ident, { pastMin: 45, aheadMin: 180 });
  const [showAll, setShowAll] = useState(false);
  const [codeshares, setCodeshares] = useState(false);
  if (!board)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading the board">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 rounded-[12px]" />
        ))}
      </div>
    );
  const rows = board[kind];
  const dep = kind === 'departures';
  const entries = boardEntries(rows, codeshares);
  const limit = 40;
  const withCs = rows.filter((r) => r.codeshares.length).length;
  const slotted = dep ? rows.filter((r) => r.ctot !== undefined).length : 0;
  return (
    <div className="space-y-3">
      <div className="glass-2 rounded-[14px] px-3.5 py-2.5">
        <Toggle
          checked={codeshares}
          onChange={setCodeshares}
          label="Show codeshares"
          description={withCs ? `List each marketing flight number as its own line (${withCs} flight${withCs === 1 ? '' : 's'} carry codeshares).` : 'No flight in this window carries a codeshare.'}
        />
      </div>
      <BoardRows entries={showAll ? entries : entries.slice(0, limit)} dep={dep} tz={tz} />
      {entries.length > limit && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full rounded-[12px] py-2 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--line)]">
          Show all {entries.length} {codeshares ? 'lines' : kind}
        </button>
      )}
      <p className="text-[11px] leading-snug text-fg-3">
        Simulated schedule: real airlines and airports, invented flights, codeshares and times. Local time ({tzAbbrev(simNow(), tz)}), then the estimated or actual time. Terminal (e.g. T5)
        above the stand; stands and terminals from OpenStreetMap where mapped.
        {dep && slotted > 0 ? ' CTOT is the simulated take-off slot of a regulated departure.' : ''}
      </p>
    </div>
  );
}
