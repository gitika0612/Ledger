import {
  Download,
  Eye,
  CheckCircle2,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ParsedInvoice } from "./InvoicePreviewCard";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  formatCurrencyAmount,
  isIndianCurrency,
  getCurrencyInfo,
} from "@/lib/currencies";

interface InvoicePanelCardProps {
  messageId: string;
  invoice: ParsedInvoice;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  invoiceNumber?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onDownload: () => void;
  onView: () => void;
}

function formatINR(amount: number, currency?: string) {
  return formatCurrencyAmount(amount, currency ?? "INR");
}

export function InvoicePanelCard({
  invoice,
  status,
  invoiceNumber,
  isExpanded,
  onToggle,
  onConfirm,
  onDiscard,
  onDownload,
  onView,
}: InvoicePanelCardProps) {
  return (
    <div
      className={`
      rounded-2xl border transition-all
      ${
        status === "confirmed"
          ? "border-emerald-100 bg-emerald-50/50"
          : "border-gray-100 bg-white"
      }
    `}
    >
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Avatar */}
        <div
          className={`
          w-8 h-8 rounded-full flex items-center justify-center
          text-xs font-bold flex-shrink-0
          ${
            status === "confirmed"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-indigo-100 text-indigo-700"
          }
        `}
        >
          {invoice.clientName.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {invoice.clientName}
          </p>
          <p className="text-xs text-gray-400">
            {status === "confirmed" && invoiceNumber
              ? invoiceNumber
              : `${invoice.lineItems?.length || 0} item${
                  (invoice.lineItems?.length || 0) !== 1 ? "s" : ""
                }`}{" "}
            · {formatINR(invoice.total, invoice.currency)}
          </p>
        </div>

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Line items */}
          <div className="space-y-1.5">
            {invoice.lineItems?.map((item, index) => (
              <div
                key={index}
                className="flex justify-between text-xs bg-white rounded-xl px-3 py-2 border border-gray-100"
              >
                <span className="text-gray-600 truncate flex-1">
                  {item.description}
                </span>
                <span className="font-semibold text-gray-900 ml-2">
                  {formatINR(item.amount, invoice.currency)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="bg-white rounded-xl border border-gray-100 px-3 py-2.5 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Subtotal</span>
              <span className="text-gray-700">
                {formatINR(invoice.subtotal, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">
                {isIndianCurrency(invoice.currency)
                  ? `GST (${invoice.gstPercent}%)`
                  : `${getCurrencyInfo(invoice.currency).taxLabel} (${
                      invoice.taxPercent ?? 0
                    }%)`}
              </span>
              <span className="text-gray-700">
                {formatINR(
                  isIndianCurrency(invoice.currency)
                    ? invoice.gstAmount
                    : invoice.taxAmount ?? 0,
                  invoice.currency
                )}
              </span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between text-xs font-bold">
              <span className="text-gray-900">Total</span>
              <span className="text-indigo-600">
                {formatINR(invoice.total, invoice.currency)}
              </span>
            </div>
          </div>

          {/* GST/Tax + Payment Terms */}
          <div className="flex gap-2">
            <div className="flex-1 bg-white rounded-xl border border-gray-100 px-3 py-2 text-center">
              <p className="text-xs text-gray-400">
                {isIndianCurrency(invoice.currency)
                  ? "GST"
                  : getCurrencyInfo(invoice.currency).taxLabel}
              </p>
              <p className="text-xs font-semibold text-gray-900">
                {isIndianCurrency(invoice.currency)
                  ? invoice.gstPercent
                  : invoice.taxPercent ?? 0}
                %
              </p>
            </div>
            <div className="flex-1 bg-white rounded-xl border border-gray-100 px-3 py-2 text-center">
              <p className="text-xs text-gray-400">Terms</p>
              <p className="text-xs font-semibold text-gray-900">
                {invoice.paymentTermsDays} days
              </p>
            </div>
          </div>

          {/* Actions */}
          {status === "confirmed" ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onView}
                className="flex-1 rounded-xl text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                View
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDownload}
                className="flex-1 rounded-xl text-xs gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={onConfirm}
                className="flex-1 rounded-xl text-xs bg-indigo-600 hover:bg-indigo-700 gap-1.5"
                style={{ boxShadow: "0 4px 8px rgba(79,70,229,0.3)" }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDiscard}
                className="px-3 rounded-xl text-xs text-red-500 bg-red-50 hover:bg-red-100 hover:text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* Confirmed badge */}
          {status === "confirmed" && invoiceNumber && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-emerald-700">
                Saved as {invoiceNumber}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
