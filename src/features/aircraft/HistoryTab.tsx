// The airframe's previous flights (newest first), like a flight tracker's history list.
// Times are local to each airport; everything is simulated.
import { ArrowRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/Feedback';
import { simHistory, type HistoryRow } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtHmIn, useTimeZone } from '@/lib/tz';
import { STATUS_TEXT } from './FlightParts';

const code = (a: { iata?: string; ident: string }) => a.iata ?? a.ident;

const dayFmts = new Map<string, Intl.DateTimeFormat>();
function dayParts(ms: number, tz: string | null): { wd: string; day: string } {
  const key = tz ?? 'UTC';
  let f = dayFmts.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: key,
      });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
    }
    dayFmts.set(key, f);
  }
  const p = f.formatToParts(ms);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { wd: get('weekday'), day: `${get('day')} ${get('month')}` };
}

function delayText(r: HistoryRow): { text: string; tone: string } | undefined {
  if (r.status === 'Canceled') return undefined;
  const m = r.delayMin;
  if (m > 15) return { text: `+${m} min`, tone: 'text-[#ffb547]' };
  if (m > 0) return { text: `+${m} min`, tone: 'text-fg-3' };
  if (m < 0) return { text: `${-m} min early`, tone: 'text-[#7ee2a8]' };
  return { text: 'On time', tone: 'text-[#7ee2a8]' };
}

function HistoryItem({ r }: { r: HistoryRow }) {
  const fromTz = useTimeZone(r.from.lat, r.from.lon);
  const toTz = useTimeZone(r.to.lat, r.to.lon);
  const d = dayParts(r.std, fromTz);
  const delay = delayText(r);
  const canceled = r.status === 'Canceled';
  return (
    <li className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[var(--line)] py-2.5 last:border-b-0">
      <div className="text-center leading-tight">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fg-3">{d.wd}</div>
        <div className="tnum text-[11.5px] font-medium text-fg-2">{d.day}</div>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <span className="tnum truncate font-semibold text-fg">{r.flightIata ?? r.flight}</span>
          <span className="tnum flex shrink-0 items-center gap-1 text-fg-2" title={`${r.from.name} → ${r.to.name}`}>
            {code(r.from)} <ArrowRight size={11} className="text-fg-3" aria-label="to" /> {code(r.to)}
          </span>
        </div>
        <div className="tnum mt-0.5 truncate text-[11px] text-fg-3">
          {canceled ? (
            <>Scheduled {fmtHmIn(r.std, fromTz)}</>
          ) : (
            <>
              <span title="Scheduled departure / actual off-block (local)">
                {fmtHmIn(r.std, fromTz)} <span className="text-fg-2">{fmtHmIn(r.atd, fromTz)}</span>
              </span>
              <span className="mx-1 text-fg-3">→</span>
              <span title="Scheduled arrival / actual on-block (local)">
                {fmtHmIn(r.sta, toTz)} <span className="text-fg-2">{fmtHmIn(r.ata, toTz)}</span>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className={cn('text-[12px] font-semibold', STATUS_TEXT[r.status])}>{r.status}</div>
        {delay && <div className={cn('tnum mt-0.5 text-[10.5px]', delay.tone)}>{delay.text}</div>}
      </div>
    </li>
  );
}

export function HistoryTab({ id }: { id: string }) {
  const h = simHistory(id);
  if (!h || !h.rows.length)
    return (
      <div className="space-y-3">
        <EmptyState title="No earlier flights" body="This simulated airframe has not flown yet today." />
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">
          Registration <span className="tnum text-fg-2">{h.reg}</span> · last {h.rows.length} flight{h.rows.length === 1 ? '' : 's'}
        </h3>
        <span className="tnum text-[10.5px] text-fg-3">{h.type}</span>
      </div>
      <div className="glass-2 rounded-[16px] px-3.5">
        <div className="grid grid-cols-[38px_minmax(0,1fr)_auto] gap-x-3 border-b border-[var(--line)] pb-1.5 pt-2 text-[10px] uppercase tracking-[0.12em] text-fg-3">
          <span>Date</span>
          <span>Flight · sched / actual, local</span>
          <span className="text-right">Status</span>
        </div>
        <ol>
          {h.rows.map((r) => (
            <HistoryItem key={`${r.flight}-${r.std}`} r={r} />
          ))}
        </ol>
      </div>
      <p className="text-[11px] leading-relaxed text-fg-3">Earlier flights before you opened the site are reconstructed for this simulated airframe.</p>
    </div>
  );
}
