// Real terminal allocations at major airports (as publicly documented, late 2025/2026),
// used only by the simulation (always labelled as simulated) to put simulated flights
// at a plausible terminal. Allocations change often; these are a best effort and
// deliberately cover only airports/terminals with well-known splits. Single-terminal
// airports are omitted.

/**
 * Allocation rules for one airport. Keys are terminal-name PREFIXES matched
 * case-insensitively against OSM terminal names (so 'Terminal 5' also matches
 * 'Terminal 5B', 'Terminal 2' matches 'Terminal 2E' — so put more specific keys like
 * 'Terminal 2E' BEFORE 'Terminal 2' in the array). A prefix ending in a digit never
 * matches a longer number ('Terminal 1' does not match 'Terminal 12').
 *
 * Values list who uses it: airline ICAO codes, alliance names exactly
 * 'oneworld' | 'Star Alliance' | 'SkyTeam', or the keywords 'domestic',
 * 'international', 'schengen', 'non-schengen', 'low-cost', 'cargo', '*' (everyone else).
 * An airline code may carry a qualifier — 'QFA@domestic', 'AFR@schengen',
 * 'UAL@international', 'ANA@non-schengen' — which then applies only to those flights.
 */
export interface TerminalRule {
  prefix: string;
  users: string[];
}

const r = (prefix: string, ...users: string[]): TerminalRule => ({ prefix, users });

