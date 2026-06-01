export type Currency = "INR" | "USD" | "EUR";

export function formatCurrency(
  amount: number,
  currency: Currency = "INR"
): string {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  }
  if (currency === "EUR") {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(amount);
  }
  // Default INR
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getCurrencySymbol(currency: Currency = "INR"): string {
  return currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
}
