import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, useCallback, type ButtonHTMLAttributes, type HTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

/** Updates --mx/--my so the .sheen highlight follows the pointer. */
export function useSheen() {
  return useCallback((e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);
}

export const GlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { elevated?: boolean }>(
  function GlassPanel({ className, elevated, ...rest }, ref) {
    return <div ref={ref} className={cn('glass rounded-[var(--radius-xl)]', elevated && 'shadow-2xl', className)} {...rest} />;
  },
);

type Variant = 'glass' | 'ghost' | 'accent' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  glass: 'glass text-fg hover:bg-[var(--surface-2)]',
  ghost: 'text-fg-2 hover:text-fg hover:bg-[var(--line)]',
  subtle: 'glass-2 text-fg hover:border-[var(--line-strong)]',
  accent:
    'bg-[var(--accent)] text-[#03111c] font-semibold shadow-[0_8px_24px_-8px_rgba(92,225,255,0.65)] hover:brightness-110',
  danger: 'bg-[rgba(255,93,115,0.14)] text-[#ff8a9a] border border-[rgba(255,93,115,0.35)] hover:bg-[rgba(255,93,115,0.22)]',
};
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-[10px]',
  md: 'h-10 px-4 text-[13.5px] gap-2 rounded-[12px]',
  lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-[14px]',
};

export interface GlassButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
  children?: ReactNode;
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { variant = 'subtle', size = 'md', active, className, children, onPointerMove, ...rest },
  ref,
) {
  const sheen = useSheen();
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      onPointerMove={(e) => {
        sheen(e);
        onPointerMove?.(e);
      }}
      className={cn(
        'sheen inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,filter] duration-200 disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        active && 'border-[var(--line-strong)] !bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: number;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  variant?: 'glass' | 'ghost';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 40, tooltipSide = 'bottom', variant = 'ghost', className, children, onPointerMove, ...rest },
  ref,
) {
  const sheen = useSheen();
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        onPointerMove={(e) => {
          sheen(e);
          onPointerMove?.(e);
        }}
        style={{ width: size, height: size }}
        className={cn(
          'sheen relative grid shrink-0 place-items-center rounded-[12px] text-fg-2 transition-[color,background,transform] duration-200 hover:text-fg active:scale-95',
          variant === 'glass' ? 'glass' : 'hover:bg-[var(--line)]',
          active && 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] hover:text-[var(--accent)]',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export function Divider({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-[var(--line)]', className)} />;
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