export const TERMINAL_RULES: Record<string, TerminalRule[]> = {
  // ================================================================== Europe
  EGLL: [
    r('Terminal 5', 'BAW', 'IBE'),
    r('Terminal 3', 'VIR', 'DAL', 'AAL', 'UAE', 'CPA', 'QFA', 'JAL', 'FIN', 'ALK', 'oneworld'),
    r('Terminal 2', 'EIN', 'ICE', 'Star Alliance'),
    r('Terminal 4', 'QTR', 'MAS', 'ETD', 'GFA', 'OMA', 'RAM', 'KAC', 'ELY', 'SkyTeam', '*'),
  ],
  EGKK: [
    r('North Terminal', 'EZY', 'EJU', 'EZS', 'UAE', 'QTR'),
    r('South Terminal', 'BAW', 'RYR', 'NAX', 'TOM', '*'),
  ],
  EGCC: [
    r('Terminal 3', 'RYR', 'BAW', 'LOG'),
    r('Terminal 2', '*'),
    r('Terminal 1', '*'),
  ],
  EIDW: [
    r('Terminal 2', 'EIN', 'EAI', 'UAE', 'ETD', 'QTR', 'AAL', 'DAL', 'UAL', 'ACA'),
    r('Terminal 1', 'RYR', '*'),
  ],
  LFPG: [
    r('Terminal 2G', 'HOP'),
    r('Terminal 2F', 'AFR@schengen', 'KLM'),
    r('Terminal 2E', 'AFR', 'SkyTeam'),
    r('Terminal 2D', 'EZY', 'EJU', 'EZS'),
    r('Terminal 2C', 'UAE'),
    r('Terminal 2A', 'AAL'),
    r('Terminal 2B', 'low-cost'),
    r('Terminal 3', 'low-cost'),
    r('Terminal 1', 'QTR', 'ETD', 'Star Alliance', '*'),
  ],
  EDDF: [
    r('Terminal 1', 'DLH', 'CLH', 'CFG', 'OCN', 'Star Alliance'),
    r('Terminal 2', 'oneworld', 'SkyTeam', '*'),
  ],
  EDDM: [
    r('Terminal 2', 'DLH', 'CLH', 'Star Alliance'),
    r('Terminal 1', '*'),
  ],
  EDDH: [
    r('Terminal 2', 'DLH', 'Star Alliance'),
    r('Terminal 1', '*'),
  ],
  EDDB: [
    r('Terminal 2', 'RYR'),
    r('Terminal 1', '*'),
  ],
  LEMD: [
    r('Terminal 4', 'IBE', 'IBS', 'ANE', 'oneworld'),
    r('Terminal 2', 'Star Alliance'),
    r('Terminal 1', 'RYR', 'EZY', 'low-cost', 'SkyTeam', '*'),
  ],
  LEBL: [
    r('Terminal 2', 'EZY', 'EJU', 'EZS', 'RYR'),
    r('Terminal 1', '*'),
  ],
  LIRF: [
    r('Terminal 1', 'ITY', 'SkyTeam', 'schengen', 'domestic'),
    r('Terminal 3', '*'),
  ],
  LOWW: [
    r('Terminal 3', 'AUA', 'Star Alliance'),
    r('Terminal 1A', 'low-cost'),
    r('Terminal 1', '*'),
  ],
  ESSA: [
    r('Terminal 4', 'domestic'),
    r('Terminal 5', '*'),
  ],
  LPPT: [
    r('Terminal 2', 'RYR', 'EZY', 'EJU', 'WZZ', 'TVF', 'TRA'),
    r('Terminal 1', '*'),
  ],
  LKPR: [
    r('Terminal 2', 'schengen'),
    r('Terminal 1', 'non-schengen', '*'),
  ],
  LHBP: [
    r('Terminal 2A', 'schengen'),
    r('Terminal 2B', 'non-schengen', '*'),
  ],
  UUEE: [
    r('Terminal B', 'domestic'),
    r('Terminal C', 'international'),
  ],

  // ================================================================== Middle East & Africa
  OMDB: [
    r('Terminal 3', 'UAE'),
    r('Concourse B', 'UAE'),
    r('Terminal 2', 'FDB', 'low-cost'),
    r('Terminal 1', '*'),
    r('Concourse D', '*'),
  ],
  OERK: [
    r('Terminal 5', 'domestic'),
    r('Terminal 4', 'SVA'),
    r('Terminal 3', 'KNE', 'FAD'),
    r('Terminal 1', '*'),
    r('Terminal 2', '*'),
  ],
  OEJN: [
    r('Terminal 1', 'SVA', 'KNE', 'FAD'),
    r('North Terminal', '*'),
  ],
  OKKK: [
    r('Terminal 4', 'KAC'),
    r('Terminal 5', 'JZR'),
    r('Terminal 1', '*'),
  ],
  LLBG: [
    r('Terminal 1', 'low-cost', 'domestic'),
    r('Terminal 3', '*'),
  ],
  HECA: [
    r('Terminal 3', 'MSR', 'Star Alliance'),
    r('Terminal 2', '*'),
    r('Terminal 1', '*'),
  ],
  HAAB: [
    r('Terminal 1', 'domestic'),
    r('Terminal 2', '*'),
  ],
  FAOR: [
    r('Terminal A', 'international'),
    r('Terminal B', 'domestic'),
  ],

  // ================================================================== South Asia
  VIDP: [
    r('Terminal 3', 'AIC', 'international'),
    r('Terminal 1', 'IGO', 'SEJ', 'AKJ', 'domestic'),
  ],
  VABB: [
    r('Terminal 2', 'AIC', 'international'),
    r('Terminal 1', 'domestic'),
  ],
  VOBL: [
    r('Terminal 2', 'international'),
    r('Terminal 1', 'domestic'),
  ],
  VOMM: [
    r('Terminal 2', 'international'),
    r('Terminal 1', 'domestic'),
  ],

  // ================================================================== South-East Asia
  WSSS: [
    r('Terminal 3', 'SIA'),
    r('Terminal 4', 'CPA', 'KAL', 'AXM', 'CEB', 'VJC'),
    r('Terminal 2', 'Star Alliance'),
    r('Terminal 1', 'TGW', 'UAE', 'QFA', 'JST', '*'),
  ],
  WMKK: [
    r('Terminal 2', 'AXM', 'XAX', 'low-cost'),
    r('Terminal 1', '*'),
  ],
  WIII: [
    r('Terminal 3', 'GIA', 'international'),
    r('Terminal 1', 'LNI', 'WON', 'SJV', 'domestic'),
  ],
  VTBD: [
    r('Terminal 1', 'international'),
    r('Terminal 2', 'domestic'),
  ],
  VVTS: [
    r('Terminal 3', 'HVN@domestic', 'VJC@domestic'),
    r('Terminal 2', 'international'),
    r('Terminal 1', 'domestic'),
  ],
  VVNB: [
    r('Terminal 2', 'international'),
    r('Terminal 1', 'domestic'),
  ],
  RPLL: [
    r('Terminal 2', 'PAL'),
    r('Terminal 3', 'CEB', 'domestic'),
    r('Terminal 1', 'international', '*'),
  ],

  // ================================================================== East Asia
  RCTP: [
    r('Terminal 2', 'EVA', 'CAL'),
    r('Terminal 1', '*'),
  ],
  RJTT: [
    r('Terminal 1', 'JAL@domestic', 'SKY'),
    r('Terminal 2', 'ANA@domestic'),
    r('Terminal 3', 'international', '*'),
  ],
  RJAA: [
    r('Terminal 3', 'JJP'),
    r('Terminal 1', 'ANA', 'TZP', 'APJ', 'Star Alliance', 'SkyTeam'),
    r('Terminal 2', 'JAL', 'oneworld', '*'),
  ],
  RJBB: [
    r('Terminal 2', 'APJ'),
    r('Terminal 1', '*'),
  ],
  RJCC: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  RJFF: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  RKSI: [
    r('Terminal 2', 'KAL', 'AAR', 'JNA', 'SkyTeam'),
    r('Terminal 1', '*'),
  ],
  RKSS: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  ZBAA: [
    r('Terminal 3', 'CCA', 'Star Alliance', 'oneworld'),
    r('Terminal 2', 'CHH', 'SkyTeam', '*'),
  ],
  ZSPD: [
    r('Terminal 1', 'CES', 'SkyTeam'),
    r('Terminal 2', 'CCA', 'CQH', 'Star Alliance', 'oneworld', '*'),
  ],
  ZSSS: [
    r('Terminal 1', 'CQH', 'international'),
    r('Terminal 2', '*'),
  ],
  ZGGG: [
    r('Terminal 2', 'CSN', 'SkyTeam'),
    r('Terminal 1', '*'),
  ],

  // ================================================================== Oceania
  YSSY: [
    r('Terminal 3', 'QFA@domestic', 'QLK'),
    r('Terminal 1', 'international'),
    r('Terminal 2', 'domestic'),
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  YMML: [
    r('Terminal 1', 'QFA@domestic', 'QLK'),
    r('Terminal 3', 'VOZ@domestic', 'RXA'),
    r('Terminal 4', 'JST@domestic', 'low-cost'),
    r('Terminal 2', 'international', '*'),
  ],
  YBBN: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  YPPH: [
    r('Terminal 4', 'QFA', 'QLK'),
    r('Terminal 3', 'JST'),
    r('Terminal 1', 'international', 'VOZ'),
    r('Terminal 2', 'domestic'),
  ],
  NZAA: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],

  // ================================================================== United States
  KATL: [
    r('Maynard', 'international'),
    r('International', 'international'),
    r('Domestic', 'domestic', '*'),
  ],
  KJFK: [
    r('Terminal 4', 'DAL', 'EDV', 'VIR', 'AFR', 'KLM', 'KAL', 'UAE', 'SIA', 'SkyTeam'),
    r('Terminal 8', 'AAL', 'ENY', 'BAW', 'IBE', 'QTR', 'JAL', 'CPA', 'FIN', 'RJA', 'QFA', 'ASA', 'oneworld'),
    r('Terminal 5', 'JBU', 'EIN'),
    r('Terminal 7', 'ANA', 'ICE'),
    r('Terminal 1', 'Star Alliance', '*'),
  ],
  KORD: [
    r('Terminal 1', 'UAL', 'ASH', 'Star Alliance'),
    r('Concourse B', 'UAL'),
    r('Concourse C', 'UAL'),
    r('Terminal 3', 'AAL', 'ENY', 'JIA', 'PDT', 'ASA', 'oneworld'),
    r('Concourse H', 'AAL'),
    r('Concourse K', 'AAL'),
    r('Terminal 2', 'ACA'),
    r('Terminal 5', 'international', '*'),
  ],
  KLAX: [
    r('Terminal 1', 'SWA'),
    r('Terminal 3', 'DAL', 'EDV'),
    r('Terminal 2', 'SkyTeam'),
    r('Terminal 4', 'AAL', 'ENY'),
    r('Terminal 5', 'NKS', 'FFT', 'AAY', 'HAL', 'JBU'),
    r('Terminal 6', 'ASA', 'QXE', 'ACA'),
    r('Terminal 7', 'UAL'),
    r('Terminal 8', 'SKW'),
    r('Tom Bradley', 'international', 'oneworld', 'Star Alliance'),
    r('Terminal 5', '*'),
  ],
  KDFW: [
    r('Terminal D', 'AAL@international', 'international'),
    r('Terminal A', 'AAL'),
    r('Terminal B', 'ENY', 'JIA', 'PDT'),
    r('Terminal E', '*'),
  ],
  KDEN: [
    r('Concourse B', 'UAL', 'ASH'),
    r('Concourse C', 'SWA'),
    r('Concourse A', 'FFT', 'international', '*'),
  ],
  KSFO: [
    r('Terminal 3', 'UAL@domestic'),
    r('International', 'international'),
    r('Terminal 2', 'ASA', 'QXE'),
    r('Harvey Milk', 'SWA', '*'),
    r('Terminal 1', 'SWA', '*'),
  ],
  KMIA: [
    r('North Terminal', 'AAL', 'ENY', 'oneworld'),
    r('South Terminal', '*'),
    r('Central Terminal', '*'),
  ],
  KEWR: [
    r('Terminal C', 'UAL', 'ASH'),
    r('Terminal B', 'international'),
    r('Terminal A', '*'),
  ],
  KBOS: [
    r('Terminal A', 'DAL@domestic', 'EDV'),
    r('Terminal C', 'JBU@domestic'),
    r('Terminal E', 'international'),
    r('Terminal B', '*'),
  ],
  KIAH: [
    r('Terminal C', 'UAL@domestic', 'ASH'),
    r('Terminal E', 'UAL'),
    r('Terminal D', 'international'),
    r('Mickey Leland', 'international'),
    r('Terminal A', '*'),
    r('Terminal B', '*'),
  ],
  KMCO: [
    r('Terminal C', 'JBU', 'international'),
    r('Terminal A', '*'),
    r('Terminal B', '*'),
  ],
  KLAS: [
    r('Terminal 3', 'international', 'UAL', 'HAL'),
    r('Terminal 1', '*'),
  ],
  KPHX: [
    r('Terminal 4', 'SWA', 'AAL'),
    r('Terminal 3', '*'),
  ],
  KMSP: [
    r('Terminal 2', 'SCX', 'SWA', 'FFT', 'NKS', 'ICE'),
    r('Terminal 1', '*'),
  ],
  KDTW: [
    r('McNamara', 'DAL', 'EDV', 'SkyTeam'),
    r('Evans', '*'),
  ],
  KPHL: [
    r('Terminal A', 'international'),
    r('Terminal B', '*'),
  ],

  // ================================================================== Canada & Latin America
  CYYZ: [
    r('Terminal 1', 'ACA', 'ROU', 'JZA', 'Star Alliance'),
    r('Terminal 3', 'WJA', 'POE', 'TSC', '*'),
  ],
  CYVR: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
  ],
  MMMX: [
    r('Terminal 2', 'AMX', 'SkyTeam'),
    r('Terminal 1', '*'),
  ],
  SBGR: [
    r('Terminal 3', 'international'),
    r('Terminal 2', 'domestic'),
  ],
  SCEL: [
    r('International', 'international'),
    r('Domestic', 'domestic'),
    r('Terminal 2', 'international'),
    r('Terminal 1', 'domestic'),
  ],
};

