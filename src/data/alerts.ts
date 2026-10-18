// Emergency squawk alerts (7500/7600/7700 or an emergency status) for LIVE data only.
// In-app toasts by default; optional browser notifications when the user opts in.
import { SPECIAL_SQUAWKS } from '@shared/classify';
import { focusAircraft } from '@/map/controller';
import { getSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui } from '@/state/ui';

const alerted = new Map<string, string>(); // id → code already announced

export function startEmergencyAlerts(): () => void {
  return traffic.subscribe(() => {
    const mode = getSettings().emergencyAlerts;
    if (mode === 'off') return;
    for (const a of traffic.current()) {
      if (a.provider !== 'adsbfi') continue; // never alert on simulated data
      const special = a.squawk ? SPECIAL_SQUAWKS[a.squawk] : undefined;
      const code = special ? a.squawk! : a.emergency;
      if (!code || alerted.get(a.id) === code) continue;
      alerted.set(a.id, code);
      const label = a.callsign ?? a.registration ?? a.icao24.toUpperCase();
      const what = special ? `Squawk ${a.squawk} — ${special}` : `Emergency status: ${a.emergency}`;
      ui().toast({
        kind: 'error',
        title: `${label}: ${what}`,
        body: 'Reported by the aircraft’s transponder. Codes are sometimes set briefly by mistake.',
        action: {
          label: 'Show aircraft',
          run: () => {
            ui().select(a.id);
            focusAircraft(a.id, 9);
          },
        },
      });
      if (mode === 'notify' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(`${label}: ${what}`, { body: 'Arnav Flight Radar — tap to show the aircraft', icon: '/brand/icon-192.png', tag: `emergency-${a.id}` });
          n.onclick = () => {
            window.focus();
            ui().select(a.id);
            focusAircraft(a.id, 9);
          };
        } catch {
          /* notifications unavailable in this context */
        }
      }
    }
    if (alerted.size > 500) alerted.clear();
  });
}
