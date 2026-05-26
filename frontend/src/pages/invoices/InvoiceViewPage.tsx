import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  ArrowLeft,
  Edit2,
  Download,
  Mail,
  Copy,
  Zap,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  confirmInvoice,
  fetchInvoiceById,
  updateInvoice,
} from "@/lib/api/invoiceApi";
import { downloadInvoicePDF } from "@/lib/downloadPDF";
import { EditInvoiceModal } from "@/components/invoice/modals/EditInvoiceModal";
import { LineItem } from "@/components/invoice/InvoicePreviewCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SendInvoiceModal } from "@/components/invoice/modals/SendInvoiceModel";
import { toast } from "sonner";
import { getClientByName } from "@/lib/api/clientApi";
import type { ClientAPI } from "@/lib/api/clientApi";

interface Invoice {
  _id: string;
  invoiceNumber: string;
  clientName: string;
  lineItems?: LineItem[];
  paymentTermsDays?: number;
  gstPercent: number;
  gstType?: "IGST" | "CGST_SGST";
  cgstPercent?: number;
  sgstPercent?: number;
  igstPercent?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount: number;
  discountType?: "percent" | "amount" | "none";
  discountValue?: number;
  discountAmount?: number;
  taxableAmount?: number;
  notes?: string;
  subtotal: number;
  total: number;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  createdAt: string;
  dueDate: string;
  originalPrompt?: string;
}

const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    class: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
  },
  confirmed: {
    label: "Confirmed",
    class: "text-emerald-600 bg-emerald-50",
    dot: "bg-emerald-50",
  },
  sent: {
    label: "Sent",
    class: "bg-blue-50 text-blue-600",
    dot: "bg-blue-500",
  },
  paid: {
    label: "Paid",
    class: "bg-emerald-50 text-emerald-600",
    dot: "bg-emerald-500",
  },
  overdue: {
    label: "Overdue",
    class: "bg-red-50 text-red-500",
    dot: "bg-red-500",
  },
};

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
    month: "long",
    year: "numeric",
  });
}

