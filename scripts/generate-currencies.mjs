#!/usr/bin/env node
// Generates backend/src/lib/currencies.ts and frontend/src/lib/currencies.ts
// from the single canonical source: currency-data/currencies.source.json
//
// Decimal-place data (zero/three-decimal currency lists) comes from the
// `zero-decimal-currencies` package (backend devDependency used only at
// generation time) so both generated files stay correct without needing
// that package as a runtime dependency anywhere.
//
// Run: node scripts/generate-currencies.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// zero-decimal-currencies is only installed under backend/node_modules — resolve it from there explicitly
// so this script can be run from the repo root regardless of Node's ESM lookup path.
const backendRequire = createRequire(path.join(ROOT, "backend", "package.json"));
const { ZERO_DECIMAL_CURRENCIES, THREE_DECIMAL_CURRENCIES } = backendRequire("zero-decimal-currencies");

const sourcePath = path.join(ROOT, "currency-data", "currencies.source.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));

const ZERO_SET = new Set(ZERO_DECIMAL_CURRENCIES);
const THREE_SET = new Set(THREE_DECIMAL_CURRENCIES);

function decimalsFor(code) {
  if (ZERO_SET.has(code)) return 0;
  if (THREE_SET.has(code)) return 3;
  return 2;
}

const enriched = source
  .map((c) => ({ ...c, decimals: decimalsFor(c.code) }))
  .sort((a, b) => a.code.localeCompare(b.code));

const HEADER = `// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: currency-data/currencies.source.json
// Regenerate with: node scripts/generate-currencies.mjs
`;

function buildFileContent() {
  const entriesLiteral = enriched
    .map(
      (c) =>
        `  { code: ${JSON.stringify(c.code)}, name: ${JSON.stringify(
          c.name
        )}, taxLabel: ${JSON.stringify(c.taxLabel)}, stripeSupported: ${
          c.stripeSupported
        }, decimals: ${c.decimals} },`
    )
    .join("\n");

  return `${HEADER}
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
${entriesLiteral}
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
      ? \`-\${getCurrencySymbol(normalized)}\${abs}\`
      : \`\${getCurrencySymbol(normalized)}\${abs}\`;
  }
}
`;
}

const content = buildFileContent();

const backendOut = path.join(ROOT, "backend", "src", "lib", "currencies.ts");
const frontendOut = path.join(ROOT, "frontend", "src", "lib", "currencies.ts");

writeFileSync(backendOut, content);
writeFileSync(frontendOut, content);

console.log(`Generated ${enriched.length} currencies →`);
console.log(`  ${path.relative(ROOT, backendOut)}`);
console.log(`  ${path.relative(ROOT, frontendOut)}`);
