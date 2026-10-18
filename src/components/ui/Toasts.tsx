import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useUI } from '@/state/ui';

const ICON = {
  info: <Info size={17} className="text-[var(--accent)]" />,
  success: <CheckCircle2 size={17} className="text-[#57e3a6]" />,
  warning: <AlertTriangle size={17} className="text-[#ffc56e]" />,
  error: <XCircle size={17} className="text-[#ff8a9a]" />,
};

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed left-1/2 top-[76px] z-[70] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col items-stretch gap-2 max-md:top-[64px]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            role={t.kind === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="glass pointer-events-auto flex items-start gap-3 rounded-[16px] px-4 py-3"
          >
            <span className="mt-0.5 shrink-0">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-fg">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[12px] leading-snug text-fg-2">{t.body}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                  className="mt-1.5 text-[12px] font-semibold text-[var(--accent)] hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-[var(--line)] hover:text-fg"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
