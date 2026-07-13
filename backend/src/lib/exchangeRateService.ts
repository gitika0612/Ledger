// Single consolidated USD-based exchange rate source, shared by:
//   - backend agent nodes that need a currency-conversion prompt context (via currencyService.ts)
//   - the authenticated GET /api/currencies/rates endpoint, consumed by the frontend dashboard
//
// Rates are expressed as "units of currency per 1 USD" (e.g. { USD: 1, INR: 84, EUR: 0.92, ... }),
// matching how exchangerate-api.com's /latest/USD endpoint reports them.
// Uses exchangerate-api.com free tier — no API key needed. 1-hour in-memory cache.
// Never throws — always falls back to a small hardcoded rate table on any fetch failure.

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
}

let cache: RateCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Best-effort fallback rates (units per 1 USD) if the live API is unreachable. Covers the currencies InvoiceOS users most commonly bill in. */
export const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  INR: 84,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  SGD: 1.34,
  AED: 3.67,
  JPY: 150,
  CNY: 7.2,
};

async function fetchLiveUsdRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ExchangeRateApiResponse;
    return { USD: 1, ...data.rates };
  } catch (err) {
    console.warn("⚠️ Exchange rate fetch failed, using fallback rates:", err);
    return FALLBACK_USD_RATES;
  }
}

/** Returns USD-based rates (units of currency per 1 USD), cached for 1 hour. Never throws. */
export async function getUsdExchangeRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }
  const rates = await fetchLiveUsdRates();
  cache = { rates, fetchedAt: now };
  return rates;
}
