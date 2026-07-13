import { Request, Response } from "express";
import { getUsdExchangeRates } from "../lib/exchangeRateService";
import { CURRENCIES } from "../lib/currencies";

/**
 * GET /api/currencies/rates
 * Returns USD-based exchange rates (units of currency per 1 USD) for every
 * supported currency, plus the static currency metadata list. Used by the
 * frontend dashboard to convert mixed-currency invoice totals into a single
 * USD figure for summary stats. Never throws — getUsdExchangeRates() always
 * resolves, falling back to a hardcoded rate table on any fetch failure.
 */
export async function getCurrencyRates(
  _req: Request,
  res: Response
): Promise<void> {
  const rates = await getUsdExchangeRates();
  res.json({
    base: "USD",
    rates,
    currencies: CURRENCIES,
  });
}
