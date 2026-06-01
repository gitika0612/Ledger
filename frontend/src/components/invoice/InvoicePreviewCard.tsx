import { useState, useEffect, useMemo, useRef } from "react";
import {
  Check,
  Edit2,
  Plus,
  Send,
  Trash2,
  Zap,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { DownloadPDFButton } from "./pdf/DownloadPDFButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, UserProfile } from "@/hooks/useAuth";
import { getClientByName, upsertClient, ClientAPI } from "@/lib/api/clientApi";
import { useUser } from "@clerk/clerk-react";
import { updateInvoice } from "@/lib/api/invoiceApi";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency";

export interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  hsnSacCode?: string;
  hsnSacType?: "HSN" | "SAC";
}

export interface ParsedInvoice {
  clientName: string;
  lineItems: LineItem[];
  gstPercent: number;
  gstType?: "IGST" | "CGST_SGST";
  cgstPercent?: number;
  sgstPercent?: number;
  igstPercent?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount: number;
  // USD/EUR Tax fields
  taxPercent?: number;
  taxAmount?: number;
  taxLabel?: string;
  discountType?: "percent" | "amount" | "none";
  discountValue?: number;
  discountAmount?: number;
  placeOfSupply?: string;
  notes?: string;
  subtotal: number;
  taxableAmount?: number;
  total: number;
  paymentTermsDays: number;
  invoiceDate?: string;
  invoiceMonth?: string;
  currency?: "INR" | "USD" | "EUR";
}

interface InvoicePreviewCardProps {
  invoice: ParsedInvoice;
  onConfirm: (invoice: ParsedInvoice) => void;
  onEdit: (invoice: ParsedInvoice) => void;
  onDiscard: () => void;
  onSend?: () => void;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  invoiceNumber?: string;
  invoiceId?: string;
  userName?: string;
}

