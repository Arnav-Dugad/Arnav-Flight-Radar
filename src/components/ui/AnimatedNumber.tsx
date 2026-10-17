import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

/**
 * Numeric readout that glides between values (telemetry, counters). Updates the
 * DOM text directly so React does not re-render on every animation frame.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
  duration = 0.6,
}: {
  value: number | undefined;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value ?? 0);
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    if (value === undefined) return;
    if (reduce) {
      mv.set(value);
      if (ref.current) ref.current.textContent = fmt.current(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, duration, mv, reduce]);

  useEffect(
    () =>
      mv.on('change', (v) => {
        if (ref.current) ref.current.textContent = fmt.current(v);
      }),
    [mv],
  );

  return (
    <span ref={ref} className={className}>
      {value === undefined ? '—' : format(value)}
    </span>
  );
}
