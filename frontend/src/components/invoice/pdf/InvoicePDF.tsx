import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Path,
} from "@react-pdf/renderer";
import { ParsedInvoice } from "../InvoicePreviewCard";
import { UserProfile } from "@/hooks/useAuth";

const styles = StyleSheet.create({
  page: {
    fontSize: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
    padding: 48,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 40,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandDot: {
    width: 28,
    height: 28,
    backgroundColor: "#4F46E5",
    borderRadius: 6,
    marginRight: 8,
  },
  brandName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  invoiceLabel: {
    fontSize: 10,
    color: "#9CA3AF",
    marginBottom: 4,
  },
  invoiceNumber: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#4F46E5",
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginBottom: 32,
  },
  fromToRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  fromToBox: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#9CA3AF",
    marginBottom: 6,
  },
  sectionValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 2,
  },
  sectionSub: {
    fontSize: 9,
    color: "#6B7280",
    marginBottom: 1,
  },
  table: {
    marginBottom: 24,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    padding: 10,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    padding: 10,
    borderBottom: "1 solid #F3F4F6",
  },
  tableColDesc: { flex: 3 },
  tableColQty: { flex: 1, textAlign: "center" },
  tableColRate: { flex: 1.5, textAlign: "right" },
  tableColAmount: { flex: 1.5, textAlign: "right" },
  tableHeaderText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#9CA3AF",
  },
  tableBodyText: {
    fontSize: 10,
    color: "#374151",
  },
  tableBodyBold: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  totalsBox: {
    marginLeft: "auto",
    width: 240,
    marginBottom: 32,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  totalLabel: {
    fontSize: 10,
    color: "#6B7280",
  },
  totalValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  totalDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 6,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    backgroundColor: "#F5F3FF",
    paddingHorizontal: 10,
    borderRadius: 6,
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#4F46E5",
  },
  grandTotalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#4F46E5",
  },
  bankBox: {
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    padding: 12,
    marginBottom: 24,
  },
  bankTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#9CA3AF",
    marginBottom: 8,
  },
  bankRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bankLabel: {
    fontSize: 9,
    color: "#9CA3AF",
    width: 80,
  },
  bankValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    flex: 1,
  },
  footer: {
    borderTop: "1 solid #E5E7EB",
    paddingTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: {
    fontSize: 9,
    color: "#9CA3AF",
  },
  statusBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  statusText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#92400E",
  },
});

interface InvoicePDFProps {
  invoice: ParsedInvoice;
  invoiceNumber: string;
  userName?: string;
  profile?: UserProfile | null;
}

function formatINR(
  amount: number,
  currency: "INR" | "USD" | "EUR" = "INR"
): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
  return `${symbol}${amount.toLocaleString("en-IN")}`;
}

function getInvoiceDates(invoice: ParsedInvoice) {
  const issueDate = invoice.invoiceDate
    ? new Date(invoice.invoiceDate)
    : new Date();
  const days = invoice.paymentTermsDays || 15;
  const due = new Date(issueDate.getTime() + days * 24 * 60 * 60 * 1000);

  return {
    today: issueDate.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    dueDate: due.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
  };
}

