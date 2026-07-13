// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: currency-data/currencies.source.json
// Regenerate with: node scripts/generate-currencies.mjs

export interface CurrencyInfo {
  code: string;
  name: string;
  /** Display label for the tax line on an invoice in this currency ("GST" for INR, "Tax" otherwise). */
  taxLabel: string;
  /** Whether Stripe Checkout can charge in this currency. Best-effort — used only to gate/hide checkout, never for correctness-critical math. */
  stripeSupported: boolean;
  /** Number of minor-unit decimal places (0, 2, or 3). */
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "AED", name: "United Arab Emirates Dirham", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AFN", name: "Afghan Afghani", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ALL", name: "Albanian Lek", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AMD", name: "Armenian Dram", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ANG", name: "Netherlands Antillean Guilder", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AOA", name: "Angolan Kwanza", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ARS", name: "Argentine Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AUD", name: "Australian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AWG", name: "Aruban Florin", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "AZN", name: "Azerbaijani Manat", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BBD", name: "Barbadian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BDT", name: "Bangladeshi Taka", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BGN", name: "Bulgarian Lev", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BHD", name: "Bahraini Dinar", taxLabel: "Tax", stripeSupported: true, decimals: 3 },
  { code: "BIF", name: "Burundian Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "BMD", name: "Bermudan Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BND", name: "Brunei Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BOB", name: "Bolivian Boliviano", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BRL", name: "Brazilian Real", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BSD", name: "Bahamian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BTN", name: "Bhutanese Ngultrum", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "BWP", name: "Botswanan Pula", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BYN", name: "Belarusian Ruble", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "BZD", name: "Belize Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CDF", name: "Congolese Franc", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CHF", name: "Swiss Franc", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CLP", name: "Chilean Peso", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "CNY", name: "Chinese Yuan", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "COP", name: "Colombian Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CRC", name: "Costa Rican Colón", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CUP", name: "Cuban Peso", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "CVE", name: "Cape Verdean Escudo", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "CZK", name: "Czech Koruna", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "DJF", name: "Djiboutian Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "DKK", name: "Danish Krone", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "DOP", name: "Dominican Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "DZD", name: "Algerian Dinar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "EGP", name: "Egyptian Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ERN", name: "Eritrean Nakfa", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "ETB", name: "Ethiopian Birr", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "EUR", name: "Euro", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "FJD", name: "Fijian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "FKP", name: "Falkland Islands Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GBP", name: "British Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GEL", name: "Georgian Lari", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GHS", name: "Ghanaian Cedi", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "GIP", name: "Gibraltar Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GMD", name: "Gambian Dalasi", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GNF", name: "Guinean Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "GTQ", name: "Guatemalan Quetzal", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "GYD", name: "Guyanaese Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "HNL", name: "Honduran Lempira", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "HTG", name: "Haitian Gourde", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "HUF", name: "Hungarian Forint", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "IDR", name: "Indonesian Rupiah", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ILS", name: "Israeli New Shekel", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "INR", name: "Indian Rupee", taxLabel: "GST", stripeSupported: true, decimals: 2 },
  { code: "IQD", name: "Iraqi Dinar", taxLabel: "Tax", stripeSupported: false, decimals: 3 },
  { code: "IRR", name: "Iranian Rial", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "ISK", name: "Icelandic Króna", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "JMD", name: "Jamaican Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "JOD", name: "Jordanian Dinar", taxLabel: "Tax", stripeSupported: true, decimals: 3 },
  { code: "JPY", name: "Japanese Yen", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "KES", name: "Kenyan Shilling", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "KGS", name: "Kyrgystani Som", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "KHR", name: "Cambodian Riel", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "KMF", name: "Comorian Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "KPW", name: "North Korean Won", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "KRW", name: "South Korean Won", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", taxLabel: "Tax", stripeSupported: true, decimals: 3 },
  { code: "KYD", name: "Cayman Islands Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "KZT", name: "Kazakhstani Tenge", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LAK", name: "Laotian Kip", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LBP", name: "Lebanese Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LKR", name: "Sri Lankan Rupee", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LRD", name: "Liberian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LSL", name: "Lesotho Loti", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "LYD", name: "Libyan Dinar", taxLabel: "Tax", stripeSupported: false, decimals: 3 },
  { code: "MAD", name: "Moroccan Dirham", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MDL", name: "Moldovan Leu", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MGA", name: "Malagasy Ariary", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "MKD", name: "Macedonian Denar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MMK", name: "Myanmar Kyat", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MNT", name: "Mongolian Tugrik", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MOP", name: "Macanese Pataca", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MRU", name: "Mauritanian Ouguiya", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MUR", name: "Mauritian Rupee", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MVR", name: "Maldivian Rufiyaa", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MWK", name: "Malawian Kwacha", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MXN", name: "Mexican Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MYR", name: "Malaysian Ringgit", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "MZN", name: "Mozambican Metical", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NAD", name: "Namibian Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NGN", name: "Nigerian Naira", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NIO", name: "Nicaraguan Córdoba", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NOK", name: "Norwegian Krone", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NPR", name: "Nepalese Rupee", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "OMR", name: "Omani Rial", taxLabel: "Tax", stripeSupported: true, decimals: 3 },
  { code: "PAB", name: "Panamanian Balboa", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PEN", name: "Peruvian Sol", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PGK", name: "Papua New Guinean Kina", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PHP", name: "Philippine Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PKR", name: "Pakistani Rupee", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PLN", name: "Polish Zloty", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "PYG", name: "Paraguayan Guarani", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "QAR", name: "Qatari Riyal", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "RON", name: "Romanian Leu", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "RSD", name: "Serbian Dinar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "RUB", name: "Russian Ruble", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "RWF", name: "Rwandan Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "SAR", name: "Saudi Riyal", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SBD", name: "Solomon Islands Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SCR", name: "Seychellois Rupee", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SDG", name: "Sudanese Pound", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "SEK", name: "Swedish Krona", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SGD", name: "Singapore Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SHP", name: "St. Helena Pound", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SLE", name: "Sierra Leonean Leone", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SLL", name: "Sierra Leonean Leone (1964—2022)", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "SOS", name: "Somali Shilling", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SRD", name: "Surinamese Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SSP", name: "South Sudanese Pound", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "STN", name: "São Tomé & Príncipe Dobra", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "SVC", name: "Salvadoran Colón", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "SYP", name: "Syrian Pound", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "SZL", name: "Swazi Lilangeni", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "THB", name: "Thai Baht", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TJS", name: "Tajikistani Somoni", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TMT", name: "Turkmenistani Manat", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "TND", name: "Tunisian Dinar", taxLabel: "Tax", stripeSupported: false, decimals: 3 },
  { code: "TOP", name: "Tongan Paʻanga", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TRY", name: "Turkish Lira", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TTD", name: "Trinidad & Tobago Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TWD", name: "New Taiwan Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "TZS", name: "Tanzanian Shilling", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "UAH", name: "Ukrainian Hryvnia", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "UGX", name: "Ugandan Shilling", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "USD", name: "US Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "UYU", name: "Uruguayan Peso", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "UZS", name: "Uzbekistani Som", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "VES", name: "Venezuelan Bolívar", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "VND", name: "Vietnamese Dong", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "VUV", name: "Vanuatu Vatu", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "WST", name: "Samoan Tala", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "XAF", name: "Central African CFA Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "XCD", name: "East Caribbean Dollar", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "XCG", name: "Caribbean guilder", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "XOF", name: "West African CFA Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "XPF", name: "CFP Franc", taxLabel: "Tax", stripeSupported: true, decimals: 0 },
  { code: "YER", name: "Yemeni Rial", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ZAR", name: "South African Rand", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ZMW", name: "Zambian Kwacha", taxLabel: "Tax", stripeSupported: true, decimals: 2 },
  { code: "ZWG", name: "Zimbabwean Gold", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
  { code: "ZWL", name: "Zimbabwean Dollar (2009–2024)", taxLabel: "Tax", stripeSupported: false, decimals: 2 },
];

export const CURRENCY_CODES: string[] = CURRENCIES.map((c) => c.code);

const CURRENCY_MAP: Record<string, CurrencyInfo> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c])
);

