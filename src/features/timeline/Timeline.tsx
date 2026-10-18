import { Download, Pause, Play, Radio, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { TimelineIcon } from '@/components/icons';
import { SegmentedControl } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/Feedback';
import { Row, Rows } from '@/components/ui/Data';
import { GlassButton, IconButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { fmtAge, fmtDateTimeUTC, fmtTimeUTC } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { useIsMobile } from '@/lib/useMedia';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { create } from 'zustand';

const useReplaySpeed = create<{ speed: number; setSpeed: (s: number) => void }>()((set) => ({ speed: 10, setSpeed: (speed) => set({ speed }) }));

function snapshotTime(index: number) {
  const s = traffic.snapshots;
  if (!s.length) return 0;
  const i0 = Math.max(0, Math.min(s.length - 1, Math.floor(index)));
  const i1 = Math.min(s.length - 1, i0 + 1);
  return s[i0]!.t + (s[i1]!.t - s[i0]!.t) * (index - i0);
}

function exportSession() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 'arnav-session-v1',
          note: 'Simulated aircraft positions recorded in this browser (aircraft in view only). Rows: [id, lat, lon, altitudeFt|null, trackDeg|null, groundSpeedKt|null].',
          exportedAt: new Date().toISOString(),
          snapshots: traffic.snapshots,
        },
        null,
        0,
      ),
    ],
    { type: 'application/json' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arnav-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function TimelinePanel() {
  const open = useUI((s) => s.panel === 'timeline');
  const openPanel = useUI((s) => s.openPanel);
  const replay = useUI((s) => s.replay);
  const setReplay = useUI((s) => s.setReplay);
  const recording = useSettings((s) => s.recordSession);
  const setSetting = useSettings((s) => s.set);
  useTrafficVersion();
  const snaps = traffic.snapshots;
  const span = snaps.length > 1 ? snaps[snaps.length - 1]!.t - snaps[0]!.t : 0;

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Timeline replay" icon={<TimelineIcon size={18} />} ariaLabel="Timeline replay" subtitle="Replays only what this browser actually received">
      <div className="space-y-5 pt-1">
        {!recording ? (
          <EmptyState
            icon={<TimelineIcon />}
            title="Session recording is off"
            body="Turn it on to keep recent snapshots in memory for replay."
            action={
              <GlassButton size="sm" onClick={() => setSetting('recordSession', true)}>
                Turn on recording
              </GlassButton>
            }
          />
        ) : snaps.length < 2 ? (
          <EmptyState icon={<TimelineIcon />} title="Not enough recorded yet" body={`Replay needs at least two snapshots. ${snaps.length} recorded so far — one arrives every refresh.`} />
        ) : (
          <>
            <Rows>
              <Row label="Snapshots recorded" value={String(snaps.length)} mono />
              <Row label="Time span" value={fmtAge(span)} mono />
              <Row label="From" value={fmtDateTimeUTC(snaps[0]!.t)} mono />
              <Row label="To" value={fmtDateTimeUTC(snaps[snaps.length - 1]!.t)} mono />
            </Rows>
            <div className="flex flex-wrap gap-2">
              {replay.active ? (
                <GlassButton size="sm" variant="accent" onClick={() => setReplay({ active: false, playing: false })}>
                  <Radio size={14} /> Return to live
                </GlassButton>
              ) : (
                <GlassButton size="sm" variant="accent" onClick={() => setReplay({ active: true, index: 0, playing: true })}>
                  <Play size={14} /> Start replay
                </GlassButton>
              )}
              <GlassButton size="sm" onClick={exportSession}>
                <Download size={14} /> Export session JSON
              </GlassButton>
              <GlassButton
                size="sm"
                variant="danger"
                onClick={() => {
                  setReplay({ active: false, playing: false, index: 0 });
                  traffic.clearSession();
                }}
              >
                <Trash2 size={14} /> Clear
              </GlassButton>
            </div>
          </>
        )}
        <Section title="How replay works">
          <p className="text-[12px] leading-relaxed text-fg-3">
            Each refresh stores the positions received for the live area, in memory only (about an hour at most). Replay moves aircraft between two
            recorded snapshots of the same aircraft; nothing outside the recorded data is shown. Aircraft that entered or left the area between snapshots
            simply appear or disappear. Polling continues during replay.
          </p>
        </Section>
      </div>
    </Panel>
  );
}

/** Floating transport bar shown while replay is active. */
export function ReplayBar() {
  const replay = useUI((s) => s.replay);
  const setReplay = useUI((s) => s.setReplay);
  const speed = useReplaySpeed((s) => s.speed);
  const setSpeed = useReplaySpeed((s) => s.setSpeed);
  const mobile = useIsMobile();
  useTrafficVersion();
  const last = useRef(0);
  const n = traffic.snapshots.length;

  useEffect(() => {
    if (!replay.active || !replay.playing) return;
    let raf = 0;
    last.current = performance.now();
    const avgInterval = n > 1 ? (traffic.snapshots[n - 1]!.t - traffic.snapshots[0]!.t) / (n - 1) / 1000 : 15;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (t - last.current) / 1000;
      last.current = t;
      const r = useUI.getState().replay;
      let idx = r.index + (dt * speed) / Math.max(1, avgInterval);
      if (idx >= n - 1) {
        idx = n - 1;
        setReplay({ index: idx, playing: false });
        return;
      }
      setReplay({ index: idx });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay.active, replay.playing, speed, n, setReplay]);

  return (
    <AnimatePresence>
      {replay.active && n > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className={`glass pointer-events-auto absolute left-1/2 z-30 flex w-[min(640px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-[20px] px-3 py-2.5 ${mobile ? 'bottom-[84px]' : 'bottom-[68px]'}`}
          role="region"
          aria-label="Replay controls"
        >
          <span className="rounded-full bg-[rgba(167,139,250,0.16)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#c4b5fd]">Replay</span>
          <IconButton label={replay.playing ? 'Pause' : 'Play'} size={34} variant="glass" onClick={() => setReplay({ playing: !replay.playing, index: replay.index >= n - 1 ? 0 : replay.index })}>
            {replay.playing ? <Pause size={16} /> : <Play size={16} />}
          </IconButton>
          <input
            type="range"
            min={0}
            max={n - 1}
            step={0.01}
            value={replay.index}
            aria-label="Replay position"
            onChange={(e) => setReplay({ index: Number(e.target.value), playing: false })}
            className="arnav-range min-w-0 flex-1"
            style={{ ['--pct' as string]: `${(replay.index / (n - 1)) * 100}%` }}
          />
          <span className="tnum shrink-0 text-[12px] font-semibold text-fg">{fmtTimeUTC(snapshotTime(replay.index))}</span>
          {!mobile && (
            <SegmentedControl
              size="sm"
              label="Replay speed"
              value={String(speed)}
              onChange={(v) => setSpeed(Number(v))}
              options={[
                { value: '5', label: '5×' },
                { value: '10', label: '10×' },
                { value: '30', label: '30×' },
              ]}
            />
          )}
          <GlassButton size="sm" variant="ghost" onClick={() => setReplay({ active: false, playing: false })}>
            Live
          </GlassButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
