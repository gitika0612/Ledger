interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: RateCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fallback rates if API fails
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  INR: 84,
  EUR: 0.92,
};

async function fetchRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // data.rates = { INR: 84, EUR: 0.92, ... } — how many units per 1 USD
    return { USD: 1, ...data.rates };
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

// Convert any amount to USD
export function convertToUSD(
  amount: number,
  currency: string,
  rates: Record<string, number>
): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate; // divide by "units per USD" to get USD
}

// Convert array of { _id: currency, total: amount } to total USD
export function sumInUSD(
  byCurrency: { _id: string; total: number }[],
  rates: Record<string, number>
): number {
  return byCurrency.reduce((sum, item) => {
    return sum + convertToUSD(item.total, item._id, rates);
  }, 0);
}
