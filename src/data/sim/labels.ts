// Labels for simulated flight kinds (shared by the page and the simulation worker).
import type { LegKind } from './engine';

export const LEG_KIND_LABEL: Record<LegKind, string> = {
  scheduled: 'Scheduled passenger flight',
  cargo: 'Cargo flight',
  positioning: 'Positioning flight · no passengers',
  delivery: 'Delivery flight from the factory',
  ga: 'General aviation',
  circuits: 'Circuit training (touch-and-go)',
  bizjet: 'Business aviation',
  military: 'Military transport',
  tanker: 'Air-to-air refuelling',
  awacs: 'Airborne early warning',
  patrol: 'Maritime patrol',
  training: 'Military training sortie',
  ambulance: 'Air ambulance transfer',
  hems: 'Air ambulance (HEMS)',
  offshore: 'Offshore helicopter shuttle',
  shuttle: 'Helicopter shuttle',
  glider: 'Glider (FLARM)',
  tow: 'Glider tow',
};
export const legKindLabel = (k: LegKind) => LEG_KIND_LABEL[k];
