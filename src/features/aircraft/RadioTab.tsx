// Simulated radio transcript of the selected flight, shown like a chat log (ATC left,
// pilot right), with optional text-to-speech via the Web Speech API. Nothing here is a
// recording: the phraseology is generated from the simulated flight's events.
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Radio, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RadioLine } from '@/data/sim/radio';
import { simNow, simRadio } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';

const hmsZ = (t: number) => `${new Date(t).toISOString().slice(11, 19)}Z`;
/** Times inside the phraseology ("expect onward clearance at 1405"), UTC as on frequency. */
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16).replace(':', '');

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

function pickVoices(): {
  atc?: SpeechSynthesisVoice;
  pilot?: SpeechSynthesisVoice;
} {
  const all = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!all.length) return {};
  const pref = (re: RegExp) => all.filter((v) => re.test(v.lang));
  const ordered = [...pref(/GB|IE/i), ...pref(/US/i), ...pref(/AU|CA|NZ|IN|ZA/i), ...all].filter((v, i, a) => a.indexOf(v) === i);
  const atc = ordered[0];
  const pilot = ordered.find((v) => v !== atc && v.name !== atc?.name) ?? atc;
  return { ...(atc ? { atc } : {}), ...(pilot ? { pilot } : {}) };
}

const lineKey = (l: RadioLine, i: number) => `${l.t}-${i}`;

