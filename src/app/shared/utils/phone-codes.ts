/**
 * Country catalogue used by `PhoneInputComponent`.
 *
 * Data only: the value shape and the formatting rules live in `phone-number.ts`.
 */

export interface PhoneCode {
  /** Country name, in English. */
  name: string;
  /** ISO 3166-1 alpha-2 code. Unique, unlike `phoneCode`. */
  iso2: string;
  /** International dial code, leading `+` included. */
  phoneCode: string;
  /** Flag emoji shown in the selector. */
  emoji: string;
  /** Digit grouping template. Every letter stands for one digit. */
  format: string;
  /** Sample number, used as the field placeholder. */
  example: string;
}

/** Country selected when none is given, or when the given one is unknown. */
export const DEFAULT_PHONE_ISO2 = 'US';

export const PHONE_CODES: readonly PhoneCode[] = [
  {
    name: 'United States',
    iso2: 'US',
    phoneCode: '+1',
    emoji: '🇺🇸',
    format: '+1 AAA NXX-XXXX',
    example: '+1 212 555-1234',
  },
  {
    name: 'Canada',
    iso2: 'CA',
    phoneCode: '+1',
    emoji: '🇨🇦',
    format: '+1 AAA NXX-XXXX',
    example: '+1 416 555-7890',
  },
  {
    name: 'United Kingdom',
    iso2: 'GB',
    phoneCode: '+44',
    emoji: '🇬🇧',
    format: '+44 AA NNNN NNNN',
    example: '+44 20 7946 0958',
  },
  {
    name: 'Argentina',
    iso2: 'AR',
    phoneCode: '+54',
    emoji: '🇦🇷',
    format: '+54 AA NNNN NNNN',
    example: '+54 11 1234 5678',
  },
  {
    name: 'Australia',
    iso2: 'AU',
    phoneCode: '+61',
    emoji: '🇦🇺',
    format: '+61 A NNNN NNNN',
    example: '+61 2 9876 5432',
  },
  {
    name: 'Austria',
    iso2: 'AT',
    phoneCode: '+43',
    emoji: '🇦🇹',
    format: '+43 AA NNNN NNNN',
    example: '+43 1 234 5678',
  },
  {
    name: 'Belgium',
    iso2: 'BE',
    phoneCode: '+32',
    emoji: '🇧🇪',
    format: '+32 AA NNN NN NN',
    example: '+32 2 123 4567',
  },
  {
    name: 'Brazil',
    iso2: 'BR',
    phoneCode: '+55',
    emoji: '🇧🇷',
    format: '+55 AA NNNN NNNN',
    example: '+55 11 91234 5678',
  },
  {
    name: 'Chile',
    iso2: 'CL',
    phoneCode: '+56',
    emoji: '🇨🇱',
    format: '+56 NNN NNN NNN',
    example: '+56 9 1234 5678',
  },
  {
    name: 'China',
    iso2: 'CN',
    phoneCode: '+86',
    emoji: '🇨🇳',
    format: '+86 AAA NNNN NNNN',
    example: '+86 10 1234 5678',
  },
  {
    name: 'Colombia',
    iso2: 'CO',
    phoneCode: '+57',
    emoji: '🇨🇴',
    format: '+57 AA NNN NNNN',
    example: '+57 1 234 5678',
  },
  {
    name: 'Czech Republic',
    iso2: 'CZ',
    phoneCode: '+420',
    emoji: '🇨🇿',
    format: '+420 NNN NNN NNN',
    example: '+420 602 123 456',
  },
  {
    name: 'Denmark',
    iso2: 'DK',
    phoneCode: '+45',
    emoji: '🇩🇰',
    format: '+45 NN NN NN NN',
    example: '+45 12 34 56 78',
  },
  {
    name: 'Finland',
    iso2: 'FI',
    phoneCode: '+358',
    emoji: '🇫🇮',
    format: '+358 AA NNNN NNNN',
    example: '+358 9 123 4567',
  },
  {
    name: 'France',
    iso2: 'FR',
    phoneCode: '+33',
    emoji: '🇫🇷',
    format: '+33 A NN NN NN NN',
    example: '+33 1 23 45 67 89',
  },
  {
    name: 'Germany',
    iso2: 'DE',
    phoneCode: '+49',
    emoji: '🇩🇪',
    format: '+49 AAA NNNNNNNN',
    example: '+49 30 12345678',
  },
  {
    name: 'Greece',
    iso2: 'GR',
    phoneCode: '+30',
    emoji: '🇬🇷',
    format: '+30 AA NNN NNNN',
    example: '+30 21 123 4567',
  },
  {
    name: 'India',
    iso2: 'IN',
    phoneCode: '+91',
    emoji: '🇮🇳',
    format: '+91 AAAAA NNNNN',
    example: '+91 98765 43210',
  },
  {
    name: 'Ireland',
    iso2: 'IE',
    phoneCode: '+353',
    emoji: '🇮🇪',
    format: '+353 AA NNN NNNN',
    example: '+353 1 234 5678',
  },
  {
    name: 'Israel',
    iso2: 'IL',
    phoneCode: '+972',
    emoji: '🇮🇱',
    format: '+972 AA NNN NNNN',
    example: '+972 50 123 4567',
  },
  {
    name: 'Italy',
    iso2: 'IT',
    phoneCode: '+39',
    emoji: '🇮🇹',
    format: '+39 AA NNNN NNNN',
    example: '+39 06 1234 5678',
  },
  {
    name: 'Japan',
    iso2: 'JP',
    phoneCode: '+81',
    emoji: '🇯🇵',
    format: '+81 AA NNNN NNNN',
    example: '+81 3 1234 5678',
  },
  {
    name: 'Mexico',
    iso2: 'MX',
    phoneCode: '+52',
    emoji: '🇲🇽',
    format: '+52 AA NNNN NNNN',
    example: '+52 55 1234 5678',
  },
  {
    name: 'Netherlands',
    iso2: 'NL',
    phoneCode: '+31',
    emoji: '🇳🇱',
    format: '+31 AA NNN NNNN',
    example: '+31 20 123 4567',
  },
  {
    name: 'New Zealand',
    iso2: 'NZ',
    phoneCode: '+64',
    emoji: '🇳🇿',
    format: '+64 A NNN NNNN',
    example: '+64 9 123 4567',
  },
  {
    name: 'Norway',
    iso2: 'NO',
    phoneCode: '+47',
    emoji: '🇳🇴',
    format: '+47 NNN NN NNN',
    example: '+47 123 45 678',
  },
  {
    name: 'Peru',
    iso2: 'PE',
    phoneCode: '+51',
    emoji: '🇵🇪',
    format: '+51 AA NNN NNNN',
    example: '+51 1 234 5678',
  },
  {
    name: 'Poland',
    iso2: 'PL',
    phoneCode: '+48',
    emoji: '🇵🇱',
    format: '+48 AA NNN NN NN',
    example: '+48 22 123 4567',
  },
  {
    name: 'Portugal',
    iso2: 'PT',
    phoneCode: '+351',
    emoji: '🇵🇹',
    format: '+351 AA NNN NNNN',
    example: '+351 21 123 4567',
  },
  {
    name: 'Russia',
    iso2: 'RU',
    phoneCode: '+7',
    emoji: '🇷🇺',
    format: '+7 AAA NNN NN NN',
    example: '+7 495 123 4567',
  },
  {
    name: 'South Africa',
    iso2: 'ZA',
    phoneCode: '+27',
    emoji: '🇿🇦',
    format: '+27 AA NNN NNNN',
    example: '+27 21 123 4567',
  },
  {
    name: 'South Korea',
    iso2: 'KR',
    phoneCode: '+82',
    emoji: '🇰🇷',
    format: '+82 AA NNNN NNNN',
    example: '+82 2 1234 5678',
  },
  {
    name: 'Spain',
    iso2: 'ES',
    phoneCode: '+34',
    emoji: '🇪🇸',
    format: '+34 NNN NNN NNN',
    example: '+34 612 345 678',
  },
  {
    name: 'Sweden',
    iso2: 'SE',
    phoneCode: '+46',
    emoji: '🇸🇪',
    format: '+46 AA NNN NN NN',
    example: '+46 8 123 4567',
  },
  {
    name: 'Switzerland',
    iso2: 'CH',
    phoneCode: '+41',
    emoji: '🇨🇭',
    format: '+41 AA NNN NN NN',
    example: '+41 21 123 4567',
  },
  {
    name: 'Turkey',
    iso2: 'TR',
    phoneCode: '+90',
    emoji: '🇹🇷',
    format: '+90 AAA NNN NN NN',
    example: '+90 212 123 4567',
  },
  {
    name: 'Ukraine',
    iso2: 'UA',
    phoneCode: '+380',
    emoji: '🇺🇦',
    format: '+380 AA NNN NN NN',
    example: '+380 44 123 4567',
  },
  {
    name: 'Uruguay',
    iso2: 'UY',
    phoneCode: '+598',
    emoji: '🇺🇾',
    format: '+598 NNNN NNNN',
    example: '+598 1234 5678',
  },
  {
    name: 'Venezuela',
    iso2: 'VE',
    phoneCode: '+58',
    emoji: '🇻🇪',
    format: '+58 AAA NNN NNNN',
    example: '+58 212 123 4567',
  },
];