/** Schengen-area member countries (ISO 3166-1 alpha-2), 2026 — incl. Croatia, Bulgaria, Romania. */
export const SCHENGEN: Set<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT',
  'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH',
]);

const ALLIANCE_NAMES = new Set(['oneworld', 'Star Alliance', 'SkyTeam']);
const CJK_DIGITS: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };

/** Normalise a terminal name: 'T5'/'5'/'Terminal5' -> 'Terminal 5', plus Arabic and CJK forms. */
function normaliseName(name: string): string {
  let s = name.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[一二三四五六七八九]/g, (d) => CJK_DIGITS[d] ?? d);
  const cjk = /^第?(\d+)\s*(?:号)?\s*(?:航站楼|航廈|ターミナル)/.exec(s);
  if (cjk) return `Terminal ${cjk[1]}`;
  const ar = /^(?:ال)?مبنى\s*(\d+)/.exec(s);
  if (ar) return `Terminal ${ar[1]}`;
  const short = /^(?:T|Terminal)?\s*(\d+[A-Z]?)$/i.exec(s);
  if (short) return `Terminal ${short[1]!.toUpperCase()}`;
  return s.replace(/^Terminal(?=\d)/i, 'Terminal ');
}

/** Length of `prefix` if it matches `name` (both lower-cased), else -1. */
function prefixMatch(name: string, prefix: string): number {
  if (!name.startsWith(prefix)) return -1;
  const next = name.charAt(prefix.length);
  if (next && /\d/.test(next) && /\d$/.test(prefix)) return -1;
  return prefix.length;
}

