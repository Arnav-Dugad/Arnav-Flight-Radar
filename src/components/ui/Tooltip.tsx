import { AnimatePresence, motion } from 'motion/react';
import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Kbd } from './Feedback';

interface Props {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement<Record<string, unknown>>;
}

/** Hover/focus tooltip rendered in a portal so glass panels never clip it. */
export function Tooltip({ content, shortcut, side = 'bottom', children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const show = (el: HTMLElement) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const gap = 8;
      const p =
        side === 'top'
          ? { x: r.left + r.width / 2, y: r.top - gap }
          : side === 'left'
            ? { x: r.left - gap, y: r.top + r.height / 2 }
            : side === 'right'
              ? { x: r.right + gap, y: r.top + r.height / 2 }
              : { x: r.left + r.width / 2, y: r.bottom + gap };
      setPos(p);
    }, 380);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setPos(null);
  };

  if (!isValidElement(children)) return children;
  const child = cloneElement(children, {
    'aria-describedby': pos ? id : undefined,
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') show(e.currentTarget);
      (children.props.onPointerEnter as ((e: unknown) => void) | undefined)?.(e);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      hide();
      (children.props.onPointerLeave as ((e: unknown) => void) | undefined)?.(e);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
      (children.props.onFocus as ((e: unknown) => void) | undefined)?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      hide();
      (children.props.onBlur as ((e: unknown) => void) | undefined)?.(e);
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      hide();
      (children.props.onClick as ((e: unknown) => void) | undefined)?.(e);
    },
  });

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'left'
        ? 'translate(-100%, -50%)'
        : side === 'right'
          ? 'translate(0, -50%)'
          : 'translate(-50%, 0)';

  return (
    <>
      {child}
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              id={id}
              role="tooltip"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: 'fixed', left: pos.x, top: pos.y, transform, zIndex: 100 }}
              className="pointer-events-none"
            >
              <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[12px] font-medium text-fg shadow-xl">
                {content}
                {shortcut && <Kbd>{shortcut}</Kbd>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
