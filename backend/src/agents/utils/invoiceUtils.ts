import { ParsedInvoice } from "../schemas/invoiceSchema";

/**
 * Recalculates all totals from line items.
 * INR → uses gstPercent/gstAmount/cgst/sgst/igst fields
 * USD/EUR → uses taxPercent/taxAmount/taxLabel fields
 */
export function recalculateTotals(invoice: ParsedInvoice): ParsedInvoice {
  const subtotal = invoice.lineItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const discountType = invoice.discountType || "none";
  const discountValue = invoice.discountValue || 0;

  const discountAmount =
    discountType === "percent"
      ? Math.round((subtotal * discountValue) / 100)
      : discountType === "amount"
      ? Math.min(discountValue, subtotal)
      : 0;

  const taxableAmount = subtotal - discountAmount;
  const currency = invoice.currency ?? "INR";

  if (currency === "INR") {
    // ── INR path: GST calculation ──
    const gstPercent = invoice.gstPercent ?? 0;
    const gstAmount = Math.round((taxableAmount * gstPercent) / 100);
    const gstType = invoice.gstType || "CGST_SGST";
    const cgstAmount = gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0;
    const sgstAmount = gstType === "CGST_SGST" ? gstAmount - cgstAmount : 0;
    const igstAmount = gstType === "IGST" ? gstAmount : 0;

    return {
      ...invoice,
      currency,
      subtotal,
      discountAmount,
      taxableAmount,
      gstAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      total: taxableAmount + gstAmount,
    };
  } else {
    // ── USD/EUR path: generic Tax/VAT calculation ──
    const taxPercent = invoice.taxPercent ?? 0;
    const taxAmount = Math.round((taxableAmount * taxPercent) / 100);
    const taxLabel = invoice.taxLabel || (currency === "EUR" ? "VAT" : "Tax");

    return {
      ...invoice,
      currency,
      subtotal,
      discountAmount,
      taxableAmount,
      taxPercent,
      taxAmount,
      taxLabel,
      gstPercent: 0,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      total: taxableAmount + taxAmount,
    };
  }
}

/**
 * Diff two line item arrays and return human-readable summary + change flag.
 */
export function diffLineItems(
  oldItems: Array<{ description: string; quantity: number; rate: number }>,
  newItems: Array<{ description: string; quantity: number; rate: number }>
): { summary: string; hasRealChange: boolean } {
  const key = (d: string) => d.toLowerCase().trim();
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const newItem of newItems) {
    const oldMatch = oldItems.find(
      (o) => key(o.description) === key(newItem.description)
    );
    if (!oldMatch) {
      added.push(newItem.description);
    } else if (
      oldMatch.quantity !== newItem.quantity ||
      Math.abs(oldMatch.rate - newItem.rate) > 0.01
    ) {
      modified.push(
        `**${newItem.description}** (${newItem.rate.toLocaleString(
          "en-IN"
        )} × ${newItem.quantity})`
      );
    }
  }

  for (const oldItem of oldItems) {
    const stillExists = newItems.some(
      (n) => key(n.description) === key(oldItem.description)
    );
    if (!stillExists) removed.push(oldItem.description);
  }

  const parts: string[] = [];
  if (removed.length === 1 && added.length === 1) {
    parts.push(`Replaced **${removed[0]}** with **${added[0]}**`);
  } else {
    if (added.length > 0)
      parts.push(`Added ${added.map((d) => `**${d}**`).join(", ")}`);
    if (removed.length > 0)
      parts.push(`Removed ${removed.map((d) => `**${d}**`).join(", ")}`);
  }
  if (modified.length > 0) parts.push(`Updated ${modified.join(", ")}`);

  return {
    summary: parts.join(" · "),
    hasRealChange:
      added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}

export function formatCurrency(
  amount: number,
  currency: "INR" | "USD" | "EUR" = "INR"
): string {
  const abs = Math.abs(amount).toLocaleString("en-IN");
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
  return amount < 0 ? `−${symbol}${abs}` : `${symbol}${abs}`;
}
