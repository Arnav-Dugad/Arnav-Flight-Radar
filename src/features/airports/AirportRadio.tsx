// Airport scanner: every simulated flight's calls on one of the airport's frequencies
// (delivery, ground, tower, departure or approach), interleaved like a real scanner, with
// hand-offs between them and an optional "Listen" mode that reads new calls aloud through
// the Web Speech API. Nothing here is a recording: the phraseology is generated from the
// simulated flights.
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowRightLeft, Radio, Square, Volume2, VolumeX } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AirportDetail, Frequency } from '@shared/types';
import { focusAircraft } from '@/map/controller';
import { simAirportRadio, type ScannerKind, type ScannerLine } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtMhz } from '@/lib/format';
import { useUI } from '@/state/ui';

export const SCANNER_KINDS: { id: ScannerKind; label: string }[] = [
  { id: 'del', label: 'Delivery' },
  { id: 'gnd', label: 'Ground' },
  { id: 'twr', label: 'Tower' },
  { id: 'app', label: 'Approach' },
];

/** Scanner channels: Departure and Approach are separate facilities (both answered by the worker's 'app' query). */
export type RadioChannel = ScannerKind | 'dep';
export const RADIO_CHANNELS: { id: RadioChannel; label: string; short: string }[] = [
  { id: 'del', label: 'Delivery', short: 'Del' },
  { id: 'gnd', label: 'Ground', short: 'Gnd' },
  { id: 'twr', label: 'Tower', short: 'Twr' },
  { id: 'dep', label: 'Departure', short: 'Dep' },
  { id: 'app', label: 'Approach', short: 'App' },
];
const FACILITY: Record<RadioChannel, string> = { del: 'Delivery|Clearance', gnd: 'Ground', twr: 'Tower', dep: 'Departure', app: 'Approach' };
const queryKind = (c: RadioChannel): ScannerKind => (c === 'dep' ? 'app' : c);

/** Channel a station belongs to ("Heathrow Tower" → 'twr', "London Departure" → 'dep'). */
export function channelOfStation(station: string): RadioChannel | undefined {
  return RADIO_CHANNELS.find((c) => new RegExp(` (${FACILITY[c.id]})$`).test(station))?.id;
}

/** The published frequency of a channel: Departure falls back to Approach, as the simulated radio does. */
export function channelFreq(list: Frequency[], ch: RadioChannel): number | undefined {
  const find = (re: RegExp) => list.find((f) => re.test(f.type.trim()))?.mhz;
  if (ch === 'dep') return find(/^DEP/i) ?? find(/^(APP|ARR|TMA|RADAR|DIR)/i);
  if (ch === 'app') return find(/^(APP|ARR|TMA|RADAR|DIR)/i) ?? find(/^DEP/i);
  return publishedFreq(list, ch);
}

