import { SessionInvoice } from "@/components/invoice/InvoicePanel";

export function buildSessionContext(invoices: SessionInvoice[]): string {
  if (invoices.length === 0) return "No existing invoices in this session.";

  return invoices
    .map((si, index) => {
      const inv = si.invoice;
      const isMostRecent = index === invoices.length - 1;
      const symbol =
        inv.currency === "USD" ? "$" : inv.currency === "EUR" ? "€" : "₹"; // ← add

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

      return [
        `Invoice Ref: ${si.invoiceNumber ?? "Draft"}${
          isMostRecent ? " [MOST RECENT]" : ""
        }`,
        `Client: ${inv.clientName}`,
        `Invoice Month: ${inv.invoiceMonth ?? ""}`,
        inv.currency === "INR"
          ? `GST: ${inv.gstPercent}% ${inv.gstType ?? "CGST_SGST"}`
          : `Tax: ${inv.taxPercent ?? 0}% ${
              inv.taxLabel || (inv.currency === "EUR" ? "VAT" : "Tax")
            }`,
        `Payment Terms: ${inv.paymentTermsDays} days`,
        `Subtotal: ${symbol}${inv.subtotal?.toLocaleString("en-IN")}`,
        `Total: ${symbol}${inv.total.toLocaleString("en-IN")}`,
        `Line Items:\n${lineItemsStr}`,
        inv.notes ? `Notes: ${inv.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n---\n");
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

  // 2. Invoice number contained in ref (e.g. ref = "inv-2026-047" extracted from prompt)
  const byNumberInRef = sessionInvoices.filter(
    (si) =>
      si.invoiceNumber && refLower.includes(si.invoiceNumber.toLowerCase())
  );
  if (byNumberInRef.length > 0) return byNumberInRef;

  // 3. Exact client name match only — no substring to avoid false positives
  const byExactName = sessionInvoices.filter(
    (si) => si.invoice.clientName.toLowerCase() === refLower
  );
  if (byExactName.length > 0) return byExactName;

  // 4. Client name starts with ref (handles "Pri" → "Priya") — kept narrow
  const byNamePrefix = sessionInvoices.filter(
    (si) =>
      si.invoice.clientName.toLowerCase().startsWith(refLower) &&
      refLower.length >= 3
  );
  if (byNamePrefix.length > 0) return byNamePrefix;

  return [];
}
