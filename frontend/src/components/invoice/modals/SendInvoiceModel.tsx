import { useState, useEffect } from "react";
import { isAxiosError } from "axios";
import {
  Mail,
  Loader2,
  Send,
  CheckCircle2,
  X,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getClientByName } from "@/lib/api/clientApi";
import { useAuth } from "@/hooks/useAuth";
import { generateInvoicePDFBase64 } from "@/lib/downloadPDF";
import {
  ParsedInvoice,
  LineItem,
} from "@/components/invoice/InvoicePreviewCard";
import { formatCurrencyAmount as formatCurrency } from "@/lib/currencies";

interface InvoiceForPDF {
  clientName: string;
  lineItems: LineItem[];
  paymentTermsDays: number;
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
  invoiceDate?: string;
  invoiceMonth?: string;
  currency?: string;
}

import api from "@/lib/api/api";

interface SendInvoiceModalProps {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  total: number;
  invoice: InvoiceForPDF;
  onClose: () => void;
  onSent: () => void;
}

type ModalState =
  | "loading"
  | "no_profile"
  | "no_email"
  | "ready"
  | "sending"
  | "sent";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function SendInvoiceModal({
  invoiceId,
  invoiceNumber,
  clientName,
  total,
  invoice,
  onClose,
  onSent,
}: SendInvoiceModalProps) {
  const { user } = useUser();
  const { getUserProfile } = useAuth();
  const navigate = useNavigate();

  const [modalState, setModalState] = useState<ModalState>("loading");
  const [clientEmail, setClientEmail] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [sendError, setSendError] = useState("");
  const [emailError, setEmailError] = useState("");

  // Currency from invoice
  const currency = invoice.currency ?? "INR";
  const fmt = (amount: number) => formatCurrency(amount, currency);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [profile, client] = await Promise.all([
          getUserProfile(),
          getClientByName(clientName).catch(() => null),
        ]);

        if (cancelled) return;

        const businessName = profile?.businessName?.trim() || "";
        if (!businessName) {
          setModalState("no_profile");
          return;
        }
        setFromName(businessName);

        const email = client?.email?.trim() || "";
        if (!email) {
          setModalState("no_email");
          return;
        }

        setClientEmail(email);
        setModalState("ready");
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load send data:", err);
          setModalState("no_email");
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, clientName]);

  const handleSend = async (emailToUse: string) => {
    if (!user || !emailToUse.trim()) return;
    setSendError("");
    setModalState("sending");

    try {
      const profile = await getUserProfile();
      const pdfBase64 = await generateInvoicePDFBase64(
        invoice as ParsedInvoice,
        invoiceNumber,
        user.fullName || user.firstName || "Ledger User",
        profile
      );

      await api.post(`/invoices/${invoiceId}/send`, {
        pdfBase64,
        clientEmail: emailToUse.trim(),
      });

      setClientEmail(emailToUse.trim());
      setModalState("sent");
      onSent();
    } catch (err: unknown) {
      let msg = "Failed to send invoice. Please try again.";
      if (isAxiosError<{ message?: string }>(err)) {
        msg = err.response?.data?.message ?? err.message ?? msg;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setSendError(msg);
      setModalState(clientEmail ? "ready" : "no_email");
    }
  };

  const canClose = modalState !== "sending";

  return (
    <Dialog open onOpenChange={(open) => !open && canClose && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 rounded-2xl overflow-hidden [&>button]:hidden">
        {/* ── Header ── */}
        <DialogHeader className="px-6 py-5 border-b border-gray-100 space-y-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Send className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-gray-900">
                  Send Invoice
                </DialogTitle>
                <DialogDescription className="text-xs text-gray-400 mt-0.5">
                  {invoiceNumber} · {fmt(total)}
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={!canClose}
              className="w-8 h-8 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* ── Loading ── */}
        {modalState === "loading" && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        )}

        {/* ── No Profile ── */}
        {modalState === "no_profile" && (
          <div className="px-6 py-8 space-y-5">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-amber-500" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">
                  Company profile not set up
                </p>
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                  Your company name appears as the sender on the invoice email.
                  Add it in Profile Settings before sending.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 leading-relaxed">
                Go to <strong>Company Settings → Company Details</strong> and
                enter your company or freelancer name, then come back to send.
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  navigate("/profile");
                }}
                className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-700 gap-2"
              >
                Go to Profile
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── No Email ── */}
        {modalState === "no_email" && (
          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                {clientName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {clientName}
                </p>
                <p className="text-xs text-gray-400">No email on file</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                <Mail className="w-3 h-3" />
                Client Email *
              </Label>
              <Input
                type="email"
                value={typedEmail}
                onChange={(e) => {
                  const val = e.target.value;
                  setTypedEmail(val);
                  setSendError("");
                  if (val && !isValidEmail(val)) {
                    setEmailError("Please enter a valid email address");
                  } else {
                    setEmailError("");
                  }
                }}
                onBlur={() => {
                  if (typedEmail && !isValidEmail(typedEmail)) {
                    setEmailError("Please enter a valid email address");
                  }
                }}
                placeholder="Enter client's email address"
                className={`rounded-xl focus-visible:ring-indigo-400 ${
                  emailError ? "border-red-400 focus-visible:ring-red-400" : ""
                }`}
                autoFocus
              />
              {emailError ? (
                <p className="text-xs text-red-500">{emailError}</p>
              ) : (
                <p className="text-xs text-gray-400">
                  This will be saved for future invoices to {clientName}.
                </p>
              )}
            </div>

            {sendError && <p className="text-xs text-red-500">{sendError}</p>}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleSend(typedEmail)}
                disabled={!typedEmail.trim() || !isValidEmail(typedEmail)}
                className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 gap-2"
                style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}
              >
                <Send className="w-3.5 h-3.5" />
                Send Invoice
              </Button>
            </div>
          </div>
        )}

        {/* ── Ready ── */}
        {modalState === "ready" && (
          <div className="px-6 py-5 space-y-5">
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Sending to
              </p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold flex-shrink-0">
                  {clientName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {clientName}
                  </p>
                  <p className="text-xs text-indigo-600">{clientEmail}</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Invoice</span>
                  <span className="font-semibold text-gray-900">
                    {invoiceNumber}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">From</span>
                  <span className="font-semibold text-gray-900">
                    {fromName}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-gray-900">Amount Due</span>
                  <span className="text-indigo-600">{fmt(total)}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-xs text-blue-700 leading-relaxed">
                The invoice PDF will be attached and the status will update to{" "}
                <strong>Sent</strong> once delivered.
              </p>
            </div>

            {sendError && <p className="text-xs text-red-500">{sendError}</p>}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleSend(clientEmail)}
                className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 gap-2"
                style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}
              >
                <Send className="w-3.5 h-3.5" />
                Send Invoice
              </Button>
            </div>
          </div>
        )}

        {/* ── Sending ── */}
        {modalState === "sending" && (
          <div className="px-6 py-16 flex flex-col items-center text-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <Send className="w-7 h-7 text-indigo-500" />
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border border-gray-100 flex items-center justify-center">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
              </div>
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">
                Sending invoice…
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Generating PDF and sending to {clientEmail || typedEmail}
              </p>
            </div>
          </div>
        )}

        {/* ── Sent ── */}
        {modalState === "sent" && (
          <div className="px-6 py-10 flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Invoice Sent!</p>
              <p className="text-sm text-gray-400 mt-1">
                {invoiceNumber} has been delivered to
              </p>
              <p className="text-sm font-semibold text-indigo-600 mt-0.5">
                {clientEmail || typedEmail}
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl px-4 py-3 w-full text-left space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Client</span>
                <span className="font-medium text-gray-700">{clientName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Amount</span>
                <span className="font-medium text-gray-700">{fmt(total)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Status</span>
                <Badge className="text-xs text-blue-600 bg-blue-50 border-blue-100 rounded-full px-2 py-0 font-normal">
                  Sent
                </Badge>
              </div>
            </div>

            <Button
              onClick={onClose}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 mt-2"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