/** "contact London Departure 120.4" → the facility a call hands the flight to, if it is one of this airport's channels. */
export function handoffOf(text: string): { station: string; channel: RadioChannel } | undefined {
  const m = /\bcontact ([A-Z][\w' .-]*? (?:Delivery|Clearance|Ground|Tower|Departure|Approach))\b/.exec(text);
  if (!m) return undefined;
  const channel = channelOfStation(m[1]!);
  return channel ? { station: m[1]!, channel } : undefined;
}

const FREQ_TYPE: Record<ScannerKind, RegExp> = {
  del: /^(DEL|CLD|CLNC|CLR|CD)/i,
  gnd: /^(GND|GRD|GROUND)/i,
  twr: /^(TWR|TOWER)/i,
  app: /^(APP|ARR|DEP|TMA|RADAR|DIR)/i,
};

/** The published OurAirports frequency for a scanner channel, if there is one. */
export function publishedFreq(list: Frequency[], kind: ScannerKind): number | undefined {
  return list.find((f) => FREQ_TYPE[kind].test(f.type.trim()))?.mhz;
}

const hmsZ = (t: number) => `${new Date(t).toISOString().slice(11, 19)}Z`;
const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const lineKey = (l: ScannerLine) => `${l.t}-${l.id}-${l.who}-${l.text.length}`;

/** Small stable per-flight pitch so different pilots sound different. */
function pilotPitch(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 0.98 + ((Math.abs(h) % 7) / 6) * 0.34;
}

function pickVoices(): { atc?: SpeechSynthesisVoice; pilot?: SpeechSynthesisVoice } {
  const all = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!all.length) return {};
  const pref = (re: RegExp) => all.filter((v) => re.test(v.lang));
  const ordered = [...pref(/GB|IE/i), ...pref(/US/i), ...pref(/AU|CA|NZ|IN|ZA/i), ...all].filter((v, i, a) => a.indexOf(v) === i);
  const atc = ordered[0];
  const pilot = ordered.find((v) => v !== atc && v.name !== atc?.name) ?? atc;
  return { ...(atc ? { atc } : {}), ...(pilot ? { pilot } : {}) };
}

export function AirportRadio({ a }: { a: AirportDetail }) {
  const [kind, setKind] = useState<RadioChannel>('twr');
  const reduce = useReducedMotion();
  const q = useQuery({
    queryKey: ['airport-radio', a.ident, queryKind(kind)],
    queryFn: async () => (await simAirportRadio(a.ident, queryKind(kind), 20)) ?? null,
    refetchInterval: 4000,
    staleTime: 3000,
    select: (d) => {
      if (!d || (kind !== 'dep' && kind !== 'app')) return d;
      // The worker answers Approach and Departure together: split them into their own channels.
      const station = kind === 'dep' ? d.station.replace(/ Approach$/, ' Departure') : d.station;
      return { ...d, station, lines: d.lines.filter((l) => l.station === station) };
    },
  });
  const lines = useMemo(() => q.data?.lines ?? [], [q.data]);
  const freq = kind === 'dep' ? (channelFreq(a.frequencies, 'dep') ?? q.data?.freq) : (q.data?.freq ?? channelFreq(a.frequencies, kind));
  const speech = hasSpeech();
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);

  // ---------------------------------------------------------------- auto-scroll
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const seenCount = useRef(0);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (stick.current) setUnseen(0);
  };
  const lastT = lines.at(-1)?.t ?? 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      seenCount.current = lastT;
    } else {
      setUnseen(lines.filter((l) => l.t > seenCount.current).length);
    }
  }, [lastT, lines]);
  const jumpToLatest = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    seenCount.current = lastT;
    setUnseen(0);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  };
  useEffect(() => {
    // A new frequency starts at the bottom again.
    stick.current = true;
    setUnseen(0);
  }, [kind]);

  // ---------------------------------------------------------------- scanner speech
  const spokenUpTo = useRef(-Infinity);
  const spokenStation = useRef<string | null>(null);
  const speak = useCallback(async (batch: ScannerLine[]) => {
    if (!hasSpeech() || !batch.length) return;
    const { speakable } = await import('@/data/sim/radio');
    const v = pickVoices();
    const synth = window.speechSynthesis;
    // Falling behind (busy frequency at a fast clock): drop the backlog, keep up with "now".
    if (synth.pending) synth.cancel();
    for (const l of batch) {
      const u = new SpeechSynthesisUtterance(speakable(l.text));
      u.lang = 'en-GB';
      const atc = l.who === 'atc';
      const voice = atc ? v.atc : v.pilot;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.pitch = atc ? 0.85 : pilotPitch(l.id) + (v.pilot && v.pilot !== v.atc ? 0 : 0.15);
      u.rate = atc ? 1.1 : 1.18;
      synth.speak(u);
    }
  }, []);

  useEffect(() => {
    if (!listening || !q.data) return;
    if (spokenStation.current !== q.data.station) {
      // Just tuned in: read the latest call only, not the whole backlog.
      spokenStation.current = q.data.station;
      spokenUpTo.current = lines.length > 1 ? lines[lines.length - 2]!.t : -Infinity;
    }
    const fresh = lines.filter((l) => l.t > spokenUpTo.current);
    if (!fresh.length) return;
    spokenUpTo.current = fresh[fresh.length - 1]!.t;
    if (!muted) void speak(fresh.slice(-3));
  }, [listening, muted, lines, q.data, speak]);

  const startListening = () => {
    if (!speech) return;
    window.speechSynthesis.cancel();
    spokenStation.current = null;
    setListening(true);
  };
  const stopListening = () => {
    setListening(false);
    if (speech) window.speechSynthesis.cancel();
  };
  const toggleMute = () => {
    setMuted((m) => {
      if (!m && speech) window.speechSynthesis.cancel();
      return !m;
    });
  };
  useEffect(() => {
    if (!speech) return;
    window.speechSynthesis.getVoices(); // voices load asynchronously in Chrome
    return () => window.speechSynthesis.cancel(); // tab or panel closed
  }, [speech]);
  useEffect(() => {
    if (speech) window.speechSynthesis.cancel();
  }, [kind, speech]);

  const selectFlight = (id: string) => {
    useUI.getState().select(id);
    focusAircraft(id, 10);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">
          <Radio size={11} aria-hidden="true" /> Simulated radio
        </span>
        {speech && (
          <div className="ml-auto flex items-center gap-1.5">
            {listening && (
              <button
                type="button"
                onClick={toggleMute}
                aria-pressed={muted}
                aria-label={muted ? 'Unmute scanner' : 'Mute scanner'}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium',
                  muted ? 'border-[color-mix(in_srgb,#ffb547_45%,transparent)] text-[#ffb547]' : 'border-[var(--line)] text-fg-2 hover:text-fg',
                )}
              >
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                {muted ? 'Muted' : 'Mute'}
              </button>
            )}
            {listening ? (
              <button
                type="button"
                onClick={stopListening}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-2.5 text-[11.5px] font-semibold text-[var(--accent)]"
              >
                <span className="pulse-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
                <Square size={10} fill="currentColor" aria-hidden="true" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={startListening}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 text-[11.5px] font-medium text-fg-2 hover:text-fg"
              >
                <Volume2 size={13} /> Listen
              </button>
            )}
          </div>
        )}
      </div>

      {/* frequency selector */}
      <div role="radiogroup" aria-label="Frequency" className="glass-2 grid grid-cols-5 gap-0.5 rounded-[14px] p-0.5">
        {RADIO_CHANNELS.map((k) => {
          const on = k.id === kind;
          const f = on ? freq : channelFreq(a.frequencies, k.id);
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${k.label}${f ? ` ${f.toFixed(3).replace(/0$/, '')}` : ''}`}
              onClick={() => setKind(k.id)}
              className={cn(
                'relative min-w-0 rounded-[12px] px-1 py-1.5 text-center transition-colors',
                on ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
              )}
            >
              {on && (
                <motion.span
                  layoutId={`scanner-${a.ident}`}
                  className="absolute inset-0 rounded-[12px] bg-[var(--surface-2)] shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-[var(--line)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative block truncate text-[12px] font-semibold">
                <span className="hidden min-[440px]:inline">{k.label}</span>
                <span className="min-[440px]:hidden">{k.short}</span>
              </span>
              <span className={cn('tnum relative block truncate text-[10px]', on ? 'text-[var(--accent)]' : 'text-fg-3')}>{f ? f.toFixed(3).replace(/0$/, '') : '—'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="eyebrow">Tuned to</div>
          <div className="truncate text-[13px] font-semibold text-fg">{q.data?.station ?? RADIO_CHANNELS.find((k) => k.id === kind)!.label}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[13px] font-semibold text-fg">{freq ? fmtMhz(freq) : 'No published frequency'}</div>
          <div className="tnum text-[10.5px] text-fg-3">{lines.length ? `${lines.length} call${lines.length === 1 ? '' : 's'} · last 20 min` : 'last 20 min'}</div>
        </div>
      </div>

      {q.isPending ? (
        <div className="glass-2 space-y-2 rounded-[16px] p-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cn('skeleton h-10', i % 2 ? 'ml-auto w-3/4' : 'w-4/5')} />
          ))}
        </div>
      ) : !lines.length ? (
        <div className="glass-2 rounded-[16px] px-4 py-7 text-center">
          <Radio size={20} className="mx-auto text-fg-3" aria-hidden="true" />
          <p className="mt-2 text-[12.5px] font-medium text-fg-2">Quiet on this frequency right now</p>
          <p className="mt-1 text-[11.5px] leading-snug text-fg-3">
            {q.data ? 'No simulated flight has called in the last 20 minutes. Try another frequency, or keep listening.' : 'This airport is not part of the simulated world, so nothing is on frequency.'}
          </p>
        </div>
      ) : (
        <div className="relative">
          <div
            ref={box}
            onScroll={onScroll}
            role="log"
            aria-live={listening ? 'off' : 'polite'}
            aria-label={`Simulated ${q.data?.station ?? ''} transcript`}
            className="glass-2 scroll-thin max-h-[min(56vh,460px)] space-y-2.5 overflow-y-auto overscroll-contain rounded-[16px] p-3"
          >
            <AnimatePresence initial={false}>
              {lines.map((l, i) => {
                const atc = l.who === 'atc';
                const newest = i === lines.length - 1;
                const hand = atc ? handoffOf(l.text) : undefined;
                return (
                  <motion.div
                    key={lineKey(l)}
                    layout={reduce ? false : 'position'}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className={cn('flex flex-col', atc ? 'items-start' : 'items-end')}
                  >
                    <div className={cn('mb-1 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]', atc ? '' : 'flex-row-reverse')}>
                      <span className={cn('font-semibold', atc ? 'text-fg-2' : 'text-[var(--accent)]')}>{atc ? l.station.replace(/^.* (Delivery|Clearance|Ground|Tower|Approach|Departure)$/, '$1') : 'Pilot'}</span>
                      {/go around, I say again/.test(l.text) && (
                        <span className="rounded-[6px] bg-[rgba(255,181,71,0.16)] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#ffc56e]">Go-around</span>
                      )}
                      <button
                        type="button"
                        onClick={() => selectFlight(l.id)}
                        title={`Show ${l.flight} on the map`}
                        className="tnum rounded-[6px] bg-[var(--line)] px-1.5 py-px text-[10.5px] font-semibold text-fg hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] hover:text-[var(--accent)]"
                      >
                        {l.flight}
                      </button>
                      <span className="tnum text-fg-3">{hmsZ(l.t)}</span>
                      {newest && (
                        <span className="inline-flex items-center gap-1 text-[#7ee2a8]">
                          <span className="pulse-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
                          <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em]">Latest</span>
                        </span>
                      )}
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
                    {hand && hand.channel !== kind && (
                      <button
                        type="button"
                        onClick={() => setKind(hand.channel)}
                        title={`Follow the flight to ${hand.station}`}
                        className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                      >
                        <ArrowRightLeft size={11} aria-hidden="true" /> Hand-off to {RADIO_CHANNELS.find((c) => c.id === hand.channel)!.label}
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {unseen > 0 && (
              <motion.button
                type="button"
                onClick={jumpToLatest}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="tnum absolute bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
              >
                <ArrowDown size={12} /> {unseen} new call{unseen === 1 ? '' : 's'}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-fg-3">
        Phraseology is illustrative and generated from simulated flights — not a recording. Flights are handed off Tower → Departure after take-off and Approach → Tower on final. Airport
        frequencies are real published ones where known (Departure uses the approach frequency when none is published); en-route frequencies are invented. Times in UTC.
        {speech ? ' Listen reads each new call aloud (controller and pilots in different voices).' : ''}
      </p>
    </div>
  );
}
