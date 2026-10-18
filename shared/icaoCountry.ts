// State of registry from the ICAO 24-bit address allocation (ICAO Annex 10,
// Vol. III, Part I, Chapter 9 table). This identifies the country that assigned
// the address — normally the state of registration — not the operator's nationality.
// Only well-established blocks are listed; anything else returns undefined.

type Block = [start: number, end: number, iso: string, name: string];

const BLOCKS: Block[] = (
  [
    ['004000', '0043FF', 'ZW', 'Zimbabwe'],
    ['006000', '006FFF', 'MZ', 'Mozambique'],
    ['008000', '00FFFF', 'ZA', 'South Africa'],
    ['010000', '017FFF', 'EG', 'Egypt'],
    ['018000', '01FFFF', 'LY', 'Libya'],
    ['020000', '027FFF', 'MA', 'Morocco'],
    ['028000', '02FFFF', 'TN', 'Tunisia'],
    ['030000', '0303FF', 'BW', 'Botswana'],
    ['040000', '040FFF', 'ET', 'Ethiopia'],
    ['044000', '044FFF', 'GH', 'Ghana'],
    ['04C000', '04CFFF', 'KE', 'Kenya'],
    ['054000', '054FFF', 'MG', 'Madagascar'],
    ['05A000', '05A3FF', 'MV', 'Maldives'],
    ['060000', '0603FF', 'MU', 'Mauritius'],
    ['064000', '064FFF', 'NG', 'Nigeria'],
    ['068000', '068FFF', 'UG', 'Uganda'],
    ['06A000', '06A3FF', 'QA', 'Qatar'],
    ['070000', '070FFF', 'SN', 'Senegal'],
    ['07C000', '07CFFF', 'SD', 'Sudan'],
    ['080000', '080FFF', 'TZ', 'Tanzania'],
    ['08A000', '08AFFF', 'ZM', 'Zambia'],
    ['090000', '090FFF', 'AO', 'Angola'],
    ['0A0000', '0A7FFF', 'DZ', 'Algeria'],
    ['0A8000', '0A8FFF', 'BS', 'Bahamas'],
    ['0AC000', '0ACFFF', 'CO', 'Colombia'],
    ['0AE000', '0AEFFF', 'CR', 'Costa Rica'],
    ['0B0000', '0B0FFF', 'CU', 'Cuba'],
    ['0D0000', '0D7FFF', 'MX', 'Mexico'],
    ['0D8000', '0DFFFF', 'VE', 'Venezuela'],
    ['100000', '1FFFFF', 'RU', 'Russia'],
    ['201000', '2013FF', 'NA', 'Namibia'],
    ['300000', '33FFFF', 'IT', 'Italy'],
    ['340000', '37FFFF', 'ES', 'Spain'],
    ['380000', '3BFFFF', 'FR', 'France'],
    ['3C0000', '3FFFFF', 'DE', 'Germany'],
    ['400000', '43FFFF', 'GB', 'United Kingdom'],
    ['440000', '447FFF', 'AT', 'Austria'],
    ['448000', '44FFFF', 'BE', 'Belgium'],
    ['450000', '457FFF', 'BG', 'Bulgaria'],
    ['458000', '45FFFF', 'DK', 'Denmark'],
    ['460000', '467FFF', 'FI', 'Finland'],
    ['468000', '46FFFF', 'GR', 'Greece'],
    ['470000', '477FFF', 'HU', 'Hungary'],
    ['478000', '47FFFF', 'NO', 'Norway'],
    ['480000', '487FFF', 'NL', 'Netherlands'],
    ['488000', '48FFFF', 'PL', 'Poland'],
    ['490000', '497FFF', 'PT', 'Portugal'],
    ['498000', '49FFFF', 'CZ', 'Czechia'],
    ['4A0000', '4A7FFF', 'RO', 'Romania'],
    ['4A8000', '4AFFFF', 'SE', 'Sweden'],
    ['4B0000', '4B7FFF', 'CH', 'Switzerland'],
    ['4B8000', '4BFFFF', 'TR', 'Türkiye'],
    ['4C0000', '4C7FFF', 'RS', 'Serbia'],
    ['4C8000', '4C83FF', 'CY', 'Cyprus'],
    ['4CA000', '4CAFFF', 'IE', 'Ireland'],
    ['4CC000', '4CCFFF', 'IS', 'Iceland'],
    ['4D0000', '4D03FF', 'LU', 'Luxembourg'],
    ['4D2000', '4D23FF', 'MT', 'Malta'],
    ['501C00', '501FFF', 'HR', 'Croatia'],
    ['502C00', '502FFF', 'LV', 'Latvia'],
    ['503C00', '503FFF', 'LT', 'Lithuania'],
    ['505C00', '505FFF', 'SK', 'Slovakia'],
    ['506C00', '506FFF', 'SI', 'Slovenia'],
    ['507C00', '507FFF', 'UZ', 'Uzbekistan'],
    ['508000', '50FFFF', 'UA', 'Ukraine'],
    ['510000', '5103FF', 'BY', 'Belarus'],
    ['511000', '5113FF', 'EE', 'Estonia'],
    ['514000', '5143FF', 'GE', 'Georgia'],
    ['600000', '6003FF', 'AM', 'Armenia'],
    ['600800', '600BFF', 'AZ', 'Azerbaijan'],
    ['682000', '6823FF', 'MN', 'Mongolia'],
    ['683000', '6833FF', 'KZ', 'Kazakhstan'],
    ['700000', '700FFF', 'AF', 'Afghanistan'],
    ['702000', '702FFF', 'BD', 'Bangladesh'],
    ['704000', '704FFF', 'MM', 'Myanmar'],
    ['706000', '706FFF', 'KW', 'Kuwait'],
    ['708000', '708FFF', 'LA', 'Laos'],
    ['70A000', '70AFFF', 'NP', 'Nepal'],
    ['70C000', '70C3FF', 'OM', 'Oman'],
    ['70E000', '70EFFF', 'KH', 'Cambodia'],
    ['710000', '717FFF', 'SA', 'Saudi Arabia'],
    ['718000', '71FFFF', 'KR', 'South Korea'],
    ['720000', '727FFF', 'KP', 'North Korea'],
    ['728000', '72FFFF', 'IQ', 'Iraq'],
    ['730000', '737FFF', 'IR', 'Iran'],
    ['738000', '73FFFF', 'IL', 'Israel'],
    ['740000', '747FFF', 'JO', 'Jordan'],
    ['748000', '74FFFF', 'LB', 'Lebanon'],
    ['750000', '757FFF', 'MY', 'Malaysia'],
    ['758000', '75FFFF', 'PH', 'Philippines'],
    ['760000', '767FFF', 'PK', 'Pakistan'],
    ['768000', '76FFFF', 'SG', 'Singapore'],
    ['770000', '777FFF', 'LK', 'Sri Lanka'],
    ['778000', '77FFFF', 'SY', 'Syria'],
    ['780000', '7BFFFF', 'CN', 'China'],
    ['7C0000', '7FFFFF', 'AU', 'Australia'],
    ['800000', '83FFFF', 'IN', 'India'],
    ['840000', '87FFFF', 'JP', 'Japan'],
    ['880000', '887FFF', 'TH', 'Thailand'],
    ['888000', '88FFFF', 'VN', 'Vietnam'],
    ['890000', '890FFF', 'YE', 'Yemen'],
    ['894000', '894FFF', 'BH', 'Bahrain'],
    ['895000', '8953FF', 'BN', 'Brunei'],
    ['896000', '896FFF', 'AE', 'United Arab Emirates'],
    ['898000', '898FFF', 'PG', 'Papua New Guinea'],
    ['899000', '8993FF', 'TW', 'Taiwan'],
    ['8A0000', '8A7FFF', 'ID', 'Indonesia'],
    ['A00000', 'AFFFFF', 'US', 'United States'],
    ['C00000', 'C3FFFF', 'CA', 'Canada'],
    ['C80000', 'C87FFF', 'NZ', 'New Zealand'],
    ['C88000', 'C88FFF', 'FJ', 'Fiji'],
    ['E00000', 'E3FFFF', 'AR', 'Argentina'],
    ['E40000', 'E7FFFF', 'BR', 'Brazil'],
    ['E80000', 'E80FFF', 'CL', 'Chile'],
    ['E84000', 'E84FFF', 'EC', 'Ecuador'],
    ['E88000', 'E88FFF', 'PY', 'Paraguay'],
    ['E8C000', 'E8CFFF', 'PE', 'Peru'],
    ['E90000', 'E90FFF', 'UY', 'Uruguay'],
    ['E94000', 'E94FFF', 'BO', 'Bolivia'],
  ] as const
).map(([s, e, iso, name]) => [parseInt(s, 16), parseInt(e, 16), iso, name]);

export interface RegistryCountry {
  iso: string;
  name: string;
}

export function countryFromIcao(hex: string | undefined): RegistryCountry | undefined {
  if (!hex || hex.startsWith('~')) return undefined;
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return undefined;
  // Blocks are sorted; binary search.
  let lo = 0;
  let hi = BLOCKS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = BLOCKS[mid]!;
    if (n < b[0]) hi = mid - 1;
    else if (n > b[1]) lo = mid + 1;
    else return { iso: b[2], name: b[3] };
  }
  return undefined;
}

export const REGISTRY_COUNTRIES: RegistryCountry[] = [...new Map(BLOCKS.map((b) => [b[2], { iso: b[2], name: b[3] }])).values()].sort(
  (a, b) => a.name.localeCompare(b.name),
);

/** Regional-indicator emoji are intentionally NOT used; UI shows ISO codes in a badge. */

/** The ICAO 24-bit address block allocated to a state, if listed. */
export function icaoBlock(iso: string): [number, number] | undefined {
  const b = BLOCKS.find((x) => x[2] === iso);
  return b ? [b[0], b[1]] : undefined;
}
