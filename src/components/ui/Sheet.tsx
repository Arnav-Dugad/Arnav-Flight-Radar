import { X } from 'lucide-react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useMedia';
import { useUI } from '@/state/ui';
import { IconButton } from './Glass';

interface PanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Panels like aircraft details get the "hero" header treatment. */
  bare?: boolean;
  ariaLabel: string;
}

/** Right-side panel on desktop, draggable bottom sheet on mobile. */
export function Panel(props: PanelProps) {
  const mobile = useIsMobile();
  return mobile ? <BottomSheet {...props} /> : <SidePanel {...props} />;
}

function Header({ title, icon, subtitle, actions, onClose }: Pick<PanelProps, 'title' | 'icon' | 'subtitle' | 'actions' | 'onClose'>) {
  return (
    <header className="flex items-start gap-3 px-5 pb-3 pt-4">
      {icon && <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[12px] glass-2 text-[var(--accent)]">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {subtitle && <div className="mt-0.5 truncate text-[12px] text-fg-3">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <IconButton label="Close panel" shortcut="Esc" onClick={onClose} size={34}>
          <X size={17} />
        </IconButton>
      </div>
    </header>
  );
}

function SidePanel({ open, onClose, title, icon, subtitle, actions, children, footer, width = 392, bare, ariaLabel }: PanelProps) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.aside
          key="panel"
          role="complementary"
          aria-label={ariaLabel}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: 28, scale: 0.985, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
          style={{ width }}
          className="glass pointer-events-auto absolute bottom-[68px] right-4 top-[76px] z-30 flex flex-col overflow-hidden rounded-[var(--radius-2xl)]"
        >
          {!bare && <Header title={title} icon={icon} subtitle={subtitle} actions={actions} onClose={onClose} />}
          <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto', !bare && 'px-5 pb-5')}>{children}</div>
          {footer && <div className="border-t border-[var(--line)] px-5 py-3">{footer}</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const SNAP_PEEK = 176;

function BottomSheet({ open, onClose, title, icon, subtitle, actions, children, footer, bare, ariaLabel }: PanelProps) {
  const sheet = useUI((s) => s.sheet);
  const setSheet = useUI((s) => s.setSheet);
  const controls = useDragControls();
  const [vh, setVh] = useState(() => window.innerHeight);
  const y = useMotionValue(vh);
  const fullH = vh - 64;
  const snapY = (s: typeof sheet) => (s === 'full' ? 0 : s === 'half' ? fullH - Math.round(vh * 0.52) : fullH - SNAP_PEEK);

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    if (y.get() > fullH) y.set(vh);
    void animate(y, snapY(sheet), { type: 'spring', stiffness: 420, damping: 40 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet, fullH]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const cur = y.get();
    const v = info.velocity.y;
    const candidates = (['full', 'half', 'peek'] as const).map((s) => ({ s, d: Math.abs(snapY(s) - (cur + v * 0.18)) }));
    if (cur + v * 0.18 > fullH - SNAP_PEEK / 2 + 40) {
      onClose();
      return;
    }
    const best = candidates.sort((a, b) => a.d - b.d)[0]!.s;
    setSheet(best);
    void animate(y, snapY(best), { type: 'spring', stiffness: 420, damping: 40, velocity: v });
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.section
          key="sheet"
          role="dialog"
          aria-label={ariaLabel}
          aria-modal="false"
          // No `initial`: the `y` motion value already starts off-screen and the
          // snap effect animates it; an `initial` prop would override that.
          exit={{ y: vh, transition: { duration: 0.25 } }}
          style={{ y, height: fullH }}
          drag="y"
          dragControls={controls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: fullH }}
          dragElastic={{ top: 0.04, bottom: 0.3 }}
          onDragEnd={onDragEnd}
          className="glass fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-[28px] border-b-0"
        >
          <div
            onPointerDown={(e) => controls.start(e)}
            className="flex shrink-0 cursor-grab touch-none flex-col active:cursor-grabbing"
            onDoubleClick={() => setSheet(sheet === 'full' ? 'half' : 'full')}
          >
            <div className="mx-auto mt-2.5 h-[5px] w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true" />
            {!bare && <Header title={title} icon={icon} subtitle={subtitle} actions={actions} onClose={onClose} />}
          </div>
          <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain', !bare && 'px-5 pb-6')}>{children}</div>
          {footer && <div className="safe-bottom border-t border-[var(--line)] px-5 py-3">{footer}</div>}
        </motion.section>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button,[tabindex]:not([tabindex="-1"])')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      restore.current?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : typeof title === 'string' ? title : 'Dialog'}
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            style={{ maxWidth: width }}
            className="glass relative w-full overflow-hidden rounded-[var(--radius-2xl)]"
          >
            {title && (
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">{title}</h2>
                <IconButton label="Close" onClick={onClose} size={32}>
                  <X size={16} />
                </IconButton>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