function getDaysUntilDue(dueDate: string) {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function InvoiceViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [client, setClient] = useState<ClientAPI | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchInvoiceById(id)
      .then(setInvoice)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!invoice?.clientName || !user) return;
    getClientByName(user.id, invoice.clientName)
      .then((c) => setClient(c))
      .catch(() => {});
  }, [invoice?.clientName, user?.id]);

  const handleDownload = async () => {
    if (!invoice) return;
    await downloadInvoicePDF(
      {
        clientName: invoice.clientName,
        lineItems: invoice.lineItems || [],
        gstPercent: invoice.gstPercent,
        gstType: invoice.gstType,
        cgstPercent: invoice.cgstPercent,
        sgstPercent: invoice.sgstPercent,
        igstPercent: invoice.igstPercent,
        cgstAmount: invoice.cgstAmount,
        sgstAmount: invoice.sgstAmount,
        igstAmount: invoice.igstAmount,
        gstAmount: invoice.gstAmount,
        discountType: invoice.discountType,
        discountValue: invoice.discountValue,
        discountAmount: invoice.discountAmount,
        taxableAmount: invoice.taxableAmount,
        notes: invoice.notes,
        paymentTermsDays: invoice.paymentTermsDays || 15,
        subtotal: invoice.subtotal,
        total: invoice.total,
      },
      invoice.invoiceNumber,
      user?.fullName || "Ledger User"
    );
  };

  const handleSaveEdit = async (invoiceId: string, data: Partial<Invoice>) => {
    try {
      await updateInvoice(invoiceId, data);
      setInvoice((prev) => (prev ? { ...prev, ...data } : prev));
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmInvoice = async () => {
    if (!invoice) return;

    try {
      const confirmed = await confirmInvoice(invoice._id);

      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              status: "confirmed",
              invoiceNumber: confirmed.invoiceNumber,
            }
          : prev
      );

      toast.success("Invoice confirmed successfully!");
    } catch (err) {
      console.error("Failed to confirm invoice:", err);

      toast.error("Failed to confirm invoice");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-900 font-semibold">Invoice not found</p>
          <Button
            variant="link"
            onClick={() => navigate("/invoices")}
            className="text-indigo-600 text-sm mt-2 p-0 h-auto"
          >
            Back to invoices
          </Button>
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[invoice.status];
  const daysUntilDue = invoice.dueDate
    ? getDaysUntilDue(invoice.dueDate)
    : null;

  const hasDiscount =
    invoice.discountType &&
    invoice.discountType !== "none" &&
    (invoice.discountValue || 0) > 0;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="rounded-xl text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "#4F46E5" }}
              >
                <Zap className="w-3.5 h-3.5 text-white" fill="white" />
              </div>
              <span className="font-semibold text-gray-900">Ledger</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page heading */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <Badge className={`gap-1.5 rounded-full ${status.class}`}>
              {status.label}
            </Badge>
          </div>
          <p className="text-sm text-gray-400">
            Created on {formatDate(invoice.createdAt)}
            {invoice.dueDate && (
              <span> · Due {formatDate(invoice.dueDate)}</span>
            )}
          </p>
        </div>

        {/* Main layout — 70/30 */}
        <div className="flex gap-6 items-start">
          {/* ── Left 70% ── */}
          <div
            id="invoice-print-area"
            className="flex-1 bg-white rounded-2xl border border-gray-100 overflow-hidden"
            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}
          >
            {/* Invoice gradient header */}
            <div
              className="px-8 py-7"
              style={{
                background: "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
                    <Zap className="w-5 h-5 text-white" fill="white" />
                  </div>
                  <div>
                    <p className="text-white font-bold text-lg">Ledger</p>
                    <p className="text-indigo-200 text-xs">Smart Invoicing</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-indigo-200 text-xs uppercase tracking-widest mb-1">
                    Invoice
                  </p>
                  <p className="text-white font-bold text-xl">
                    {invoice.invoiceNumber}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-8 py-6">
              {/* From / To / Date */}
              <div className="grid grid-cols-3 gap-6 pb-6 border-b border-gray-100">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    From
                  </p>
                  <p className="text-sm font-bold text-gray-900">
                    {user?.fullName || "Ledger User"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">via Ledger</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Bill To
                  </p>
                  <p className="text-sm font-bold text-gray-900">
                    {invoice.clientName}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Dates
                  </p>
                  <p className="text-xs text-gray-600">
                    <span className="text-gray-400">Issued: </span>
                    {formatDate(invoice.createdAt)}
                  </p>
                  {invoice.dueDate && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      <span className="text-gray-400">Due: </span>
                      {formatDate(invoice.dueDate)}
                    </p>
                  )}
                </div>
              </div>

              {/* Line items table */}
              <div className="mt-6">
                <div className="grid grid-cols-12 gap-4 px-4 py-2.5 bg-gray-50 rounded-xl mb-2">
                  <div className="col-span-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Description
                    </p>
                  </div>
                  <div className="col-span-2 text-center">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Qty
                    </p>
                  </div>
                  <div className="col-span-2 text-right">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Rate
                    </p>
                  </div>
                  <div className="col-span-3 text-right">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Amount
                    </p>
                  </div>
                </div>

                {invoice.lineItems?.map((item, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-12 gap-4 px-4 py-4 border-b border-gray-100"
                  >
                    <div className="col-span-5">
                      <p className="text-sm font-semibold text-gray-900">
                        {item.description}
                      </p>
                      {item.hsnSacCode && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">
                          {item.hsnSacCode}
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      <p className="text-sm text-gray-600">
                        {item.quantity} {item.unit}
                      </p>
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-sm text-gray-600">
                        {formatINR(item.rate)}
                      </p>
                    </div>
                    <div className="col-span-3 text-right">
                      <p className="text-sm font-bold text-gray-900">
                        {formatINR(item.amount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="mt-4 flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="text-gray-700 font-medium">
                      {formatINR(invoice.subtotal)}
                    </span>
                  </div>

                  {hasDiscount && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>
                        Discount
                        {invoice.discountType === "percent"
                          ? ` (${invoice.discountValue}%)`
                          : ""}
                      </span>
                      <span className="font-medium">
                        − {formatINR(invoice.discountAmount || 0)}
                      </span>
                    </div>
                  )}

                  {hasDiscount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Taxable Amount</span>
                      <span className="text-gray-700 font-medium">
                        {formatINR(invoice.taxableAmount || invoice.subtotal)}
                      </span>
                    </div>
                  )}

                  {(invoice.gstType || "CGST_SGST") === "CGST_SGST" ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">
                          CGST ({invoice.cgstPercent || invoice.gstPercent / 2}
                          %)
                        </span>
                        <span className="text-gray-700 font-medium">
                          {formatINR(
                            invoice.cgstAmount || invoice.gstAmount / 2
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">
                          SGST ({invoice.sgstPercent || invoice.gstPercent / 2}
                          %)
                        </span>
                        <span className="text-gray-700 font-medium">
                          {formatINR(
                            invoice.sgstAmount || invoice.gstAmount / 2
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">
                        IGST ({invoice.igstPercent || invoice.gstPercent}%)
                      </span>
                      <span className="text-gray-700 font-medium">
                        {formatINR(invoice.igstAmount || invoice.gstAmount)}
                      </span>
                    </div>
                  )}

                  {invoice.paymentTermsDays && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Payment Terms</span>
                      <span className="text-gray-700 font-medium">
                        {invoice.paymentTermsDays} days
                      </span>
                    </div>
                  )}

                  <Separator className="my-2" />
                  <div
                    className="flex justify-between items-center px-4 py-3 rounded-xl"
                    style={{
                      background:
                        "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)",
                    }}
                  >
                    <span className="text-sm font-bold text-indigo-900">
                      Total Due
                    </span>
                    <span className="text-lg font-bold text-indigo-600">
                      {formatINR(invoice.total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {invoice.notes && (
                <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap">
                    {invoice.notes}
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 text-center">
                  Generated by Ledger · Thank you for your business!
                </p>
              </div>
            </div>
          </div>

          {/* ── Right 30% ── */}
          <div className="w-72 flex-shrink-0 space-y-4">
            {/* Client card */}
            <div
              className="bg-white rounded-2xl border border-gray-100 p-5"
              style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}
            >
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                Client
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                  {invoice.clientName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {client?.name || invoice.clientName}
                  </p>
                  <p className="text-xs text-gray-400">Client</p>
                </div>
              </div>

              {client ? (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2.5">
                    {client.email && (
                      <div className="flex items-start gap-2">
                        <p className="text-xs text-gray-400 w-14 flex-shrink-0 pt-0.5">
                          Email
                        </p>
                        <p className="text-xs text-gray-700 break-all">
                          {client.email}
                        </p>
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-start gap-2">
                        <p className="text-xs text-gray-400 w-14 flex-shrink-0 pt-0.5">
                          Phone
                        </p>
                        <p className="text-xs text-gray-700">{client.phone}</p>
                      </div>
                    )}
                    {(client.address || client.city || client.state) && (
                      <div className="flex items-start gap-2">
                        <p className="text-xs text-gray-400 w-14 flex-shrink-0 pt-0.5">
                          Address
                        </p>
                        <div>
                          {client.address && (
                            <p className="text-xs text-gray-700">
                              {client.address}
                            </p>
                          )}
                          {(client.city || client.state) && (
                            <p className="text-xs text-gray-700">
                              {[client.city, client.state]
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          )}
                          {client.pincode && (
                            <p className="text-xs text-gray-700">
                              {client.pincode}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {client.gstin && (
                      <div className="flex items-start gap-2">
                        <p className="text-xs text-gray-400 w-14 flex-shrink-0 pt-0.5">
                          GSTIN
                        </p>
                        <p className="text-xs font-mono text-gray-700">
                          {client.gstin}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Separator className="my-4" />
                  <p className="text-xs text-gray-400 leading-relaxed">
                    No contact details saved for this client yet.
                  </p>
                </>
              )}
            </div>

            {/* Actions card */}
            <div
              className="bg-white rounded-2xl border border-gray-100 p-5"
              style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}
            >
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                Actions
              </p>
              <div className="space-y-2">
                {/* Confirm — only on draft */}
                {invoice.status === "draft" && (
                  <Button
                    variant="outline"
                    onClick={() => setShowConfirmModal(true)}
                    className="w-full justify-start gap-3 rounded-xl"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Confirm Invoice
                  </Button>
                )}

                {/* Download PDF — always visible */}
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  className="w-full justify-start gap-3 rounded-xl"
                >
                  <Download className="w-4 h-4 text-gray-400" />
                  Download PDF
                </Button>

                {/* Edit — only on draft and confirmed */}
                {["draft", "confirmed"].includes(invoice.status) && (
                  <Button
                    variant="outline"
                    onClick={() => setEditing(true)}
                    className="w-full justify-start gap-3 rounded-xl"
                  >
                    <Edit2 className="w-4 h-4 text-gray-400" />
                    Edit Invoice
                  </Button>
                )}

                {/* Send — only on confirmed */}
                {invoice.status === "confirmed" && (
                  <Button
                    variant="outline"
                    onClick={() => setShowSendModal(true)}
                    className="w-full justify-start gap-3 rounded-xl"
                  >
                    <Mail className="w-4 h-4 text-gray-400" />
                    Send Invoice
                  </Button>
                )}

                {/* Copy payment link — only on sent and overdue */}
                {["sent", "overdue"].includes(invoice.status) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const link = `${window.location.origin}/pay/${invoice._id}`;
                      navigator.clipboard.writeText(link);
                      toast.success("Payment link copied!");
                    }}
                    className="w-full justify-start gap-3 rounded-xl"
                  >
                    <Copy className="w-4 h-4 text-gray-400" />
                    Copy Payment Link
                  </Button>
                )}
              </div>
            </div>

            {/* Status card */}
            {invoice.status === "draft" && (
              <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <p className="text-sm font-semibold text-gray-600">Draft</p>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  This invoice hasn't been sent yet. Edit and confirm all
                  details before sending.
                </p>
              </div>
            )}

            {invoice.status === "sent" && daysUntilDue !== null && (
              <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-blue-500" />
                  <p className="text-sm font-semibold text-blue-700">
                    Awaiting Payment
                  </p>
                </div>
                <p className="text-xs text-blue-600 leading-relaxed">
                  {daysUntilDue > 0
                    ? `Due in ${daysUntilDue} day${
                        daysUntilDue !== 1 ? "s" : ""
                      } — ${formatDate(invoice.dueDate)}`
                    : "Due today!"}
                </p>
              </div>
            )}

            {invoice.status === "paid" && (
              <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <p className="text-sm font-semibold text-emerald-700">
                    Payment Received
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-600">Amount</span>
                    <span className="font-semibold text-emerald-700">
                      {formatINR(invoice.total)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-600">Invoice</span>
                    <span className="font-semibold text-emerald-700">
                      {invoice.invoiceNumber}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {invoice.status === "overdue" && daysUntilDue !== null && (
              <div className="bg-red-50 rounded-2xl border border-red-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <p className="text-sm font-semibold text-red-700">
                    Payment Overdue
                  </p>
                </div>
                <p className="text-xs text-red-600 leading-relaxed">
                  Due on {formatDate(invoice.dueDate)}. Overdue by{" "}
                  {Math.abs(daysUntilDue)} day
                  {Math.abs(daysUntilDue) !== 1 ? "s" : ""}.
                </p>
                <Button className="mt-3 w-full rounded-xl text-xs bg-red-500 hover:bg-red-600">
                  Send Reminder
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      {showSendModal && invoice && (
        <SendInvoiceModal
          invoiceId={invoice._id}
          invoiceNumber={invoice.invoiceNumber}
          clientName={invoice.clientName}
          total={invoice.total}
          invoice={{
            ...invoice,
            lineItems: invoice.lineItems ?? [],
            paymentTermsDays: invoice.paymentTermsDays ?? 15,
          }}
          onClose={() => setShowSendModal(false)}
          onSent={() => {
            setInvoice((prev) =>
              prev
                ? {
                    ...prev,
                    status: "sent",
                  }
                : prev
            );

            setShowSendModal(false);
          }}
        />
      )}

      {editing && (
        <EditInvoiceModal
          invoice={invoice}
          onSave={handleSaveEdit}
          onClose={() => setEditing(false)}
        />
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>

              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">
                  Confirm Invoice
                </h2>

                <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                  Once confirmed, this invoice will get a final invoice number
                  and can be sent to the client.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>

              <Button
                onClick={async () => {
                  await handleConfirmInvoice();
                  setShowConfirmModal(false);
                }}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
              >
                Confirm Invoice
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
