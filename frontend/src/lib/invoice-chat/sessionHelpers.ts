import { SessionInvoice } from "@/components/invoice/InvoicePanel";

export const SESSION_LIMIT = 30;
const RECENT_FULL_DETAIL = 10;

export function buildSessionContext(invoices: SessionInvoice[]): string {
  if (invoices.length === 0) return "No existing invoices in this session.";

  // Hard cap at 30 — slice from the end to keep most recent
  const capped = invoices.slice(-SESSION_LIMIT);

  // Split: older invoices get compact, recent 10 get full detail
  const older = capped.slice(0, -RECENT_FULL_DETAIL);
  const recent = capped.slice(-RECENT_FULL_DETAIL);

  const parts: string[] = [];

  // ── Compact summary for older invoices ──
  if (older.length > 0) {
    const compactLines = older
      .map((si) => {
        const inv = si.invoice;
        const symbol =
          inv.currency === "USD" ? "$" : inv.currency === "EUR" ? "€" : "₹";
        return `${si.invoiceNumber ?? "Draft"} | ${
          inv.clientName
        } | ${symbol}${inv.total.toLocaleString("en-IN")} | ${
          si.status ?? "draft"
        }`;
      })
      .join("\n");

    parts.push(
      `[OLDER INVOICES — compact summary, limited detail]\n${compactLines}\n[END OLDER INVOICES]`
    );
  }

  // ── Full detail for recent 10 invoices ──
  const recentBlocks = recent.map((si, index) => {
    const inv = si.invoice;
    const isMostRecent = index === recent.length - 1;
    const symbol =
      inv.currency === "USD" ? "$" : inv.currency === "EUR" ? "€" : "₹";

    const lineItemsStr =
      inv.lineItems
        ?.map(
          (item) =>
            `  - ${item.description} | Qty: ${item.quantity} ${
              item.unit
            } | Rate: ${symbol}${item.rate.toLocaleString(
              "en-IN"
            )} | Amount: ${symbol}${item.amount.toLocaleString("en-IN")}`
        )
        .join("\n") ?? "  - (no line items)";

    const hasDiscount =
      inv.discountType &&
      inv.discountType !== "none" &&
      (inv.discountValue ?? 0) > 0;

    const discountLine = hasDiscount
      ? `Discount: ${inv.discountType} ${inv.discountValue}${
          inv.discountType === "percent" ? "%" : ""
        }`
      : "";

    return [
      `Invoice Ref: ${si.invoiceNumber ?? "Draft"}${
        isMostRecent ? " [MOST RECENT]" : ""
      }`,
      `Client: ${inv.clientName}`,
      `Currency: ${inv.currency ?? "INR"}`,
      `Invoice Month: ${inv.invoiceMonth ?? ""}`,
      // ── isTaxInclusive flag ──
      // When true, the stated total already includes tax.
      // editorNode reads this to back-calculate instead of adding tax on top.
      inv.isTaxInclusive ? `Tax Inclusive: true` : "",
      inv.currency === "INR"
        ? `GST: ${inv.gstPercent}% ${inv.gstType ?? "CGST_SGST"}`
        : `Tax: ${inv.taxPercent ?? 0}% ${
            inv.taxLabel || (inv.currency === "EUR" ? "VAT" : "Tax")
          }`,
      `Payment Terms: ${inv.paymentTermsDays} days`,
      discountLine,
      `Subtotal: ${symbol}${inv.subtotal?.toLocaleString("en-IN")}`,
      `Total: ${symbol}${inv.total.toLocaleString("en-IN")}`,
      `Line Items:\n${lineItemsStr}`,
      inv.notes ? `Notes: ${inv.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  parts.push(recentBlocks.join("\n---\n"));
  return parts.join("\n---\n");
}

export function findMatchingInvoices(
  sessionInvoices: SessionInvoice[],
  ref: string
): SessionInvoice[] {
  if (!ref) return [];

  const refLower = ref.toLowerCase().trim();

  // 1. Exact invoice number match (e.g. "INV-2026-047")
  const byNumber = sessionInvoices.filter(
    (si) => si.invoiceNumber?.toLowerCase() === refLower
  );
  if (byNumber.length > 0) return byNumber;

  // 2. Invoice number contained in ref
  const byNumberInRef = sessionInvoices.filter(
    (si) =>
      si.invoiceNumber && refLower.includes(si.invoiceNumber.toLowerCase())
  );
  if (byNumberInRef.length > 0) return byNumberInRef;

  // 3. Exact client name match
  const byExactName = sessionInvoices.filter(
    (si) => si.invoice.clientName.toLowerCase() === refLower
  );
  if (byExactName.length > 0) return byExactName;

  // 4. Client name starts with ref (min 3 chars)
  const byNamePrefix = sessionInvoices.filter(
    (si) =>
      si.invoice.clientName.toLowerCase().startsWith(refLower) &&
      refLower.length >= 3
  );
  if (byNamePrefix.length > 0) return byNamePrefix;

  return [];
}
