import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, AlertTriangle, ShieldCheck, Zap, Lock } from "lucide-react";
import api from "@/lib/api/api";

interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

interface PublicInvoice {
  _id: string;
  invoiceNumber: string;
  clientName: string;
  lineItems: LineItem[];
  subtotal: number;
  gstAmount: number;
  gstPercent: number;
  gstType: string;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  total: number;
  invoiceMonth: string;
  dueDate: string;
  status: string;
  notes?: string;
}

function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PaymentPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get(`/payments/invoice/${id}`)
      .then((res) => setInvoice(res.data.invoice))
      .catch(() => setError("Invoice not found or not available for payment."))
      .finally(() => setLoading(false));
  }, [id]);

  const handlePay = async () => {
    if (!invoice) return;
    setPaying(true);
    try {
      const res = await api.post("/payments/create-checkout-session", {
        invoiceId: invoice._id,
      });
      window.location.href = res.data.url;
    } catch {
      setError("Failed to initiate payment. Please try again.");
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.fullPage}>
        <Loader2
          size={22}
          style={{ animation: "spin 1s linear infinite", color: "#6b7280" }}
        />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div style={styles.fullPage}>
        <div style={styles.errorBox}>
          <AlertTriangle
            size={28}
            color="#dc2626"
            style={{ marginBottom: 12 }}
          />
          <p
            style={{
              fontWeight: 600,
              fontSize: 16,
              color: "#111",
              margin: "0 0 6px",
            }}
          >
            Invoice unavailable
          </p>
          <p
            style={{
              fontSize: 13,
              color: "#6b7280",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {error || "This invoice is not available for payment."}
          </p>
        </div>
      </div>
    );
  }

  const hasGst = invoice.gstAmount > 0;

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      `}</style>

      {/* Top bar */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>
            <Zap size={13} color="#fff" fill="#fff" />
          </div>
          <span style={styles.logoText}>Ledger</span>
        </div>
        <div style={styles.secureTag}>
          <Lock size={11} color="#6b7280" />
          <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 4 }}>
            Secure checkout
          </span>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          {/* Invoice meta */}
          <div style={styles.invoiceMeta}>
            <div>
              <p style={styles.invoiceLabel}>Invoice</p>
              <p style={styles.invoiceNumber}>{invoice.invoiceNumber}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={styles.invoiceLabel}>Due date</p>
              <p style={styles.invoiceNumber}>
                {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
              </p>
            </div>
          </div>

          {/* Amount hero */}
          <div style={styles.amountHero}>
            <p style={styles.amountLabel}>Amount due</p>
            <p style={styles.amountValue}>{formatINR(invoice.total)}</p>
            <p style={styles.amountSubtext}>
              Billed to {invoice.clientName} · {invoice.invoiceMonth}
            </p>
          </div>

          {/* Divider */}
          <div style={styles.divider} />

          {/* Line items */}
          <div style={styles.section}>
            <p style={styles.sectionLabel}>Invoice details</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {invoice.lineItems.map((item, i) => (
                <div key={i} style={styles.lineItem}>
                  <div style={{ flex: 1 }}>
                    <p style={styles.lineItemName}>{item.description}</p>
                    <p style={styles.lineItemSub}>
                      {item.quantity} {item.unit} × {formatINR(item.rate)}
                    </p>
                  </div>
                  <p style={styles.lineItemAmount}>{formatINR(item.amount)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={styles.divider} />

          {/* Totals */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Subtotal</span>
              <span style={styles.totalValue}>
                {formatINR(invoice.subtotal)}
              </span>
            </div>

            {hasGst && invoice.gstType === "CGST_SGST" && (
              <>
                <div style={styles.totalRow}>
                  <span style={styles.totalLabel}>
                    CGST ({invoice.gstPercent / 2}%)
                  </span>
                  <span style={styles.totalValue}>
                    {formatINR(invoice.cgstAmount ?? invoice.gstAmount / 2)}
                  </span>
                </div>
                <div style={styles.totalRow}>
                  <span style={styles.totalLabel}>
                    SGST ({invoice.gstPercent / 2}%)
                  </span>
                  <span style={styles.totalValue}>
                    {formatINR(invoice.sgstAmount ?? invoice.gstAmount / 2)}
                  </span>
                </div>
              </>
            )}

            {hasGst && invoice.gstType === "IGST" && (
              <div style={styles.totalRow}>
                <span style={styles.totalLabel}>
                  IGST ({invoice.gstPercent}%)
                </span>
                <span style={styles.totalValue}>
                  {formatINR(invoice.igstAmount ?? invoice.gstAmount)}
                </span>
              </div>
            )}

            <div
              style={{
                ...styles.totalRow,
                marginTop: 4,
                paddingTop: 12,
                borderTop: "1px solid #f3f4f6",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>
                Total due
              </span>
              <span
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#111",
                  letterSpacing: "-0.3px",
                }}
              >
                {formatINR(invoice.total)}
              </span>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div style={styles.notes}>
              <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                {invoice.notes}
              </p>
            </div>
          )}

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={paying}
            style={{
              ...styles.payButton,
              opacity: paying ? 0.7 : 1,
              cursor: paying ? "not-allowed" : "pointer",
            }}
          >
            {paying ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                }}
              >
                <Loader2
                  size={16}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Redirecting to payment...
              </span>
            ) : (
              `Pay ${formatINR(invoice.total)}`
            )}
          </button>

          {/* Trust badges */}
          <div style={styles.trustRow}>
            <ShieldCheck size={13} color="#9ca3af" />
            <span style={styles.trustText}>256-bit SSL encryption</span>
            <span style={styles.trustDot}>·</span>
            <span style={styles.trustText}>Powered by Stripe</span>
          </div>
        </div>

        {/* Footer */}
        <p style={styles.footer}>
          Issued by{" "}
          <strong style={{ fontWeight: 500, color: "#374151" }}>Ledger</strong>{" "}
          · Questions? Contact the sender directly.
        </p>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f9fafb",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  fullPage: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    background: "#f9fafb",
  },
  errorBox: {
    background: "#fff",
    border: "1px solid #fee2e2",
    borderRadius: 12,
    padding: "28px 32px",
    textAlign: "center",
    maxWidth: 320,
  },
  header: {
    background: "#fff",
    borderBottom: "1px solid #f3f4f6",
    padding: "14px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  logoIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: "#4F46E5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 15,
    fontWeight: 600,
    color: "#111",
    letterSpacing: "-0.2px",
  },
  secureTag: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    padding: "4px 10px",
  },
  main: {
    maxWidth: 480,
    margin: "40px auto",
    padding: "0 20px 60px",
  },
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: "28px 28px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  invoiceMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  invoiceLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "#9ca3af",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    marginBottom: 3,
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: 500,
    color: "#374151",
    letterSpacing: "-0.1px",
  },
  amountHero: {
    textAlign: "center",
    padding: "20px 0 4px",
  },
  amountLabel: {
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: 500,
    marginBottom: 8,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  amountValue: {
    fontSize: 42,
    fontWeight: 700,
    color: "#111",
    letterSpacing: "-1.5px",
    lineHeight: 1,
    marginBottom: 10,
  },
  amountSubtext: {
    fontSize: 13,
    color: "#9ca3af",
  },
  divider: {
    borderTop: "1px solid #f3f4f6",
    margin: "0 -4px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "#9ca3af",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  },
  lineItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
  },
  lineItemName: {
    fontSize: 14,
    fontWeight: 500,
    color: "#111",
    lineHeight: 1.4,
  },
  lineItemSub: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
  },
  lineItemAmount: {
    fontSize: 14,
    fontWeight: 500,
    color: "#374151",
    whiteSpace: "nowrap" as const,
    paddingTop: 1,
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 13,
    color: "#6b7280",
  },
  totalValue: {
    fontSize: 13,
    color: "#374151",
    fontWeight: 500,
  },
  notes: {
    background: "#f9fafb",
    border: "1px solid #f3f4f6",
    borderRadius: 8,
    padding: "10px 14px",
  },
  payButton: {
    width: "100%",
    padding: "15px 20px",
    background: "#4F46E5",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.2px",
    transition: "background 0.15s ease",
    marginTop: 4,
  },
  trustRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  trustText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  trustDot: {
    color: "#d1d5db",
    fontSize: 12,
  },
  footer: {
    textAlign: "center",
    marginTop: 20,
    fontSize: 12,
    color: "#9ca3af",
    lineHeight: 1.6,
  },
};
