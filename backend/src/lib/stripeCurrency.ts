import { toStripeUnit } from "zero-decimal-currencies";
import { getCurrencyInfo, normalizeCurrencyCode } from "./currencies";

/** Lowercase ISO code Stripe's API expects, e.g. "usd". Always returns a valid code (falls back to "usd"). */
export function toStripeCurrency(currency?: string): string {
  return normalizeCurrencyCode(currency).toLowerCase();
}

/**
 * Converts a decimal amount (e.g. 19.99) into the integer "smallest unit" Stripe expects,
 * correctly handling zero-decimal (JPY) and three-decimal (KWD, BHD, ...) currencies.
 * Never throws — falls back to standard 2-decimal (×100) rounding for anything unrecognized.
 */
export function toStripeUnitAmount(amount: number, currency?: string): number {
  const code = normalizeCurrencyCode(currency);
  try {
    const unit = Number(toStripeUnit(amount, code));
    if (!Number.isFinite(unit)) throw new Error(`non-numeric result: ${unit}`);
    return unit;
  } catch (err) {
    console.warn(`⚠️ toStripeUnit failed for ${code}, falling back to ×100:`, err);
    return Math.round(amount * 100);
  }
}

/** Whether Stripe Checkout can charge in this currency (best-effort — used only to gate checkout). */
export function isStripeSupportedCurrency(currency?: string): boolean {
  return getCurrencyInfo(currency).stripeSupported;
}

// ─────────────────────────────────────────────────────────────────────────
// Stripe's GLOBAL currency list (above) is broader than what any single
// Stripe account is actually configured to settle. Charging a currency
// outside your account's settlement list fails at checkout-session-creation
// time with a Stripe "Invalid currency" 400, even though the currency passes
// isStripeSupportedCurrency(). ACCOUNT_SUPPORTED_CURRENCIES is the narrower,
// account-specific list — keep it in sync with whatever your Stripe Dashboard
// actually settles (Dashboard → Settings → Business settings, or simply
// whichever currencies you've confirmed work end-to-end).
//
// Override via the ACCOUNT_SUPPORTED_CURRENCIES env var (comma-separated ISO
// codes, e.g. "USD,EUR,GBP,INR,JPY,AED"). Falls back to the default list below
// if unset. Only list currencies you've actually confirmed settle correctly —
// this list is intentionally conservative, not Stripe's full global list.
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_ACCOUNT_SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY"];

const ACCOUNT_SUPPORTED_CURRENCIES: Set<string> = new Set(
  (process.env.ACCOUNT_SUPPORTED_CURRENCIES
    ? process.env.ACCOUNT_SUPPORTED_CURRENCIES.split(",")
    : DEFAULT_ACCOUNT_SUPPORTED_CURRENCIES
  )
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
);

/** Whether THIS Stripe account is configured to settle this currency (narrower
 * than Stripe's global list — see ACCOUNT_SUPPORTED_CURRENCIES above). */
export function isAccountSupportedCurrency(currency?: string): boolean {
  return ACCOUNT_SUPPORTED_CURRENCIES.has(normalizeCurrencyCode(currency));
}

/**
 * Single source of truth for "can this invoice be paid online right now?".
 * Combines Stripe's global currency list with this account's actual
 * settlement list. Use this everywhere online-payment eligibility is
 * decided (the public invoice endpoint and the checkout-session controller)
 * so the two never drift apart.
 */
export function isOnlinePaymentSupported(currency?: string): boolean {
  return (
    isStripeSupportedCurrency(currency) && isAccountSupportedCurrency(currency)
  );
}
