import { useState, useEffect, useRef } from "react";
import {
  X,
  Save,
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { LineItem } from "@/components/invoice/InvoicePreviewCard";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useUser } from "@clerk/clerk-react";
import { getClientByName } from "@/lib/api/clientApi";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";

export interface EditInvoiceData {
  _id: string;
  invoiceNumber: string;
  clientName: string;
  currency?: "INR" | "USD" | "EUR";
  clientEmail?: string;
  clientAddress?: string;
  clientCity?: string;
  clientState?: string;
  clientPincode?: string;
  lineItems?: LineItem[];
  paymentTermsDays?: number;
  // INR GST fields
  gstPercent: number;
  gstType?: "IGST" | "CGST_SGST";
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount: number;
  // USD/EUR Tax fields
  taxPercent?: number;
  taxAmount?: number;
  taxLabel?: string;
  // Common
  discountType?: "percent" | "amount" | "none";
  discountValue?: number;
  discountAmount?: number;
  notes?: string;
  subtotal: number;
  taxableAmount?: number;
  total: number;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  dueDate: string;
}

interface EditInvoiceModalProps {
  invoice: EditInvoiceData;
  onSave: (id: string, data: Partial<EditInvoiceData>) => Promise<void>;
  onClose: () => void;
}

interface ValidationErrors {
  clientName?: string;
  clientEmail?: string;
  clientPincode?: string;
  gstPercent?: string;
  paymentTermsDays?: string;
  lineItems?: string;
  lineItemErrors?: {
    description?: string;
    quantity?: string;
    rate?: string;
    unit?: string;
    hsnSacCode?: string;
  }[];
}

const UNIT_DEFAULTS = [
  { value: "item", label: "Item" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "kg", label: "Kg" },
  { value: "piece", label: "Piece" },
  { value: "lot", label: "Lot" },
  { value: "milestone", label: "Milestone" },
];

function UnitSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = UNIT_DEFAULTS.filter((u) =>
    u.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };
  const handleCustom = () => {
    if (search.trim()) {
      onChange(search.trim());
      setOpen(false);
      setSearch("");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-8 rounded-lg bg-white border border-gray-200 px-2 text-xs font-medium text-gray-700 flex items-center justify-between gap-1 hover:border-indigo-300 transition-all"
      >
        <span className="truncate">{value || "Unit"}</span>
        <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-40 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustom();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search or create..."
              className="w-full text-xs px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-indigo-300"
            />
          </div>
          <div className="max-h-40 overflow-y-auto py-1">
            {filtered.map((u) => (
              <button
                key={u.value}
                onClick={() => handleSelect(u.value)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors ${
                  value === u.value
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-gray-700"
                }`}
              >
                {u.label}
              </button>
            ))}
            {search.trim() &&
              !filtered.find(
                (u) => u.label.toLowerCase() === search.toLowerCase()
              ) && (
                <button
                  onClick={handleCustom}
                  className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors font-medium"
                >
                  + Use "{search}"
                </button>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Dual-path recompute ──
function recompute(
  items: LineItem[],
  currency: "INR" | "USD" | "EUR",
  gstPercent: number,
  gstType: "IGST" | "CGST_SGST",
  taxPercent: number,
  taxLabel: string,
  discountType: "percent" | "amount" | "none",
  discountValue: number
) {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const discountAmount =
    discountType === "percent"
      ? Math.round((subtotal * discountValue) / 100)
      : discountType === "amount"
      ? Math.min(discountValue, subtotal)
      : 0;
  const taxableAmount = subtotal - discountAmount;

  if (currency === "INR") {
    const gstAmount = Math.round((taxableAmount * gstPercent) / 100);
    const cgstAmount = gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0;
    const sgstAmount = gstType === "CGST_SGST" ? gstAmount - cgstAmount : 0;
    const igstAmount = gstType === "IGST" ? gstAmount : 0;
    return {
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
    const taxAmount = Math.round((taxableAmount * taxPercent) / 100);
    const resolvedLabel = taxLabel || (currency === "EUR" ? "VAT" : "Tax");
    return {
      subtotal,
      discountAmount,
      taxableAmount,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxPercent,
      taxAmount,
      taxLabel: resolvedLabel,
      total: taxableAmount + taxAmount,
    };
  }
}

function termsToISO(terms: number, invoiceDate?: string): string {
  const base = invoiceDate ? new Date(invoiceDate) : new Date();
  return new Date(base.getTime() + terms * 86400000)
    .toISOString()
    .split("T")[0];
}

function isoToTerms(iso: string, invoiceDate?: string): number {
  const base = invoiceDate ? new Date(invoiceDate) : new Date();
  return Math.max(
    0,
    Math.round((new Date(iso).getTime() - base.getTime()) / 86400000)
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-1 mt-1">
      <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
      <p className="text-xs text-red-500">{message}</p>
    </div>
  );
}

function FieldWrapper({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </Label>
      </div>
      {children}
    </div>
  );
}

export function EditInvoiceModal({
  invoice,
  onSave,
  onClose,
}: EditInvoiceModalProps) {
  const { user } = useUser();

  const currency = invoice.currency ?? "INR";
  const isINR = currency === "INR";
  const symbol = getCurrencySymbol(currency);
  const fmt = (amount: number) => formatCurrency(amount, currency);

  const [form, setForm] = useState({
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail || "",
    clientAddress: invoice.clientAddress || "",
    clientCity: invoice.clientCity || "",
    clientState: invoice.clientState || "",
    clientPincode: invoice.clientPincode || "",
    lineItems: (invoice.lineItems || []) as LineItem[],
    paymentTermsDays: invoice.paymentTermsDays || 15,
    // INR GST
    gstPercent: isINR ? (invoice.gstAmount === 0 ? 0 : invoice.gstPercent) : 0,
    gstType: (invoice.gstType || "CGST_SGST") as "IGST" | "CGST_SGST",
    gstAmount: isINR ? invoice.gstAmount : 0,
    cgstAmount: isINR ? invoice.cgstAmount || 0 : 0,
    sgstAmount: isINR ? invoice.sgstAmount || 0 : 0,
    igstAmount: isINR ? invoice.igstAmount || 0 : 0,
    // USD/EUR Tax
    taxPercent: !isINR ? invoice.taxPercent || 0 : 0,
    taxAmount: !isINR ? invoice.taxAmount || 0 : 0,
    taxLabel: !isINR
      ? invoice.taxLabel || (currency === "EUR" ? "VAT" : "Tax")
      : "",
    // Common
    discountType: (invoice.discountType || "none") as
      | "percent"
      | "amount"
      | "none",
    discountValue: invoice.discountValue || 0,
    discountAmount: invoice.discountAmount || 0,
    notes: invoice.notes || "",
    subtotal: invoice.subtotal,
    taxableAmount: invoice.taxableAmount || invoice.subtotal,
    total: invoice.total,
    dueDate: invoice.dueDate
      ? new Date(invoice.dueDate).toISOString().split("T")[0]
      : termsToISO(invoice.paymentTermsDays || 15),
    status: invoice.status,
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);

  useEffect(() => {
    if (!user || !invoice.clientName) return;
    setClientLoading(true);
    getClientByName(user.id, invoice.clientName)
      .then((client) => {
        if (!client) return;
        setForm((prev) => ({
          ...prev,
          clientEmail: prev.clientEmail || client.email || "",
          clientAddress: prev.clientAddress || client.address || "",
          clientCity: prev.clientCity || client.city || "",
          clientState: prev.clientState || client.state || "",
          clientPincode: prev.clientPincode || client.pincode || "",
        }));
      })
      .catch(() => {})
      .finally(() => setClientLoading(false));
  }, [user?.id, invoice.clientName]);

  const markTouched = (field: string) =>
    setTouched((p) => ({ ...p, [field]: true }));

  const markAllTouched = () => {
    const fields: Record<string, boolean> = {
      clientName: true,
      clientEmail: true,
      clientPincode: true,
      gstPercent: true,
      paymentTermsDays: true,
    };
    form.lineItems.forEach((_, i) => {
      ["description", "quantity", "rate", "unit", "hsnSacCode"].forEach((f) => {
        fields[`item_${i}_${f}`] = true;
      });
    });
    setTouched(fields);
  };

  const errors: ValidationErrors = (() => {
    const errs: ValidationErrors = {};
    if (!form.clientName.trim() || form.clientName.trim().length < 2)
      errs.clientName = "Client name must be at least 2 characters";
    if (form.clientEmail && !isValidEmail(form.clientEmail))
      errs.clientEmail = "Enter a valid email address";
    if (form.clientPincode && !/^[1-9][0-9]{5}$/.test(form.clientPincode))
      errs.clientPincode = "Enter a valid 6-digit pincode";
    if (isINR) {
      const gst = Number(form.gstPercent);
      if (isNaN(gst) || gst < 0 || gst > 100)
        errs.gstPercent = "GST must be 0–100";
    }
    const terms = Number(form.paymentTermsDays);
    if (isNaN(terms) || terms < 0 || terms > 365)
      errs.paymentTermsDays = "Must be 0–365 days";
    if (form.lineItems.length === 0)
      errs.lineItems = "At least one line item is required";
    const lineItemErrors = form.lineItems.map((item) => {
      const e: NonNullable<ValidationErrors["lineItemErrors"]>[number] = {};
      if (!String(item.description ?? "").trim())
        e.description = "Description required";
      if (item.quantity <= 0) e.quantity = "Must be > 0";
      if (item.quantity > 100000) e.quantity = "Must be ≤ 100,000";
      if (item.rate < 0) e.rate = "Must be ≥ 0";
      if (item.rate > 10000000) e.rate = "Must be ≤ 1 Cr";
      if (!item.unit?.trim()) e.unit = "Unit required";
      if (item.hsnSacCode && !/^\d{4,8}$/.test(item.hsnSacCode))
        e.hsnSacCode = "4–8 digits only";
      return e;
    });
    if (lineItemErrors.some((e) => Object.keys(e).length > 0))
      errs.lineItemErrors = lineItemErrors;
    return errs;
  })();

  const isValid =
    !errors.clientName &&
    !errors.clientEmail &&
    !errors.clientPincode &&
    !errors.gstPercent &&
    !errors.paymentTermsDays &&
    !errors.lineItems &&
    !errors.lineItemErrors;

  // ── Unified recalc helper ──
  const recalc = (
    items = form.lineItems,
    gstPercent = form.gstPercent,
    gstType = form.gstType,
    taxPercent = form.taxPercent,
    taxLabel = form.taxLabel,
    discountType = form.discountType,
    discountValue = form.discountValue
  ) =>
    recompute(
      items,
      currency,
      gstPercent,
      gstType,
      taxPercent,
      taxLabel,
      discountType,
      discountValue
    );

  const handleLineItemChange = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    markTouched(`item_${index}_${field}`);
    const updated = form.lineItems.map((item, i) => {
      if (i !== index) return item;
      const next = {
        ...item,
        [field]:
          field === "description" ||
          field === "unit" ||
          field === "hsnSacCode" ||
          field === "hsnSacType"
            ? value
            : value === ""
            ? 0
            : Math.max(0, Number(value)),
      };
      if (field === "quantity" || field === "rate") {
        next.amount = Math.round(
          Math.max(0, Number(next.quantity)) * Math.max(0, Number(next.rate))
        );
      }
      return next;
    });
    setForm({ ...form, lineItems: updated, ...recalc(updated) });
  };

  const addLineItem = () => {
    const updated = [
      ...form.lineItems,
      {
        description: "",
        quantity: 1,
        unit: "item",
        rate: 0,
        amount: 0,
        hsnSacCode: "",
        hsnSacType: "SAC" as const,
      },
    ];
    setForm({ ...form, lineItems: updated, ...recalc(updated) });
  };

  const removeLineItem = (index: number) => {
    const updated = form.lineItems.filter((_, i) => i !== index);
    setForm({ ...form, lineItems: updated, ...recalc(updated) });
  };

  const setGstPercent = (val: number) =>
    setForm({ ...form, gstPercent: val, ...recalc(undefined, val) });
  const setGstType = (val: "IGST" | "CGST_SGST") =>
    setForm({ ...form, gstType: val, ...recalc(undefined, undefined, val) });
  const setTaxPercent = (val: number) =>
    setForm({
      ...form,
      ...recalc(undefined, undefined, undefined, val),
    });
  const setDiscountType = (val: "percent" | "amount" | "none") => {
    const dv = val === "none" ? 0 : form.discountValue;
    setForm({
      ...form,
      discountType: val,
      discountValue: dv,
      ...recalc(undefined, undefined, undefined, undefined, undefined, val, dv),
    });
  };
  const setDiscountValue = (val: number) =>
    setForm({
      ...form,
      discountValue: val,
      ...recalc(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        form.discountType,
        val
      ),
    });

  const handlePaymentTermsChange = (days: number) => {
    setForm({ ...form, paymentTermsDays: days, dueDate: termsToISO(days) });
  };
  const handleDueDateChange = (iso: string) => {
    setForm({ ...form, dueDate: iso, paymentTermsDays: isoToTerms(iso) });
  };

  const handleSave = async () => {
    markAllTouched();
    if (!isValid) return;
    setSaving(true);
    try {
      await onSave(invoice._id, form);
      toast.success("Invoice updated successfully!");
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
      toast.error("Failed to update invoice");
    } finally {
      setSaving(false);
    }
  };

  const showCgstSgst = form.gstType === "CGST_SGST";

  return (
    <Dialog open={true} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="max-w-lg p-0 gap-0 rounded-2xl overflow-hidden [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-gray-100 space-y-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold text-gray-900">
                Edit Invoice
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-400 mt-0.5">
                {invoice.invoiceNumber}
                {clientLoading && (
                  <span className="ml-2 text-indigo-400">
                    · Loading client details...
                  </span>
                )}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="w-8 h-8 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="px-6 py-5 space-y-5">
            {/* ── CLIENT DETAILS ── */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                Client Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <FieldWrapper label="Client Name *">
                    <Input
                      value={form.clientName}
                      onChange={(e) =>
                        setForm({ ...form, clientName: e.target.value })
                      }
                      onBlur={() => markTouched("clientName")}
                      placeholder="Enter client name"
                      className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                        touched.clientName && errors.clientName
                          ? "border-red-300"
                          : ""
                      }`}
                    />
                    {touched.clientName && (
                      <FieldError message={errors.clientName} />
                    )}
                  </FieldWrapper>
                </div>

                <div className="col-span-2">
                  <FieldWrapper label="Client Email">
                    <Input
                      value={form.clientEmail}
                      onChange={(e) =>
                        setForm({ ...form, clientEmail: e.target.value })
                      }
                      onBlur={() => markTouched("clientEmail")}
                      placeholder={
                        clientLoading ? "Loading..." : "Enter client email"
                      }
                      disabled={clientLoading}
                      className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                        touched.clientEmail && errors.clientEmail
                          ? "border-red-300"
                          : ""
                      }`}
                    />
                    {touched.clientEmail && (
                      <FieldError message={errors.clientEmail} />
                    )}
                  </FieldWrapper>
                </div>

                <div className="col-span-2">
                  <FieldWrapper label="Address">
                    <Input
                      value={form.clientAddress}
                      onChange={(e) =>
                        setForm({ ...form, clientAddress: e.target.value })
                      }
                      placeholder={
                        clientLoading ? "Loading..." : "Enter address"
                      }
                      disabled={clientLoading}
                      className="rounded-xl text-sm focus-visible:ring-indigo-400"
                    />
                  </FieldWrapper>
                </div>

                <div>
                  <FieldWrapper label="City">
                    <Input
                      value={form.clientCity}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          clientCity: e.target.value.replace(
                            /[^a-zA-Z\s]/g,
                            ""
                          ),
                        })
                      }
                      placeholder={clientLoading ? "Loading..." : "Enter city"}
                      disabled={clientLoading}
                      className="rounded-xl text-sm focus-visible:ring-indigo-400"
                    />
                  </FieldWrapper>
                </div>

                <div>
                  <FieldWrapper label="State">
                    <Input
                      value={form.clientState}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          clientState: e.target.value.replace(
                            /[^a-zA-Z\s]/g,
                            ""
                          ),
                        })
                      }
                      placeholder={clientLoading ? "Loading..." : "Enter state"}
                      disabled={clientLoading}
                      className="rounded-xl text-sm focus-visible:ring-indigo-400"
                    />
                  </FieldWrapper>
                </div>

                <div>
                  <FieldWrapper label="Pincode">
                    <>
                      <Input
                        value={form.clientPincode}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            clientPincode: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 6),
                          })
                        }
                        onBlur={() => markTouched("clientPincode")}
                        placeholder={
                          clientLoading ? "Loading..." : "Enter pincode"
                        }
                        disabled={clientLoading}
                        maxLength={6}
                        className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                          touched.clientPincode && errors.clientPincode
                            ? "border-red-300"
                            : ""
                        }`}
                      />
                      {touched.clientPincode && (
                        <FieldError message={errors.clientPincode} />
                      )}
                    </>
                  </FieldWrapper>
                </div>
              </div>
            </div>

            {/* ── LINE ITEMS ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Line Items
                </p>
                {touched.lineItems && errors.lineItems && (
                  <span className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errors.lineItems}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {form.lineItems.map((item, index) => {
                  const itemErr = errors.lineItemErrors?.[index];
                  const iDesc = touched[`item_${index}_description`];
                  const iQty = touched[`item_${index}_quantity`];
                  const iRate = touched[`item_${index}_rate`];
                  const iUnit = touched[`item_${index}_unit`];
                  const iHsn = touched[`item_${index}_hsnSacCode`];

                  return (
                    <div
                      key={index}
                      className={`bg-gray-50 rounded-xl p-3 border space-y-2 ${
                        itemErr && Object.keys(itemErr).length > 0
                          ? "border-red-100"
                          : "border-gray-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Input
                            value={String(item.description ?? "")}
                            onChange={(e) =>
                              handleLineItemChange(
                                index,
                                "description",
                                e.target.value
                              )
                            }
                            onBlur={() =>
                              markTouched(`item_${index}_description`)
                            }
                            placeholder="Enter description"
                            className={`rounded-lg text-sm bg-white focus-visible:ring-indigo-400 ${
                              iDesc && itemErr?.description
                                ? "border-red-300"
                                : ""
                            }`}
                          />
                          {iDesc && (
                            <FieldError message={itemErr?.description} />
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(index)}
                          className="w-8 h-8 text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      {/* HSN/SAC — INR only */}
                      {isINR && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">
                            HSN/SAC Code
                          </p>
                          <div className="flex gap-1">
                            <div className="flex-1">
                              <Input
                                value={item.hsnSacCode || ""}
                                onChange={(e) =>
                                  handleLineItemChange(
                                    index,
                                    "hsnSacCode",
                                    e.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 8)
                                  )
                                }
                                onBlur={() =>
                                  markTouched(`item_${index}_hsnSacCode`)
                                }
                                placeholder="Enter HSN/SAC code"
                                maxLength={8}
                                className={`rounded-lg text-xs bg-white focus-visible:ring-indigo-400 h-8 ${
                                  iHsn && itemErr?.hsnSacCode
                                    ? "border-red-300"
                                    : ""
                                }`}
                              />
                              {iHsn && (
                                <FieldError message={itemErr?.hsnSacCode} />
                              )}
                            </div>
                            <div className="flex gap-1">
                              {(["HSN", "SAC"] as const).map((type) => (
                                <button
                                  key={type}
                                  onClick={() =>
                                    handleLineItemChange(
                                      index,
                                      "hsnSacType",
                                      type
                                    )
                                  }
                                  className={`px-2 h-8 rounded-lg text-[10px] font-bold border transition-all ${
                                    (item.hsnSacType || "SAC") === type
                                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                      : "bg-gray-50 border-gray-200 text-gray-400"
                                  }`}
                                >
                                  {type}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Qty</p>
                          <Input
                            type="number"
                            min={0}
                            max={100000}
                            value={item.quantity === 0 ? "" : item.quantity}
                            onChange={(e) =>
                              handleLineItemChange(
                                index,
                                "quantity",
                                e.target.value === ""
                                  ? 0
                                  : Math.min(
                                      100000,
                                      Math.max(0, Number(e.target.value))
                                    )
                              )
                            }
                            onBlur={() => markTouched(`item_${index}_quantity`)}
                            className={`rounded-lg text-sm bg-white focus-visible:ring-indigo-400 h-8 ${
                              iQty && itemErr?.quantity ? "border-red-300" : ""
                            }`}
                          />
                          {iQty && <FieldError message={itemErr?.quantity} />}
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Unit</p>
                          <UnitSelector
                            value={item.unit || "item"}
                            onChange={(v) => {
                              markTouched(`item_${index}_unit`);
                              handleLineItemChange(index, "unit", v);
                            }}
                          />
                          {iUnit && <FieldError message={itemErr?.unit} />}
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">
                            Rate ({symbol})
                          </p>
                          <Input
                            type="number"
                            min={0}
                            max={10000000}
                            value={item.rate === 0 ? "" : item.rate}
                            onChange={(e) =>
                              handleLineItemChange(
                                index,
                                "rate",
                                e.target.value === ""
                                  ? 0
                                  : Math.min(
                                      10000000,
                                      Math.max(0, Number(e.target.value))
                                    )
                              )
                            }
                            onBlur={() => markTouched(`item_${index}_rate`)}
                            placeholder="Rate"
                            className={`rounded-lg text-sm bg-white focus-visible:ring-indigo-400 h-8 ${
                              iRate && itemErr?.rate ? "border-red-300" : ""
                            }`}
                          />
                          {iRate && <FieldError message={itemErr?.rate} />}
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Amount</p>
                          <div className="h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center px-2">
                            <span className="text-xs font-semibold text-indigo-700">
                              {fmt(item.amount)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <Button
                  variant="outline"
                  onClick={addLineItem}
                  className="w-full border-dashed rounded-xl text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-500 h-9"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add line item
                </Button>
              </div>
            </div>

            {/* ── INVOICE SETTINGS ── */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                Invoice Settings
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* GST — INR only */}
                {isINR && (
                  <>
                    <FieldWrapper label="GST %">
                      <>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={form.gstPercent === 0 ? "" : form.gstPercent}
                          onChange={(e) =>
                            setGstPercent(
                              e.target.value === ""
                                ? 0
                                : Math.min(
                                    100,
                                    Math.max(0, Number(e.target.value))
                                  )
                            )
                          }
                          onBlur={() => markTouched("gstPercent")}
                          placeholder="Enter GST"
                          className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                            touched.gstPercent && errors.gstPercent
                              ? "border-red-300"
                              : ""
                          }`}
                        />
                        {touched.gstPercent && (
                          <FieldError message={errors.gstPercent} />
                        )}
                      </>
                    </FieldWrapper>

                    <FieldWrapper label="GST Type">
                      <div className="flex gap-2">
                        {(["CGST_SGST", "IGST"] as const).map((type) => (
                          <button
                            key={type}
                            onClick={() => setGstType(type)}
                            className={`flex-1 h-9 rounded-xl text-xs font-semibold border transition-all ${
                              form.gstType === type
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                            }`}
                          >
                            {type === "CGST_SGST" ? "CGST + SGST" : "IGST"}
                          </button>
                        ))}
                      </div>
                    </FieldWrapper>
                  </>
                )}

                {/* Tax % — USD/EUR only */}
                {!isINR && (
                  <div className="col-span-2">
                    <FieldWrapper
                      label={currency === "EUR" ? "VAT %" : "Tax %"}
                    >
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={form.taxPercent === 0 ? "" : form.taxPercent}
                        onChange={(e) =>
                          setTaxPercent(
                            e.target.value === ""
                              ? 0
                              : Math.min(
                                  100,
                                  Math.max(0, Number(e.target.value))
                                )
                          )
                        }
                        placeholder={`Enter ${
                          currency === "EUR" ? "VAT" : "Tax"
                        } %`}
                        className="rounded-xl text-sm focus-visible:ring-indigo-400"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Leave 0 for tax-exempt invoices
                      </p>
                    </FieldWrapper>
                  </div>
                )}

                <FieldWrapper label="Payment Terms (days)">
                  <>
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={
                        form.paymentTermsDays === 0 ? "" : form.paymentTermsDays
                      }
                      onChange={(e) =>
                        handlePaymentTermsChange(
                          e.target.value === ""
                            ? 0
                            : Math.min(365, Math.max(0, Number(e.target.value)))
                        )
                      }
                      onBlur={() => markTouched("paymentTermsDays")}
                      placeholder="Enter payment terms"
                      className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                        touched.paymentTermsDays && errors.paymentTermsDays
                          ? "border-red-300"
                          : ""
                      }`}
                    />
                    {touched.paymentTermsDays && (
                      <FieldError message={errors.paymentTermsDays} />
                    )}
                  </>
                </FieldWrapper>

                <FieldWrapper label="Due Date">
                  <Input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    className="rounded-xl text-sm focus-visible:ring-indigo-400"
                  />
                </FieldWrapper>

                <div className="col-span-2">
                  <FieldWrapper label="Discount">
                    <div className="flex gap-2">
                      {(["none", "percent", "amount"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setDiscountType(type)}
                          className={`px-3 h-9 rounded-xl text-xs font-semibold border transition-all ${
                            form.discountType === type
                              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                              : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                          }`}
                        >
                          {type === "none"
                            ? "No discount"
                            : type === "percent"
                            ? "%"
                            : `${symbol} Fixed`}
                        </button>
                      ))}
                      {form.discountType !== "none" && (
                        <Input
                          type="number"
                          min={0}
                          value={form.discountValue || ""}
                          onChange={(e) =>
                            setDiscountValue(
                              Math.max(0, Number(e.target.value))
                            )
                          }
                          placeholder={
                            form.discountType === "percent"
                              ? "Enter %"
                              : "Enter amount"
                          }
                          className="flex-1 rounded-xl text-sm h-9 focus-visible:ring-indigo-400"
                        />
                      )}
                    </div>
                  </FieldWrapper>
                </div>
              </div>
            </div>

            {/* ── TOTALS ── */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium text-gray-700">
                  {fmt(form.subtotal)}
                </span>
              </div>
              {form.discountType !== "none" && form.discountAmount > 0 && (
                <>
                  <div className="flex justify-between text-xs text-emerald-600">
                    <span>
                      Discount
                      {form.discountType === "percent"
                        ? ` (${form.discountValue}%)`
                        : ""}
                    </span>
                    <span className="font-medium">
                      − {fmt(form.discountAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Taxable Amount</span>
                    <span className="font-medium text-gray-700">
                      {fmt(form.taxableAmount)}
                    </span>
                  </div>
                </>
              )}

              {/* GST rows — INR only */}
              {isINR &&
                form.gstAmount > 0 &&
                (showCgstSgst ? (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">
                        CGST ({form.gstPercent / 2}%)
                      </span>
                      <span className="font-medium text-gray-700">
                        {fmt(form.cgstAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">
                        SGST ({form.gstPercent / 2}%)
                      </span>
                      <span className="font-medium text-gray-700">
                        {fmt(form.sgstAmount)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">
                      IGST ({form.gstPercent}%)
                    </span>
                    <span className="font-medium text-gray-700">
                      {fmt(form.igstAmount)}
                    </span>
                  </div>
                ))}

              {/* Tax/VAT row — USD/EUR only */}
              {!isINR && form.taxAmount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">
                    {form.taxLabel || (currency === "EUR" ? "VAT" : "Tax")}
                    {form.taxPercent > 0 ? ` (${form.taxPercent}%)` : ""}
                  </span>
                  <span className="font-medium text-gray-700">
                    {fmt(form.taxAmount)}
                  </span>
                </div>
              )}

              <Separator className="my-1" />
              <div className="flex justify-between text-sm font-bold">
                <span className="text-gray-900">Total</span>
                <span className="text-indigo-600">{fmt(form.total)}</span>
              </div>
            </div>

            {/* ── NOTES ── */}
            <FieldWrapper label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Payment instructions, bank details, late payment terms..."
                rows={3}
                className="w-full rounded-xl text-sm border border-gray-200 bg-gray-50 px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 resize-none"
              />
            </FieldWrapper>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 rounded-xl font-semibold"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" /> Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