/**
 * Index into `terminalNames` of the terminal `who` would use at `airport`, or -1.
 * Matching order: airline ICAO (incl. qualified 'XXX@domestic' entries) → alliance →
 * cargo → low-cost → domestic/international/schengen/non-schengen → '*'. `schengen`
 * should be true when both ends of the flight are in the Schengen area (left undefined,
 * the schengen keywords are not used).
 */
export function terminalFor(
  airport: string,
  terminalNames: string[],
  who: { icao: string; alliance?: string; domestic: boolean; schengen?: boolean; lowCost?: boolean; cargo?: boolean },
): number {
  const rules = TERMINAL_RULES[airport.toUpperCase()];
  if (!rules || terminalNames.length === 0) return -1;
  const names = terminalNames.map((n) => normaliseName(n).toLowerCase());
  const prefixes = rules.map((rule) => normaliseName(rule.prefix).toLowerCase());

  // For each rule, the names it owns: those whose longest matching rule prefix is this
  // rule's (so 'Terminal 2' does not claim 'Terminal 2E' when a 2E rule exists).
  // Exact matches come first; if a rule owns nothing, any name it matches is used.
  const candidates = prefixes.map((p) => {
    const own: number[] = [];
    const any: number[] = [];
    names.forEach((n, i) => {
      const len = prefixMatch(n, p);
      if (len < 0) return;
      any.push(i);
      if (prefixes.every((q) => prefixMatch(n, q) <= len)) own.push(i);
    });
    const list = own.length ? own : any;
    return list.sort((a, b) => Number(names[b] === p) - Number(names[a] === p));
  });

  const icao = who.icao.toUpperCase();
  const qualifies = (q: string): boolean => {
    switch (q) {
      case 'domestic':
        return who.domestic;
      case 'international':
        return !who.domestic;
      case 'schengen':
        return who.schengen === true;
      case 'non-schengen':
        return who.schengen === false;
      default:
        return false;
    }
  };
  const steps: ((u: string) => boolean)[] = [
    (u) => {
      const at = u.indexOf('@');
      if (at < 0) return u === icao;
      return u.slice(0, at) === icao && qualifies(u.slice(at + 1));
    },
    (u) => who.alliance !== undefined && ALLIANCE_NAMES.has(u) && u === who.alliance,
    (u) => who.cargo === true && u === 'cargo',
    (u) => who.lowCost === true && u === 'low-cost',
    (u) => (u === 'domestic' || u === 'international' || u === 'schengen' || u === 'non-schengen') && qualifies(u),
    (u) => u === '*',
  ];

  for (const step of steps) {
    for (let i = 0; i < rules.length; i++) {
      const hit = candidates[i]![0];
      if (hit !== undefined && rules[i]!.users.some(step)) return hit;
    }
  }
  return -1;
}