export function RadioTab({ id }: { id: string }) {
  useNow(1000);
  const now = simNow();
  const q = useQuery({
    queryKey: ['radio', id],
    queryFn: async () => (await simRadio(id, hhmm)) ?? null,
    refetchInterval: 5000,
    staleTime: 4000,
  });
  const lines = useMemo(() => q.data?.lines ?? [], [q.data]);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [listening, setListening] = useState(false);
  const speech = hasSpeech();

  const heard = lines.filter((l) => l.t <= now);
  const upcoming = lines.filter((l) => l.t > now);
  const shown = showUpcoming ? lines : heard;
  const newestIdx = heard.length - 1;

  // ---------------------------------------------------------------- auto-scroll
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    // Keep the newest heard line in view (upcoming lines sit below it).
    const target = el.querySelector<HTMLElement>('[data-newest="true"]');
    if (target && showUpcoming) el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight + target.offsetHeight + 12);
    else el.scrollTop = el.scrollHeight;
  }, [heard.length, showUpcoming, q.data]);

  // ---------------------------------------------------------------- speech
  const spokenUpTo = useRef(-Infinity);
  const speak = useCallback(async (batch: RadioLine[]) => {
    if (!hasSpeech() || !batch.length) return;
    const { speakable } = await import('@/data/sim/radio');
    const v = pickVoices();
    for (const l of batch) {
      const u = new SpeechSynthesisUtterance(speakable(l.text));
      u.lang = 'en-GB';
      const voice = l.who === 'atc' ? v.atc : v.pilot;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      // Two distinct voices where available; otherwise different pitch.
      u.pitch = l.who === 'atc' ? 0.85 : v.pilot && v.pilot !== v.atc ? 1 : 1.25;
      u.rate = l.who === 'atc' ? 1.08 : 1.15;
      // A short squelch burst at the start and end of each transmission, like a real radio.
      u.onstart = () => squelch(0.05);
      u.onend = () => squelch(0.035);
      window.speechSynthesis.speak(u);
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    const fresh = heard.filter((l) => l.t > spokenUpTo.current);
    if (!fresh.length) return;
    spokenUpTo.current = fresh[fresh.length - 1]!.t;
    // Catching up after a long gap: only read the latest couple of calls.
    void speak(fresh.slice(-2));
  }, [listening, heard, speak]);

  const startListening = () => {
    if (!speech) return;
    window.speechSynthesis.cancel();
    // Read the most recent call straight away, then each new one as it happens.
    spokenUpTo.current = heard.length > 1 ? heard[heard.length - 2]!.t : -Infinity;
    setListening(true);
  };
  const stopListening = () => {
    setListening(false);
    if (speech) window.speechSynthesis.cancel();
  };
  useEffect(() => {
    // Voices load asynchronously in Chrome.
    if (!speech) return;
    window.speechSynthesis.getVoices();
    return () => window.speechSynthesis.cancel();
  }, [speech]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">
          <Radio size={11} aria-hidden="true" /> Simulated radio
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            aria-pressed={showUpcoming}
            disabled={!upcoming.length && !showUpcoming}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium disabled:opacity-40',
              showUpcoming ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3 hover:text-fg-2',
            )}
          >
            {showUpcoming ? <Eye size={13} /> : <EyeOff size={13} />}
            Upcoming
            {upcoming.length ? <span className="tnum text-fg-3">{upcoming.length}</span> : null}
          </button>
          {speech &&
            (listening ? (
              <button
                type="button"
                onClick={stopListening}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-2.5 text-[11.5px] font-semibold text-[var(--accent)]"
              >
                <Square size={11} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={startListening}
                disabled={!heard.length}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 text-[11.5px] font-medium text-fg-2 hover:text-fg disabled:opacity-40"
              >
                <Volume2 size={13} /> Listen
              </button>
            ))}
        </div>
      </div>

      {q.isPending ? (
        <div className="glass-2 space-y-2 rounded-[16px] p-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('skeleton h-10', i % 2 ? 'ml-auto w-3/4' : 'w-4/5')} />
          ))}
        </div>
      ) : !shown.length ? (
        <div className="glass-2 rounded-[16px] px-4 py-6 text-center">
          <Radio size={20} className="mx-auto text-fg-3" aria-hidden="true" />
          <p className="mt-2 text-[12.5px] font-medium text-fg-2">No radio calls yet</p>
          <p className="mt-1 text-[11.5px] leading-snug text-fg-3">
            {upcoming.length ? `The first call is expected at ${hmsZ(upcoming[0]!.t)}. Turn on “Upcoming” to preview the exchange.` : 'This aircraft is parked; there is nothing on frequency for it.'}
          </p>
        </div>
      ) : (
        <div
          ref={box}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="Simulated radio transcript"
          className="glass-2 scroll-thin max-h-[min(58vh,480px)] space-y-2.5 overflow-y-auto overscroll-contain rounded-[16px] p-3"
        >
          {shown.map((l, i) => {
            const future = l.t > now;
            const newest = i === newestIdx && !future;
            const atc = l.who === 'atc';
            const firstFuture = future && (i === 0 || shown[i - 1]!.t <= now);
            return (
              <div key={lineKey(l, i)} data-newest={newest || undefined}>
                {firstFuture && (
                  <div className="my-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-[var(--line)]" />
                    Expected
                    <span className="h-px flex-1 bg-[var(--line)]" />
                  </div>
                )}
                <div className={cn('flex flex-col', atc ? 'items-start' : 'items-end', future && 'opacity-45')}>
                  <div className={cn('mb-1 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]', atc ? '' : 'flex-row-reverse')}>
                    <span className={cn('font-semibold', atc ? 'text-fg-2' : 'text-[var(--accent)]')}>{atc ? l.station : 'Pilot'}</span>
                    {l.freq && <span className="tnum rounded-[5px] bg-[var(--line)] px-1 py-px text-[10px] text-fg-3">{l.freq}</span>}
                    <span className="tnum text-fg-3">{hmsZ(l.t)}</span>
                    {newest && (
                      <span className="inline-flex items-center gap-1 text-[#7ee2a8]">
                        <span className="pulse-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
                        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em]">Live</span>
                      </span>
                    )}
                    {future && <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fg-3">expected</span>}
                  </div>
                  <p
                    className={cn(
                      'max-w-[88%] px-3 py-2 text-[12.5px] leading-snug',
                      atc
                        ? 'rounded-[14px] rounded-tl-[5px] bg-[var(--surface-2)] text-fg ring-1 ring-[var(--line)]'
                        : 'rounded-[14px] rounded-tr-[5px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-fg ring-1 ring-[color-mix(in_srgb,var(--accent)_28%,transparent)]',
                      newest && 'ring-[color-mix(in_srgb,#7ee2a8_45%,transparent)]',
                    )}
                  >
                    {l.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-fg-3">Phraseology is illustrative. Airport frequencies are real published ones; en-route frequencies are invented. Times in UTC.</p>
    </div>
  );
}

let squelchCtx: AudioContext | null = null;
/** Band-passed noise burst (radio squelch tail), synthesised; silently skipped without Web Audio. */
function squelch(seconds: number) {
  try {
    squelchCtx ??= new AudioContext();
    const ctx = squelchCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  } catch {
    /* audio is optional */
  }
}