export function InvoicePDF({
  invoice,
  invoiceNumber,
  userName = "Ledger User",
  profile,
}: InvoicePDFProps) {
  const { today, dueDate } = getInvoiceDates(invoice);

  const sellerName = profile?.businessName || userName;
  const addressParts = [
    profile?.address,
    profile?.city,
    profile?.state,
    profile?.pincode,
  ].filter(Boolean);
  const sellerAddress = addressParts.join(", ");

  const hasBankDetails =
    profile?.bankName ||
    profile?.accountNumber ||
    profile?.ifscCode ||
    profile?.upiId;

  // Currency helpers
  const currency = invoice.currency ?? "INR";
  const isINR = currency === "INR";

  const hasDiscount =
    invoice.discountType &&
    invoice.discountType !== "none" &&
    (invoice.discountValue || 0) > 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot}>
              <View style={{ marginTop: 6, marginLeft: 6 }}>
                <Svg width="16" height="16" viewBox="0 0 24 24">
                  <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white" />
                </Svg>
              </View>
            </View>
            <Text style={styles.brandName}>
              {profile?.businessName || "Ledger"}
            </Text>
          </View>
          <View>
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoiceNumber}</Text>
            {/* Currency label for non-INR */}
            {!isINR && (
              <Text style={[styles.invoiceLabel, { marginTop: 4 }]}>
                {currency}
              </Text>
            )}
          </View>
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider} />

        {/* ── From / To / Date ── */}
        <View style={styles.fromToRow}>
          <View style={styles.fromToBox}>
            <Text style={styles.sectionLabel}>FROM</Text>
            <Text style={styles.sectionValue}>{sellerName}</Text>
            {sellerAddress ? (
              <Text style={styles.sectionSub}>{sellerAddress}</Text>
            ) : null}
            {profile?.phone ? (
              <Text style={styles.sectionSub}>{profile.phone}</Text>
            ) : null}
            {isINR && profile?.gstin ? (
              <Text style={styles.sectionSub}>GSTIN: {profile.gstin}</Text>
            ) : null}
          </View>

          <View style={styles.fromToBox}>
            <Text style={styles.sectionLabel}>BILL TO</Text>
            <Text style={styles.sectionValue}>{invoice.clientName}</Text>
          </View>

          <View style={styles.fromToBox}>
            <Text style={styles.sectionLabel}>INVOICE DATE</Text>
            <Text style={styles.sectionValue}>{today}</Text>
            <Text style={styles.sectionSub}>Due: {dueDate}</Text>
            <Text style={[styles.sectionSub, { marginTop: 4 }]}>
              Net {invoice.paymentTermsDays} days
            </Text>
          </View>
        </View>

        {/* ── Table ── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.tableColDesc}>
              <Text style={styles.tableHeaderText}>DESCRIPTION</Text>
            </View>
            <View style={styles.tableColQty}>
              <Text style={styles.tableHeaderText}>QTY</Text>
            </View>
            <View style={styles.tableColRate}>
              <Text style={styles.tableHeaderText}>RATE</Text>
            </View>
            <View style={styles.tableColAmount}>
              <Text style={styles.tableHeaderText}>AMOUNT</Text>
            </View>
          </View>

          {invoice.lineItems?.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.tableColDesc}>
                <Text style={styles.tableBodyBold}>{item.description}</Text>
                {/* HSN/SAC — only for INR */}
                {isINR && item.hsnSacCode ? (
                  <Text
                    style={[
                      styles.tableBodyText,
                      { color: "#9CA3AF", marginTop: 2 },
                    ]}
                  >
                    {item.hsnSacType || "SAC"}: {item.hsnSacCode}
                  </Text>
                ) : (
                  <Text
                    style={[
                      styles.tableBodyText,
                      { color: "#9CA3AF", marginTop: 2 },
                    ]}
                  >
                    {item.quantity} {item.unit}
                  </Text>
                )}
              </View>
              <View style={styles.tableColQty}>
                <Text style={[styles.tableBodyText, { textAlign: "center" }]}>
                  {item.quantity}
                </Text>
              </View>
              <View style={styles.tableColRate}>
                <Text style={[styles.tableBodyText, { textAlign: "right" }]}>
                  {formatINR(item.rate, currency)}
                </Text>
              </View>
              <View style={styles.tableColAmount}>
                <Text style={[styles.tableBodyBold, { textAlign: "right" }]}>
                  {formatINR(item.amount, currency)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatINR(invoice.subtotal, currency)}
            </Text>
          </View>

          {/* Discount */}
          {hasDiscount && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Discount
                {invoice.discountType === "percent"
                  ? ` (${invoice.discountValue}%)`
                  : ""}
              </Text>
              <Text style={[styles.totalValue, { color: "#059669" }]}>
                - {formatINR(invoice.discountAmount || 0, currency)}
              </Text>
            </View>
          )}

          {hasDiscount && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Taxable Amount</Text>
              <Text style={styles.totalValue}>
                {formatINR(invoice.taxableAmount || invoice.subtotal, currency)}
              </Text>
            </View>
          )}

          {/* GST rows — INR only */}
          {isINR &&
            invoice.gstAmount > 0 &&
            ((invoice.gstType || "CGST_SGST") === "CGST_SGST" ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    CGST ({invoice.cgstPercent || invoice.gstPercent / 2}%)
                  </Text>
                  <Text style={styles.totalValue}>
                    {formatINR(
                      invoice.cgstAmount || invoice.gstAmount / 2,
                      currency
                    )}
                  </Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    SGST ({invoice.sgstPercent || invoice.gstPercent / 2}%)
                  </Text>
                  <Text style={styles.totalValue}>
                    {formatINR(
                      invoice.sgstAmount || invoice.gstAmount / 2,
                      currency
                    )}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  IGST ({invoice.igstPercent || invoice.gstPercent}%)
                </Text>
                <Text style={styles.totalValue}>
                  {formatINR(invoice.igstAmount || invoice.gstAmount, currency)}
                </Text>
              </View>
            ))}

          {/* Tax/VAT row — USD/EUR only */}
          {!isINR && (invoice.taxAmount || 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                {invoice.taxLabel || (currency === "EUR" ? "VAT" : "Tax")}
                {(invoice.taxPercent || 0) > 0
                  ? ` (${invoice.taxPercent}%)`
                  : ""}
              </Text>
              <Text style={styles.totalValue}>
                {formatINR(invoice.taxAmount || 0, currency)}
              </Text>
            </View>
          )}

          <View style={styles.totalDivider} />
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total Due</Text>
            <Text style={styles.grandTotalValue}>
              {formatINR(invoice.total, currency)}
            </Text>
          </View>
        </View>

        {/* ── Notes ── */}
        {invoice.notes && (
          <View
            style={{
              backgroundColor: "#F9FAFB",
              borderRadius: 6,
              padding: 12,
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                fontFamily: "Helvetica-Bold",
                color: "#9CA3AF",
                marginBottom: 4,
              }}
            >
              NOTES
            </Text>
            <Text style={{ fontSize: 9, color: "#374151" }}>
              {invoice.notes}
            </Text>
          </View>
        )}

        {/* ── Bank Details — INR only ── */}
        {isINR && hasBankDetails && (
          <View style={styles.bankBox}>
            <Text style={styles.bankTitle}>PAYMENT DETAILS</Text>
            {profile?.bankName && (
              <View style={styles.bankRow}>
                <Text style={styles.bankLabel}>Bank</Text>
                <Text style={styles.bankValue}>{profile.bankName}</Text>
              </View>
            )}
            {profile?.accountNumber && (
              <View style={styles.bankRow}>
                <Text style={styles.bankLabel}>Account No.</Text>
                <Text style={styles.bankValue}>{profile.accountNumber}</Text>
              </View>
            )}
            {profile?.ifscCode && (
              <View style={styles.bankRow}>
                <Text style={styles.bankLabel}>IFSC</Text>
                <Text style={styles.bankValue}>{profile.ifscCode}</Text>
              </View>
            )}
            {profile?.upiId && (
              <View style={styles.bankRow}>
                <Text style={styles.bankLabel}>UPI</Text>
                <Text style={styles.bankValue}>{profile.upiId}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Generated by Ledger · {today}</Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>PAYMENT PENDING</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
