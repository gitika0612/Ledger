// Builds the "$1 USD = ₹94 | ..." context string fed into invoice-generation prompts,
// so the LLM can sanity-check cross-currency amounts. Sourced from the single
// consolidated USD-based exchange rate service — never fetches or caches rates itself.

import {
  getUsdExchangeRates,
  FALLBACK_USD_RATES,
} from "../../lib/exchangeRateService";

export async function buildCurrencyContext(): Promise<string> {
  const rates = await getUsdExchangeRates();
  const inrPerUsd = rates.INR ?? FALLBACK_USD_RATES.INR;

  // Converts "units of `code` per 1 USD" into "₹ per 1 unit of `code`".
  const toInr = (code: string): number => {
    const unitsPerUsd = rates[code] ?? FALLBACK_USD_RATES[code];
    if (!unitsPerUsd) return 0;
    return Math.round(inrPerUsd / unitsPerUsd);
  };

  return `$1 USD = ₹${toInr("USD")} | £1 GBP = ₹${toInr("GBP")} | €1 EUR = ₹${toInr(
    "EUR"
  )} | 1 AED = ₹${toInr("AED")} | 1 SGD = ₹${toInr("SGD")}`;
}
