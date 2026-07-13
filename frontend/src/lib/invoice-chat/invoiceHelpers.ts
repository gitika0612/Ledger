import { ParsedInvoice } from "@/components/invoice/InvoicePreviewCard";
import { isIndianCurrency, getCurrencyInfo } from "@/lib/currencies";

export function recalculateTotals(invoice: ParsedInvoice): ParsedInvoice {
  const currency = invoice.currency ?? "INR";

  // ── Tax-inclusive path ──
  // Total is fixed. Subtotal + tax split are derived from it.
  // Don't recompute total — just ensure splits are consistent.
  if (invoice.isTaxInclusive) {
    const statedTotal = invoice.total;
    const subtotal = invoice.lineItems.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    if (isIndianCurrency(currency)) {
      const gstPercent = invoice.gstPercent ?? 0;
      const gstAmount = gstPercent > 0 ? statedTotal - subtotal : 0;
      const gstType = invoice.gstType || "CGST_SGST";
      const cgstAmount =
        gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0;
      const sgstAmount = gstType === "CGST_SGST" ? gstAmount - cgstAmount : 0;
      const igstAmount = gstType === "IGST" ? gstAmount : 0;

      return {
        ...invoice,
        subtotal,
        taxableAmount: subtotal,
        discountAmount: 0,
        gstAmount,
        cgstAmount,
        sgstAmount,
        igstAmount,
        taxPercent: 0,
        taxAmount: 0,
        taxLabel: "",
        total: statedTotal, // never change total
      };
    } else {
      const taxPercent = invoice.taxPercent ?? 0;
      const taxAmount = taxPercent > 0 ? statedTotal - subtotal : 0;
      const taxLabel = invoice.taxLabel || getCurrencyInfo(currency).taxLabel;

      return {
        ...invoice,
        subtotal,
        taxableAmount: subtotal,
        discountAmount: 0,
        taxPercent,
        taxAmount,
        taxLabel,
        gstPercent: 0,
        gstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        total: statedTotal, // never change total
      };
    }
  }

  // ── Standard add-on path (isTaxInclusive=false) ──
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
      ? discountValue
      : 0;

  const taxableAmount = subtotal - discountAmount;

  if (isIndianCurrency(currency)) {
    const gstAmount = Math.round(
      (taxableAmount * (invoice.gstPercent ?? 0)) / 100
    );
    const gstType = invoice.gstType || "CGST_SGST";
    const cgstAmount = gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0;
    const sgstAmount = gstType === "CGST_SGST" ? gstAmount - cgstAmount : 0;
    const igstAmount = gstType === "IGST" ? gstAmount : 0;

    return {
      ...invoice,
      subtotal,
      discountAmount,
      taxableAmount,
      gstAmount,
      gstType,
      cgstPercent: gstType === "CGST_SGST" ? (invoice.gstPercent ?? 0) / 2 : 0,
      sgstPercent: gstType === "CGST_SGST" ? (invoice.gstPercent ?? 0) / 2 : 0,
      igstPercent: gstType === "IGST" ? invoice.gstPercent ?? 0 : 0,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      total: taxableAmount + gstAmount,
    };
  } else {
    const taxPercent = invoice.taxPercent ?? 0;
    const taxAmount = Math.round((taxableAmount * taxPercent) / 100);
    const taxLabel = invoice.taxLabel || getCurrencyInfo(currency).taxLabel;

    return {
      ...invoice,
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