const BY_ISO2 = new Map(PHONE_CODES.map((country) => [country.iso2, country]));

/** Search index built once: normalized name plus the dial code without its `+`. */
const SEARCH_INDEX = new Map(
  PHONE_CODES.map((country) => [
    country.iso2,
    {
      name: normalize(country.name),
      iso2: normalize(country.iso2),
      digits: country.phoneCode.replace(/\D/g, ''),
    },
  ]),
);

/**
 * Looks a country up by its ISO 3166-1 alpha-2 code.
 *
 * @param iso2 - Country code, case-insensitive.
 */
export function findPhoneCode(iso2: string): PhoneCode | undefined {
  return BY_ISO2.get(iso2.toUpperCase());
}

/**
 * Same as `findPhoneCode`, but always returns a country so callers can render
 * without null checks.
 *
 * @param iso2 - Country code, case-insensitive. Unknown codes fall back to
 *   `DEFAULT_PHONE_ISO2`.
 */
export function resolvePhoneCode(iso2: string): PhoneCode {
  return findPhoneCode(iso2) ?? BY_ISO2.get(DEFAULT_PHONE_ISO2) ?? PHONE_CODES[0];
}

/**
 * Filters the catalogue by country name, ISO code or dial code.
 *
 * `"ar"` matches Argentina (name) and AR (ISO code), `"+54"` and `"54"` match by
 * dial code. Accents are ignored, so `"peru"` matches `"Perú"` too.
 *
 * @param query - Free text typed by the user. Empty returns the whole catalogue.
 */
export function searchPhoneCodes(query: string): readonly PhoneCode[] {
  const term = normalize(query);
  if (!term) {
    return PHONE_CODES;
  }

  const digits = term.replace(/\D/g, '');

  return PHONE_CODES.filter((country) => {
    const index = SEARCH_INDEX.get(country.iso2)!;

    return (
      index.name.includes(term) ||
      index.iso2.startsWith(term) ||
      (digits.length > 0 && index.digits.startsWith(digits))
    );
  });
}

/** Lowercases and strips accents so `"Perú"` and `"peru"` compare equal. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
