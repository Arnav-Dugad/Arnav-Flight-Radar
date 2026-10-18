import { motion } from 'motion/react';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { useDemo } from '@/data/demo';
import { useFeed } from '@/data/feed';
import { cn } from '@/lib/cn';
import { fmtAge } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

const TONE = {
  live: { dot: 'bg-[#3ddc97] text-[#3ddc97]', label: 'Live' },
  degraded: { dot: 'bg-[#ffb547] text-[#ffb547]', label: 'Degraded' },
  error: { dot: 'bg-[#ff5d73] text-[#ff5d73]', label: 'Offline' },
  connecting: { dot: 'bg-[#7d8ea5] text-[#7d8ea5]', label: 'Connecting' },
  paused: { dot: 'bg-[#7d8ea5] text-[#7d8ea5]', label: 'Paused' },
};

export function LiveStatus({ compact = false }: { compact?: boolean }) {
  useTrafficVersion();
  const now = useNow(1000);
  const status = useFeed((s) => s.status);
  const message = useFeed((s) => s.message);
  const replay = useUI((s) => s.replay.active);
  const demo = useDemo((s) => s.active);
  const openPanel = useUI((s) => s.openPanel);
  const meta = traffic.meta;
  const count = traffic.current().length;
  const age = meta ? traffic.serverNow(now) - meta.fetchedAt : undefined;
  const tone = demo
    ? { dot: 'bg-[#a78bfa] text-[#a78bfa]', label: 'Demo' }
    : replay
      ? { dot: 'bg-[#a78bfa] text-[#a78bfa]', label: 'Replay' }
      : TONE[status];

  return (
    <motion.button
      type="button"
      onClick={() => openPanel('data')}
      whileTap={{ scale: 0.97 }}
      title={demo ? 'Demo mode: simulated aircraft, not real flights' : (message ?? 'Live data status — open data & coverage')}
      aria-label={`${tone.label}. ${count} ${demo ? 'simulated aircraft' : 'aircraft in the queried area'}. ${message ?? ''}`}
      className={cn(
        'glass-2 flex h-9 items-center gap-2 rounded-full pl-3 pr-3.5 text-[12px] font-medium text-fg-2 transition-colors hover:text-fg',
        compact && 'h-8 pl-2.5 pr-3',
      )}
    >
      <span className={cn('size-2 rounded-full', tone.dot, (status === 'live' || replay || demo) && 'pulse-dot')} />
      <span className="font-semibold uppercase tracking-[0.12em] text-fg">{tone.label}</span>
      {!compact && <span className="h-3.5 w-px bg-[var(--line-strong)]" />}
      <span className="tnum text-fg">
        <AnimatedNumber value={count} />
      </span>
      {!compact && <span>{demo ? 'simulated' : 'aircraft'}</span>}
      {age !== undefined && !compact && !demo && <span className="tnum text-fg-3">· {fmtAge(age)}</span>}
    </motion.button>
  );
}
