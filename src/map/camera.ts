// Shared camera helpers (separate module to avoid controller ↔ feed/layer import cycles).
import { ui } from '@/state/ui';

export const cameraFlags = { autoRotating: false };

/** Pixels hidden by open panels: side panel on desktop, bottom sheet on mobile. */
export function viewPadding(): { top: number; bottom: number; left: number; right: number } {
  const u = ui();
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  if (!u.panel || u.presentation) return none;
  if (window.innerWidth < 768) {
    const h = u.sheet === 'peek' ? 176 : u.sheet === 'half' ? Math.round(window.innerHeight * 0.52) : 0;
    return { top: 60, bottom: h, left: 0, right: 0 };
  }
  return { top: 0, bottom: 0, left: 0, right: 404 };
}

/** Non-persistent equivalent of the padding, for flyTo/easeTo `offset`. */
export function viewOffset(): [number, number] {
  const p = viewPadding();
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
}