interface ValidationErrors {
  clientName?: string;
  email?: string;
  gstPercent?: string;
  paymentTermsDays?: string;
  lineItems?: string;
  lineItemErrors?: {
    description?: string;
    quantity?: string;
    rate?: string;
    hsnSacCode?: string;
    unit?: string;
  }[];
  clientAddress?: string;
  clientCity?: string;
  clientState?: string;
  clientPincode?: string;
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
        className="w-full h-8 rounded-lg bg-gray-50 border border-gray-200 px-2 text-xs font-medium text-gray-700 flex items-center justify-between gap-1 hover:border-indigo-300 transition-all"
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
            {filtered.length === 0 && !search.trim() && (
              <p className="px-3 py-2 text-xs text-gray-400">No units found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCurrency(
  amount: number,
  currency?: "INR" | "USD" | "EUR"
): string {
  return formatCurrencyUtil(amount, currency ?? "INR");
}

function getInvoiceDates(invoice: ParsedInvoice) {
  const issueDate = invoice.invoiceDate
    ? new Date(invoice.invoiceDate)
    : new Date();
  const dueDate = new Date(
    issueDate.getTime() + (invoice.paymentTermsDays || 15) * 24 * 60 * 60 * 1000
  );
  return {
    issueDate: issueDate.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    dueDate: dueDate.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    dueDateISO: dueDate.toISOString().split("T")[0],
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

function effectiveGstPercent(invoice: ParsedInvoice): number {
  if (invoice.gstAmount === 0 && invoice.subtotal > 0) return 0;
  return invoice.gstPercent ?? 18;
}

function recalculateInvoiceTotals(invoice: ParsedInvoice): ParsedInvoice {
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
    // ── INR: GST path ──
    const gstAmount = Math.round(
      (taxableAmount * (invoice.gstPercent ?? 0)) / 100
    );
    const gstType = invoice.gstType || "CGST_SGST";
    const cgstAmount = gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0;
    const sgstAmount = gstType === "CGST_SGST" ? gstAmount - cgstAmount : 0;
    const igstAmount = gstType === "IGST" ? gstAmount : 0;
    const cgstPercent =
      gstType === "CGST_SGST" ? (invoice.gstPercent ?? 0) / 2 : 0;
    const sgstPercent =
      gstType === "CGST_SGST" ? (invoice.gstPercent ?? 0) / 2 : 0;
    const igstPercent = gstType === "IGST" ? invoice.gstPercent ?? 0 : 0;
    return {
      ...invoice,
      subtotal,
      discountAmount,
      taxableAmount,
      gstAmount,
      gstType,
      cgstPercent,
      sgstPercent,
      igstPercent,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      total: taxableAmount + gstAmount,
    };
  } else {
    // ── USD/EUR: Tax/VAT path ──
    const taxPercent = invoice.taxPercent ?? 0;
    const taxAmount = Math.round((taxableAmount * taxPercent) / 100);
    const taxLabel = invoice.taxLabel || (currency === "EUR" ? "VAT" : "Tax");
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

function dueDateToTerms(
  invoiceDate: string | undefined,
  dueISO: string
): number {
  const base = invoiceDate ? new Date(invoiceDate) : new Date();
  const due = new Date(dueISO);
  const diff = Math.round(
    (due.getTime() - base.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(0, diff);
}

function termsToISODueDate(
  invoiceDate: string | undefined,
  terms: number
): string {
  const base = invoiceDate ? new Date(invoiceDate) : new Date();
  const due = new Date(base.getTime() + terms * 24 * 60 * 60 * 1000);
  return due.toISOString().split("T")[0];
}

export function InvoicePreviewCard({
  invoice,
  onConfirm,
  onEdit,
  onDiscard,
  onSend,
  status,
  invoiceNumber,
  invoiceId,
  userName,
}: InvoicePreviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedInvoice, setEditedInvoice] = useState<ParsedInvoice>({
    ...invoice,
    gstPercent: effectiveGstPercent(invoice),
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [client, setClient] = useState<ClientAPI | null>(null);
  const [editedClientName, setEditedClientName] = useState("");
  const [editedClientEmail, setEditedClientEmail] = useState("");
  const [editedClientAddress, setEditedClientAddress] = useState("");
  const [editedClientCity, setEditedClientCity] = useState("");
  const [editedClientState, setEditedClientState] = useState("");
  const [editedClientPincode, setEditedClientPincode] = useState("");
  const [dueDateISO, setDueDateISO] = useState(
    termsToISODueDate(invoice.invoiceDate, invoice.paymentTermsDays || 15)
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const { getUserProfile } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    getUserProfile().then(setProfile);
  }, []);

  useEffect(() => {
    if (!user || !invoice.clientName) return;
    getClientByName(user.id, invoice.clientName).then((c) => {
      setClient(c);
      setEditedClientName(c?.name || invoice.clientName);
      setEditedClientEmail(c?.email || "");
      setEditedClientAddress(c?.address || "");
      setEditedClientCity(c?.city || "");
      setEditedClientState(c?.state || "");
      setEditedClientPincode(c?.pincode || "");
    });
  }, [invoice.clientName, user?.id]);

  const errors = useMemo((): ValidationErrors => {
    const errs: ValidationErrors = {};
    if (!editedClientName.trim() || editedClientName.trim().length < 2)
      errs.clientName = "Client name must be at least 2 characters";
    if (editedClientEmail && !isValidEmail(editedClientEmail))
      errs.email = "Enter a valid email address";
    if (editedClientPincode && !/^[1-9][0-9]{5}$/.test(editedClientPincode))
      errs.clientPincode = "Enter a valid 6-digit pincode";
    const gst = Number(editedInvoice.gstPercent);
    if (isNaN(gst) || gst < 0 || gst > 100)
      errs.gstPercent = "GST must be 0–100";
    const terms = Number(editedInvoice.paymentTermsDays);
    if (isNaN(terms) || terms < 0 || terms > 365)
      errs.paymentTermsDays = "Payment terms must be 0–365 days";
    if (editedInvoice.lineItems.length === 0)
      errs.lineItems = "At least one line item is required";
    const lineItemErrors = editedInvoice.lineItems.map((item) => {
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
  }, [editedClientName, editedClientEmail, editedClientPincode, editedInvoice]);

  const isValid = useMemo(
    () =>
      !errors.clientName &&
      !errors.email &&
      !errors.clientPincode &&
      !errors.gstPercent &&
      !errors.paymentTermsDays &&
      !errors.lineItems &&
      !errors.lineItemErrors,
    [errors]
  );

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const markAllTouched = () => {
    const fields: Record<string, boolean> = {
      clientName: true,
      email: true,
      gstPercent: true,
      paymentTermsDays: true,
      clientPincode: true,
    };
    editedInvoice.lineItems.forEach((_, i) => {
      fields[`item_${i}_description`] = true;
      fields[`item_${i}_quantity`] = true;
      fields[`item_${i}_rate`] = true;
      fields[`item_${i}_unit`] = true;
      fields[`item_${i}_hsnSacCode`] = true;
    });
    setTouched(fields);
  };

  const handleLineItemChange = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    markTouched(`item_${index}_${field}`);
    const items = editedInvoice.lineItems.map((item, i) => {
      if (i !== index) return item;
      const updated = {
        ...item,
        [field]:
          field === "description" ||
          field === "unit" ||
          field === "hsnSacCode" ||
          field === "hsnSacType"
            ? value
            : value === "" || value === undefined
            ? 0
            : Math.max(0, Number(value)),
      };
      if (field === "quantity" || field === "rate") {
        updated.amount = Math.round(
          Math.max(0, Number(updated.quantity)) *
            Math.max(0, Number(updated.rate))
        );
      }
      return updated;
    });
    setEditedInvoice(
      recalculateInvoiceTotals({ ...editedInvoice, lineItems: items })
    );
  };

  const handleFieldChange = (
    field: keyof ParsedInvoice,
    value: string | number | boolean | LineItem[]
  ) => {
    const next = recalculateInvoiceTotals({ ...editedInvoice, [field]: value });
    setEditedInvoice(next);
    if (field === "paymentTermsDays") {
      setDueDateISO(
        termsToISODueDate(editedInvoice.invoiceDate, Number(value))
      );
    }
  };

  const handleDueDateChange = (iso: string) => {
    setDueDateISO(iso);
    const terms = dueDateToTerms(editedInvoice.invoiceDate, iso);
    setEditedInvoice(
      recalculateInvoiceTotals({ ...editedInvoice, paymentTermsDays: terms })
    );
  };

  const handleSaveChanges = async () => {
    markAllTouched();
    if (!isValid) return;
    setIsEditing(false);
    setTouched({});

    const finalInvoice = recalculateInvoiceTotals({
      ...editedInvoice,
      clientName: editedClientName || editedInvoice.clientName,
    });

    if (invoiceId) {
      try {
        await updateInvoice(invoiceId, finalInvoice);
      } catch (err) {
        console.error("Failed to update invoice in DB:", err);
      }
    }

    onEdit(finalInvoice);

    if (user) {
      try {
        const updated = await upsertClient(user.id, {
          name: editedClientName || editedInvoice.clientName,
          email: editedClientEmail,
          address: editedClientAddress,
          city: editedClientCity,
          state: editedClientState,
          pincode: editedClientPincode,
          phone: client?.phone || "",
          gstin: client?.gstin || "",
        });
        setClient(updated);
      } catch (err) {
        console.error("Failed to update client:", err);
      }
    }
  };

  const current = isEditing ? editedInvoice : invoice;
  const displayGst = isEditing
    ? editedInvoice.gstPercent
    : effectiveGstPercent(invoice);
  const { issueDate, dueDate } = getInvoiceDates({
    ...current,
    gstPercent: displayGst,
  });
  const senderName = profile?.businessName || userName || "Your Business";
  const displayClientName = isEditing
    ? editedClientName
    : client?.name || current.clientName;
  const displayClientEmail = isEditing ? editedClientEmail : client?.email;
  const clientAddress = isEditing ? editedClientAddress : client?.address;
  const clientLocationLine = isEditing
    ? [editedClientCity, editedClientState].filter(Boolean).join(", ")
    : [client?.city, client?.state].filter(Boolean).join(", ");
  const clientPincode = isEditing ? editedClientPincode : client?.pincode;

  const showCgstSgst = (current.gstType || "CGST_SGST") === "CGST_SGST";
  const hasDiscount =
    current.discountType &&
    current.discountType !== "none" &&
    (current.discountValue || 0) > 0;

  // Currency for display — use current invoice's currency
  const currency = current.currency ?? "INR";
  const isINR = currency === "INR";

  return (
    <div className="bg-white rounded-2xl overflow-hidden w-full border border-gray-100 shadow-sm">
      {/* ── EDIT MODE ── */}
      {isEditing && (
        <div className="p-4 border-b border-gray-100 space-y-5">
          {/* ── CLIENT DETAILS ── */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Client Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Client Name *
                </Label>
                <Input
                  value={editedClientName}
                  placeholder="Enter client name"
                  onChange={(e) => {
                    setEditedClientName(e.target.value);
                    handleFieldChange("clientName", e.target.value);
                  }}
                  onBlur={() => markTouched("clientName")}
                  className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                    touched.clientName && errors.clientName
                      ? "border-red-300"
                      : ""
                  }`}
                />
                {touched.clientName && (
                  <FieldError message={errors.clientName} />
                )}
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Client Email
                </Label>
                <Input
                  value={editedClientEmail}
                  onChange={(e) => setEditedClientEmail(e.target.value)}
                  onBlur={() => markTouched("email")}
                  placeholder="Enter email"
                  className={`rounded-xl text-sm focus-visible:ring-indigo-400 ${
                    touched.email && errors.email ? "border-red-300" : ""
                  }`}
                />
                {touched.email && <FieldError message={errors.email} />}
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Address
                </Label>
                <Input
                  value={editedClientAddress}
                  onChange={(e) => setEditedClientAddress(e.target.value)}
                  placeholder="Enter address"
                  className="rounded-xl text-sm focus-visible:ring-indigo-400"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  City
                </Label>
                <Input
                  value={editedClientCity}
                  onChange={(e) =>
                    setEditedClientCity(
                      e.target.value.replace(/[^a-zA-Z\s]/g, "")
                    )
                  }
                  placeholder="Enter city"
                  className="rounded-xl text-sm focus-visible:ring-indigo-400"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  State
                </Label>
                <Input
                  value={editedClientState}
                  onChange={(e) =>
                    setEditedClientState(
                      e.target.value.replace(/[^a-zA-Z\s]/g, "")
                    )
                  }
                  placeholder="Enter state"
                  className="rounded-xl text-sm focus-visible:ring-indigo-400"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Pincode
                </Label>
                <Input
                  value={editedClientPincode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setEditedClientPincode(v);
                  }}
                  onBlur={() => markTouched("clientPincode")}
                  placeholder="Enter pincode"
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
              </div>
            </div>
          </div>

          {/* ── INVOICE SETTINGS ── */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Invoice Settings
            </p>
            <div className="grid grid-cols-2 gap-3">
              {/* Currency badge — read only in edit mode */}
              <div className="col-span-2">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Currency
                </Label>
                <div className="flex gap-2">
                  {(["INR", "USD", "EUR"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => handleFieldChange("currency", c)}
                      className={`px-4 h-9 rounded-xl text-xs font-semibold border transition-all ${
                        (editedInvoice.currency ?? "INR") === c
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                          : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {c === "INR" ? "₹ INR" : c === "USD" ? "$ USD" : "€ EUR"}
                    </button>
                  ))}
                </div>
              </div>

              {/* GST — only for INR */}
              {(editedInvoice.currency ?? "INR") === "INR" && (
                <>
                  <div>
                    <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                      GST %
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={
                        editedInvoice.gstPercent === 0
                          ? ""
                          : editedInvoice.gstPercent
                      }
                      onChange={(e) => {
                        const v =
                          e.target.value === ""
                            ? 0
                            : Math.min(
                                100,
                                Math.max(0, Number(e.target.value))
                              );
                        handleFieldChange("gstPercent", v);
                      }}
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
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                      GST Type
                    </Label>
                    <div className="flex gap-2">
                      {(["CGST_SGST", "IGST"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => handleFieldChange("gstType", type)}
                          className={`flex-1 h-9 rounded-xl text-xs font-semibold border transition-all ${
                            (editedInvoice.gstType || "CGST_SGST") === type
                              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                              : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                          }`}
                        >
                          {type === "CGST_SGST" ? "CGST + SGST" : "IGST"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Tax % field — USD/EUR only */}
              {(editedInvoice.currency ?? "INR") !== "INR" && (
                <div className="col-span-2">
                  <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                    {editedInvoice.currency === "EUR" ? "VAT %" : "Tax %"}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      (editedInvoice.taxPercent ?? 0) === 0
                        ? ""
                        : editedInvoice.taxPercent
                    }
                    onChange={(e) => {
                      const v =
                        e.target.value === ""
                          ? 0
                          : Math.min(100, Math.max(0, Number(e.target.value)));
                      handleFieldChange("taxPercent", v);
                    }}
                    placeholder={`Enter ${
                      editedInvoice.currency === "EUR" ? "VAT" : "Tax"
                    } %`}
                    className="rounded-xl text-sm focus-visible:ring-indigo-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Leave 0 for tax-exempt invoices
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Payment Terms (days)
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={
                    editedInvoice.paymentTermsDays === 0
                      ? ""
                      : editedInvoice.paymentTermsDays
                  }
                  onChange={(e) => {
                    const v =
                      e.target.value === ""
                        ? 0
                        : Math.min(365, Math.max(0, Number(e.target.value)));
                    handleFieldChange("paymentTermsDays", v);
                  }}
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
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Due Date
                </Label>
                <Input
                  type="date"
                  value={dueDateISO}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  className="rounded-xl text-sm focus-visible:ring-indigo-400"
                />
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
                  Discount
                </Label>
                <div className="flex gap-2">
                  {(["none", "percent", "amount"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => handleFieldChange("discountType", type)}
                      className={`px-3 h-9 rounded-xl text-xs font-semibold border transition-all ${
                        (editedInvoice.discountType || "none") === type
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                          : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {type === "none"
                        ? "No discount"
                        : type === "percent"
                        ? "%"
                        : `${
                            currency === "USD"
                              ? "$"
                              : currency === "EUR"
                              ? "€"
                              : "₹"
                          } Fixed`}
                    </button>
                  ))}
                  {editedInvoice.discountType &&
                    editedInvoice.discountType !== "none" && (
                      <Input
                        type="number"
                        min={0}
                        value={editedInvoice.discountValue || ""}
                        onChange={(e) =>
                          handleFieldChange(
                            "discountValue",
                            Math.max(0, Number(e.target.value))
                          )
                        }
                        placeholder={
                          editedInvoice.discountType === "percent"
                            ? "Enter %"
                            : "Enter amount"
                        }
                        className="flex-1 rounded-xl text-sm h-9 focus-visible:ring-indigo-400"
                      />
                    )}
                </div>
              </div>
            </div>
          </div>

          {/* ── LINE ITEMS ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                Line Items
              </p>
              {errors.lineItems && (
                <span className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.lineItems}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {editedInvoice.lineItems.map((item, index) => {
                const itemErr = errors.lineItemErrors?.[index];
                const iDescTouched = touched[`item_${index}_description`];
                const iQtyTouched = touched[`item_${index}_quantity`];
                const iRateTouched = touched[`item_${index}_rate`];
                const iUnitTouched = touched[`item_${index}_unit`];
                const iHsnTouched = touched[`item_${index}_hsnSacCode`];
                return (
                  <div
                    key={index}
                    className={`bg-gray-50 rounded-xl p-3 border ${
                      itemErr && Object.keys(itemErr).length > 0
                        ? "border-red-100"
                        : "border-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
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
                            iDescTouched && itemErr?.description
                              ? "border-red-300"
                              : ""
                          }`}
                        />
                        {iDescTouched && (
                          <FieldError message={itemErr?.description} />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const items = editedInvoice.lineItems.filter(
                            (_, i) => i !== index
                          );
                          setEditedInvoice(
                            recalculateInvoiceTotals({
                              ...editedInvoice,
                              lineItems: items,
                            })
                          );
                        }}
                        className="w-8 h-8 text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* HSN/SAC — only show for INR */}
                    {(editedInvoice.currency ?? "INR") === "INR" && (
                      <div className="mb-2">
                        <p className="text-xs text-gray-400 mb-1">
                          HSN/SAC Code
                        </p>
                        <div className="flex gap-1">
                          <div className="flex-1">
                            <Input
                              value={item.hsnSacCode || ""}
                              onChange={(e) => {
                                const v = e.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 8);
                                handleLineItemChange(index, "hsnSacCode", v);
                              }}
                              onBlur={() =>
                                markTouched(`item_${index}_hsnSacCode`)
                              }
                              placeholder="Enter HSN/SAC code"
                              maxLength={8}
                              className={`rounded-lg text-xs bg-white focus-visible:ring-indigo-400 h-8 ${
                                iHsnTouched && itemErr?.hsnSacCode
                                  ? "border-red-300"
                                  : ""
                              }`}
                            />
                            {iHsnTouched && (
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
                            iQtyTouched && itemErr?.quantity
                              ? "border-red-300"
                              : ""
                          }`}
                        />
                        {iQtyTouched && (
                          <FieldError message={itemErr?.quantity} />
                        )}
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
                        {iUnitTouched && <FieldError message={itemErr?.unit} />}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-1">
                          Rate (
                          {currency === "USD"
                            ? "$"
                            : currency === "EUR"
                            ? "€"
                            : "₹"}
                          )
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
                          placeholder="Rate"
                          onBlur={() => markTouched(`item_${index}_rate`)}
                          className={`rounded-lg text-sm bg-white focus-visible:ring-indigo-400 h-8 ${
                            iRateTouched && itemErr?.rate
                              ? "border-red-300"
                              : ""
                          }`}
                        />
                        {iRateTouched && <FieldError message={itemErr?.rate} />}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Amount</p>
                        <div className="h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center px-2">
                          <span className="text-xs font-semibold text-indigo-700">
                            {formatCurrency(
                              item.amount,
                              editedInvoice.currency
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              variant="outline"
              onClick={() =>
                setEditedInvoice({
                  ...editedInvoice,
                  lineItems: [
                    ...editedInvoice.lineItems,
                    {
                      description: "",
                      quantity: 1,
                      unit: "item",
                      rate: 0,
                      amount: 0,
                      hsnSacCode: "",
                      hsnSacType: "SAC",
                    },
                  ],
                })
              }
              className="w-full mt-2 border-dashed rounded-xl text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-500 h-9"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add line item
            </Button>
          </div>

          {/* ── NOTES ── */}
          <div>
            <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">
              Notes
            </Label>
            <textarea
              value={editedInvoice.notes || ""}
              onChange={(e) => handleFieldChange("notes", e.target.value)}
              placeholder="Payment instructions, bank details, late payment terms..."
              rows={3}
              className="w-full rounded-xl text-sm border border-gray-200 bg-gray-50 px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 resize-none"
            />
          </div>

          {/* ── SAVE / CANCEL ── */}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSaveChanges}
              className="flex-1 rounded-xl gap-2 bg-indigo-600 hover:bg-indigo-700 h-10"
            >
              <Check className="w-4 h-4" />
              Save Changes
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditing(false);
                setEditedInvoice({
                  ...invoice,
                  gstPercent: effectiveGstPercent(invoice),
                });
                setEditedClientName(client?.name || invoice.clientName);
                setEditedClientEmail(client?.email || "");
                setEditedClientAddress(client?.address || "");
                setEditedClientCity(client?.city || "");
                setEditedClientState(client?.state || "");
                setEditedClientPincode(client?.pincode || "");
                setDueDateISO(
                  termsToISODueDate(
                    invoice.invoiceDate,
                    invoice.paymentTermsDays || 15
                  )
                );
                setTouched({});
              }}
              className="rounded-xl px-5"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── INVOICE DOCUMENT ── */}
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#4F46E5" }}
            >
              <Zap className="w-4 h-4 text-white" fill="white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Ledger</p>
              <p className="text-xs text-gray-400">Invoice Platform</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-gray-900 tracking-tight uppercase">
              Invoice
            </p>
            {invoiceNumber ? (
              <p className="text-xs font-semibold text-indigo-600 mt-0.5">
                {invoiceNumber}
              </p>
            ) : (
              <p className="text-xs text-gray-300 mt-0.5">Draft</p>
            )}
            {/* Currency badge */}
            {currency !== "INR" && (
              <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                {currency}
              </span>
            )}
          </div>
        </div>

        {/* From / Bill To */}
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <div className="max-w-[48%]">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
              From
            </p>
            <p className="text-sm font-bold text-gray-900">{senderName}</p>
            {profile?.address && (
              <p className="text-xs text-gray-500 mt-0.5">{profile.address}</p>
            )}
            {[profile?.city, profile?.state].filter(Boolean).join(", ") && (
              <p className="text-xs text-gray-500 mt-0.5">
                {[profile?.city, profile?.state].filter(Boolean).join(", ")}
              </p>
            )}
            {profile?.pincode && (
              <p className="text-xs text-gray-500 mt-0.5">{profile.pincode}</p>
            )}
          </div>
          <div className="text-right max-w-[48%]">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
              Bill To
            </p>
            <p className="text-sm font-bold text-gray-900">
              {displayClientName}
            </p>
            {displayClientEmail && (
              <p className="text-xs text-gray-500 mt-0.5">
                {displayClientEmail}
              </p>
            )}
            {clientAddress && (
              <p className="text-xs text-gray-500 mt-0.5">{clientAddress}</p>
            )}
            {clientLocationLine && (
              <p className="text-xs text-gray-500 mt-0.5">
                {clientLocationLine}
              </p>
            )}
            {clientPincode && (
              <p className="text-xs text-gray-500 mt-0.5">{clientPincode}</p>
            )}
          </div>
        </div>

        {/* Dates */}
        <div className="flex gap-6 flex-wrap">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Issue Date</p>
            <p className="text-xs font-semibold text-gray-800">{issueDate}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Due Date</p>
            <p className="text-xs font-semibold text-gray-800">{dueDate}</p>
          </div>
          {current.placeOfSupply && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Place of Supply</p>
              <p className="text-xs font-semibold text-gray-800">
                {current.placeOfSupply}
              </p>
            </div>
          )}
          {current.invoiceMonth && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Invoice Month</p>
              <p className="text-xs font-semibold text-gray-800">
                {current.invoiceMonth}
              </p>
            </div>
          )}
        </div>

        {/* Line items table */}
        <div>
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-100 rounded-t-xl">
            <div className="col-span-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Description
              </p>
            </div>
            {isINR && (
              <div className="col-span-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  HSN/SAC
                </p>
              </div>
            )}
            <div
              className={`${isINR ? "col-span-2" : "col-span-3"} text-center`}
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Qty
              </p>
            </div>
            <div
              className={`${isINR ? "col-span-2" : "col-span-2"} text-right`}
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Rate
              </p>
            </div>
            <div
              className={`${isINR ? "col-span-2" : "col-span-3"} text-right`}
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Amount
              </p>
            </div>
          </div>
          <div className="border border-t-0 border-gray-100 rounded-b-xl overflow-hidden divide-y divide-gray-50">
            {current.lineItems?.map((item, index) => (
              <div
                key={index}
                className="grid grid-cols-12 gap-2 px-3 py-3 bg-white"
              >
                <div className="col-span-4">
                  <p className="text-sm text-gray-800 font-medium">
                    {String(item.description ?? "")}
                  </p>
                  {item.unit && item.unit !== "item" && (
                    <p className="text-xs text-gray-400 mt-0.5">{item.unit}</p>
                  )}
                </div>
                {isINR && (
                  <div className="col-span-2">
                    {item.hsnSacCode ? (
                      <span className="text-xs font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        {item.hsnSacCode}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </div>
                )}
                <div
                  className={`${
                    isINR ? "col-span-2" : "col-span-3"
                  } text-center`}
                >
                  <p className="text-sm text-gray-600">{item.quantity}</p>
                </div>
                <div
                  className={`${
                    isINR ? "col-span-2" : "col-span-2"
                  } text-right`}
                >
                  <p className="text-sm text-gray-600">
                    {formatCurrency(item.rate, currency)}
                  </p>
                </div>
                <div
                  className={`${
                    isINR ? "col-span-2" : "col-span-3"
                  } text-right`}
                >
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrency(item.amount, currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-xs text-gray-500">Subtotal</span>
              <span className="text-xs font-medium text-gray-700">
                {formatCurrency(current.subtotal, currency)}
              </span>
            </div>
            {hasDiscount && (
              <>
                <div className="flex justify-between text-emerald-600">
                  <span className="text-xs">
                    Discount
                    {current.discountType === "percent"
                      ? ` (${current.discountValue}%)`
                      : ""}
                  </span>
                  <span className="text-xs font-medium">
                    − {formatCurrency(current.discountAmount || 0, currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Taxable Amount</span>
                  <span className="text-xs font-medium text-gray-700">
                    {formatCurrency(
                      current.taxableAmount || current.subtotal,
                      currency
                    )}
                  </span>
                </div>
              </>
            )}

            {/* GST rows — INR only */}
            {isINR &&
              displayGst > 0 &&
              (showCgstSgst ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">
                      CGST ({current.cgstPercent || displayGst / 2}%)
                    </span>
                    <span className="text-xs font-medium text-gray-700">
                      {formatCurrency(
                        current.cgstAmount || current.gstAmount / 2,
                        currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">
                      SGST ({current.sgstPercent || displayGst / 2}%)
                    </span>
                    <span className="text-xs font-medium text-gray-700">
                      {formatCurrency(
                        current.sgstAmount || current.gstAmount / 2,
                        currency
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">
                    IGST ({current.igstPercent || displayGst}%)
                  </span>
                  <span className="text-xs font-medium text-gray-700">
                    {formatCurrency(
                      current.igstAmount || current.gstAmount,
                      currency
                    )}
                  </span>
                </div>
              ))}

            {/* Tax/VAT row — USD/EUR only */}
            {!isINR && (current.taxAmount || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">
                  {current.taxLabel || (currency === "EUR" ? "VAT" : "Tax")}
                  {(current.taxPercent || 0) > 0
                    ? ` (${current.taxPercent}%)`
                    : ""}
                </span>
                <span className="text-xs font-medium text-gray-700">
                  {formatCurrency(current.taxAmount || 0, currency)}
                </span>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-gray-200">
              <span className="text-sm font-bold text-gray-900">Total</span>
              <span className="text-sm font-bold text-gray-900">
                {formatCurrency(current.total, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {current.notes && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Notes
            </p>
            <p className="text-xs text-gray-600 whitespace-pre-wrap">
              {current.notes}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5">
            <div
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: "#4F46E5" }}
            >
              <Zap className="w-2.5 h-2.5 text-white" fill="white" />
            </div>
            <span className="text-xs text-gray-400">
              Generated by{" "}
              <span className="font-semibold text-gray-600">Ledger</span>
            </span>
          </div>
          <span className="text-xs font-medium text-gray-500">
            Net {current.paymentTermsDays} days
          </span>
        </div>
      </div>

      {/* ── ACTIONS ── */}
      {!isEditing && (
        <div className="px-5 pb-5 flex items-center gap-2">
          {status === "confirmed" ? (
            <div className="w-full flex items-center gap-2 justify-end">
              {invoiceNumber && (
                <DownloadPDFButton
                  invoice={current}
                  invoiceNumber={invoiceNumber}
                  userName={userName}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                className="rounded-xl border border-gray-200 h-10 w-10"
              >
                <Edit2 className="w-4 h-4" />
              </Button>
              {onSend && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSend}
                  className="rounded-xl border border-gray-200 h-10 w-10"
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onDiscard}
                className="rounded-xl border border-red-100 text-red-400 hover:text-red-600 hover:bg-red-50 h-10 w-10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <>
              <Button
                onClick={() => onConfirm(current)}
                className="flex-1 rounded-xl gap-2 bg-indigo-600 hover:bg-indigo-700 h-10"
                style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.25)" }}
              >
                <Check className="w-4 h-4" />
                Confirm Invoice
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                className="rounded-xl border border-gray-200 h-10 w-10"
              >
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDiscard}
                className="rounded-xl border border-red-100 text-red-400 hover:text-red-600 hover:bg-red-50 h-10 w-10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
