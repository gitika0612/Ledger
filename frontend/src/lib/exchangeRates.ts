// Fetches USD-based exchange rates from the backend's consolidated rate service
// (GET /api/currencies/rates) instead of calling exchangerate-api.com directly.
// This keeps a single source of truth for rates shared with the backend agent
// nodes, and avoids duplicating the fetch/cache/fallback logic on the client.

import api from "@/lib/api/api";

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: RateCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fallback rates if the backend endpoint is unreachable.
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  INR: 84,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  SGD: 1.34,
  AED: 3.67,
};

interface CurrencyRatesResponse {
  base: string;
  rates: Record<string, number>;
}

async function fetchRates(): Promise<Record<string, number>> {
  try {
    const res = await api.get<CurrencyRatesResponse>("/currencies/rates");
    return res.data.rates ?? FALLBACK_RATES;
  } catch {
    console.warn("⚠️ Exchange rate fetch failed, using fallback");
    return FALLBACK_RATES;
  }
}

export async function getExchangeRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }
  const rates = await fetchRates();
  cache = { rates, fetchedAt: now };
  return rates;
}

// Convert any amount to USD. Returns null if no rate is known for `currency`
// (and it isn't USD itself) — callers must NOT fall back to adding the raw,
// unconverted amount, since that silently produces a wrong total whenever
// currencies differ.
export function convertToUSD(
  amount: number,
  currency: string,
  rates: Record<string, number>
): number | null {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (!rate) return null;
  return amount / rate; // divide by "units per USD" to get USD
}

// Convert an array of { _id: currency, total: amount } into a single USD total.
// Entries whose currency has no known rate are SKIPPED (not added raw) and
// flagged via `hasUnconverted` so callers can surface a "some amounts
// couldn't be converted" indicator instead of silently showing a wrong number.
export function sumInUSD(
  byCurrency: { _id: string; total: number }[],
  rates: Record<string, number>
): { total: number; hasUnconverted: boolean } {
  let hasUnconverted = false;
  const total = byCurrency.reduce((sum, item) => {
    const converted = convertToUSD(item.total, item._id, rates);
    if (converted === null) {
      hasUnconverted = true;
      return sum;
    }
    return sum + converted;
  }, 0);
  return { total, hasUnconverted };
}
