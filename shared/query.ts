// Classifies a free-text aircraft query into a provider lookup kind.

export type AircraftQueryKind = 'hex' | 'callsign' | 'registration' | 'sqk';

export interface AircraftQuery {
  kind: AircraftQueryKind;
  value: string;
}

const HEX = /^[0-9A-F]{6}$/;
const SQUAWK = /^[0-7]{4}$/;
const CALLSIGN = /^[A-Z]{2,3}[0-9][0-9A-Z]{0,4}$|^[A-Z0-9]{3,8}$/;
const REG_WITH_DASH = /^[A-Z0-9]{1,3}-[A-Z0-9]{1,6}$/;
const REG_US = /^N[1-9][0-9A-Z]{0,4}$/;

/**
 * Returns the most likely interpretation, or null if the input cannot be an
 * aircraft identifier. `force` lets the user pick the interpretation explicitly.
 */
export function classifyAircraftQuery(input: string, force?: AircraftQueryKind): AircraftQuery | null {
  const v = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!v || v.length > 10) return null;
  if (force) {
    const ok =
      (force === 'hex' && HEX.test(v)) ||
      (force === 'sqk' && SQUAWK.test(v)) ||
      (force === 'registration' && (REG_WITH_DASH.test(v) || /^[A-Z0-9]{2,8}$/.test(v))) ||
      (force === 'callsign' && CALLSIGN.test(v));
    return ok ? { kind: force, value: force === 'hex' ? v.toLowerCase() : v } : null;
  }
  if (SQUAWK.test(v)) return { kind: 'sqk', value: v };
  if (REG_WITH_DASH.test(v)) return { kind: 'registration', value: v };
  if (REG_US.test(v) && /\d/.test(v.slice(1))) return { kind: 'registration', value: v };
  if (HEX.test(v) && /\d/.test(v) && /[A-F]/.test(v)) return { kind: 'hex', value: v.toLowerCase() };
  if (CALLSIGN.test(v)) return { kind: 'callsign', value: v };
  if (HEX.test(v)) return { kind: 'hex', value: v.toLowerCase() };
  return null;
}