/** Safe fallback used for any code we don't recognize — guarantees callers never crash on an unexpected currency. */
const FALLBACK_CURRENCY_INFO: CurrencyInfo = {
  code: "USD",
  name: "US Dollar",
  taxLabel: "Tax",
  stripeSupported: true,
  decimals: 2,
};

export function isValidCurrencyCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return Object.prototype.hasOwnProperty.call(CURRENCY_MAP, code.toUpperCase());
}

/** Always returns a usable CurrencyInfo — falls back to USD-shaped defaults for unknown/malformed codes. */
export function getCurrencyInfo(code: string | null | undefined): CurrencyInfo {
  if (!code) return FALLBACK_CURRENCY_INFO;
  const info = CURRENCY_MAP[code.toUpperCase()];
  return info ?? { ...FALLBACK_CURRENCY_INFO, code: code.toUpperCase() };
}

/** Normalizes any input to a known currency code, defaulting to USD if unrecognized. Never throws. */
export function normalizeCurrencyCode(code: string | null | undefined): string {
  if (code && isValidCurrencyCode(code)) return code.toUpperCase();
  return "USD";
}

/** India is the only currency that uses GST-specific fields (CGST/SGST/IGST). Every other currency uses the generic tax fields. */
export function isIndianCurrency(code: string | null | undefined): boolean {
  return (code ?? "").toUpperCase() === "INR";
}

/** Extracts just the currency symbol/glyph (e.g. "$", "₹", "CA$") via Intl — no hand-maintained symbol table. Never throws. */
export function getCurrencySymbol(code: string | null | undefined): string {
  const normalized = normalizeCurrencyCode(code);
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).formatToParts(0);
    const symbolPart = parts.find((p) => p.type === "currency");
    return symbolPart?.value ?? normalized;
  } catch {
    return normalized;
  }
}

/**
 * Formats an amount as a currency string using Intl, defaulting to the currency's
 * natural minor-unit decimal places (0 for JPY, 2 for USD, 3 for KWD, ...).
 * Pass maximumFractionDigits/minimumFractionDigits to override. Never throws.
 */
export function formatCurrencyAmount(
  amount: number,
  code?: string | null,
  options?: { maximumFractionDigits?: number; minimumFractionDigits?: number }
): string {
  const normalized = normalizeCurrencyCode(code);
  const info = getCurrencyInfo(normalized);
  const maximumFractionDigits = options?.maximumFractionDigits ?? info.decimals;
  const minimumFractionDigits = Math.min(
    options?.minimumFractionDigits ?? 0,
    maximumFractionDigits
  );
  // Indian Rupee amounts use the lakh/crore (2-digit) grouping Indian users expect;
  // everything else uses standard 3-digit grouping.
  const locale = isIndianCurrency(normalized) ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalized,
      maximumFractionDigits,
      minimumFractionDigits,
    }).format(amount);
  } catch {
    const abs = Math.abs(amount).toLocaleString(locale, { maximumFractionDigits });
    return amount < 0
      ? `-${getCurrencySymbol(normalized)}${abs}`
      : `${getCurrencySymbol(normalized)}${abs}`;
  }
}
