// One-time welcome sheet: explains that the world is simulated and how to get around.
import { useState } from 'react';
import { BrandMark } from '@/components/icons';
import { Kbd } from '@/components/ui/Feedback';
import { GlassButton } from '@/components/ui/Glass';
import { Modal } from '@/components/ui/Sheet';
import { load, save } from '@/lib/storage';
import { useUI } from '@/state/ui';

const KEY = 'welcome-v1';

export function Welcome() {
  const [open, setOpen] = useState(() => !load<boolean>(KEY, false) && !navigator.webdriver);
  const openPanel = useUI((s) => s.openPanel);
  const close = () => {
    save(KEY, true);
    setOpen(false);
  };
  return (
    <Modal open={open} onClose={close} width={520} labelledBy="welcome-title">
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <h2 id="welcome-title" className="text-[20px] font-semibold tracking-[-0.02em] text-fg">
              Welcome to Arnav Flight Radar
            </h2>
            <p className="text-[12.5px] text-fg-3">A living, simulated world of air traffic</p>
          </div>
        </div>
        <p className="text-[13.5px] leading-relaxed text-fg-2">
          Every aircraft here is <strong className="text-fg">simulated</strong>: more than 200 real airlines fly real aircraft types between real airports, gate to gate. You'll see push-backs,
          departure queues, jet-stream winds, holding stacks, diversions in bad weather, approaches and landings. The weather is real, and it decides which runways are in use.
        </p>
        <p className="text-[12.5px] leading-relaxed text-fg-3">The flights, registrations and schedules are invented, so don't use this site to track a real flight.</p>
        <ul className="tnum grid grid-cols-2 gap-2 text-[12px] text-fg-2">
          <li className="glass-2 rounded-[12px] px-3 py-2">
            <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> search flights, airlines, airports
          </li>
          <li className="glass-2 rounded-[12px] px-3 py-2">
            <Kbd>J</Kbd> jump to a random flight
          </li>
          <li className="glass-2 rounded-[12px] px-3 py-2">
            <Kbd>X</Kbd> 3D view behind an aircraft
          </li>
          <li className="glass-2 rounded-[12px] px-3 py-2">
            <Kbd>1</Kbd>–<Kbd>4</Kbd> speed up the clock
          </li>
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            className="text-[12.5px] font-medium text-[var(--accent)] hover:underline"
            onClick={() => {
              close();
              openPanel('data');
            }}
          >
            What's real and what's simulated?
          </button>
          <GlassButton variant="accent" onClick={close}>
            Start exploring
          </GlassButton>
        </div>
      </div>
    </Modal>
  );
}
