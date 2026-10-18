import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TrackState } from '@shared/types';
import { cn } from '@/lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-[var(--line-strong)] bg-[var(--line)] px-1 font-sans text-[10.5px] font-semibold text-fg-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden="true" />;
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-2xl glass-2 text-fg-3">{icon ?? <Inbox size={20} />}</div>
      <div className="space-y-1">
        <p className="text-[14px] font-semibold text-fg">{title}</p>
        {body && <p className="text-[12.5px] leading-relaxed text-fg-3">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', body, action }: { title?: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-[rgba(255,93,115,0.3)] bg-[rgba(255,93,115,0.08)] p-3.5">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#ff8a9a]" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[13px] font-semibold text-fg">{title}</p>
        {body && <p className="text-[12px] leading-relaxed text-fg-2">{body}</p>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

const BADGE_TONE = {
  neutral: 'bg-[var(--line)] text-fg-2 border-[var(--line)]',
  accent: 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
  ok: 'bg-[rgba(61,220,151,0.12)] text-[#57e3a6] border-[rgba(61,220,151,0.3)]',
  warn: 'bg-[rgba(255,181,71,0.12)] text-[#ffc56e] border-[rgba(255,181,71,0.32)]',
  danger: 'bg-[rgba(255,93,115,0.12)] text-[#ff8a9a] border-[rgba(255,93,115,0.32)]',
  violet: 'bg-[rgba(167,139,250,0.12)] text-[#c4b5fd] border-[rgba(167,139,250,0.3)]',
} as const;

export function Badge({ tone = 'neutral', children, className, title }: { tone?: keyof typeof BADGE_TONE; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold tracking-wide',
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATE_INFO: Record<TrackState | 'unavailable' | 'sim' | 'replay', { tone: keyof typeof BADGE_TONE; label: string; desc: string }> = {
  live: { tone: 'ok', label: 'Live', desc: 'Recently reported position' },
  stale: { tone: 'warn', label: 'Stale', desc: 'Last report is older than the freshness threshold' },
  lost: { tone: 'danger', label: 'Lost', desc: 'No longer present in recent provider results' },
  unavailable: { tone: 'neutral', label: 'Unavailable', desc: 'No usable data right now' },
  sim: { tone: 'accent', label: 'Simulated', desc: 'Every aircraft on this map is simulated' },
  replay: { tone: 'violet', label: 'Replay', desc: 'Recorded positions from this session' },
};

export function FreshnessBadge({ state, age }: { state: keyof typeof STATE_INFO; age?: string }) {
  const s = STATE_INFO[state];
  return (
    <Badge tone={s.tone} title={s.desc}>
      <span className={cn('size-1.5 rounded-full bg-current', state === 'live' && 'pulse-dot')} />
      {s.label}
      {age && <span className="font-medium opacity-80">· {age}</span>}
    </Badge>
  );
}
