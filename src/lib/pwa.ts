// Installable app + offline awareness.
import { create } from 'zustand';
import { ui } from '@/state/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const useInstall = create<{ prompt: BeforeInstallPromptEvent | null; install: () => Promise<void> }>()((set, get) => ({
  prompt: null,
  install: async () => {
    const p = get().prompt;
    if (!p) return;
    await p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') ui().toast({ kind: 'success', title: 'Arnav Flight Radar installed' });
    set({ prompt: null });
  },
}));

export function initPwa() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker registration failed', e));
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => useInstall.setState({ prompt: null }));
  window.addEventListener('offline', () =>
    ui().toast({ kind: 'warning', title: 'You are offline', body: 'The simulation keeps running; map tiles and weather need a connection.' }),
  );
  window.addEventListener('online', () => ui().toast({ kind: 'success', title: 'Back online', body: 'Weather and map tiles will refresh shortly.' }));
}
