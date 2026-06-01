import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  Plus,
  Search,
  FileText,
  MoreHorizontal,
  Zap,
  ArrowLeft,
  Eye,
  Download,
  Send,
  Trash2,
  Edit2,
  CheckCircle,
  Copy,
} from "lucide-react";
import { downloadInvoicePDF } from "@/lib/downloadPDF";
import {
  confirmInvoice,
  deleteInvoice,
  getUserInvoices,
  updateInvoice,
} from "@/lib/api/invoiceApi";
import { DeleteInvoiceModal } from "@/components/invoice/modals/DeleteInvoiceModal";
import {
  EditInvoiceData,
  EditInvoiceModal,
} from "@/components/invoice/modals/EditInvoiceModal";
import { LineItem } from "@/components/invoice/InvoicePreviewCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SendInvoiceModal } from "@/components/invoice/modals/SendInvoiceModel";
import { getClientByName } from "@/lib/api/clientApi";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";

type InvoiceStatus = "draft" | "confirmed" | "sent" | "paid" | "overdue";
type FilterTab = "all" | "draft" | "confirmed" | "sent" | "paid" | "overdue";

interface Invoice {
  _id: string;
  invoiceNumber: string;
  clientName: string;
  currency?: "INR" | "USD" | "EUR";
  lineItems: LineItem[];
  paymentTermsDays: number;
  gstPercent: number;
  gstType?: "IGST" | "CGST_SGST";
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount: number;
  taxPercent?: number;
  taxAmount?: number;
  taxLabel?: string;
  discountType?: "percent" | "amount" | "none";
  discountValue?: number;
  discountAmount?: number;
  taxableAmount?: number;
  notes?: string;
  subtotal: number;
  total: number;
  status: InvoiceStatus;
  createdAt: string;
  dueDate: string;
  clientEmail?: string;
  clientAddress?: string;
  clientCity?: string;
  clientState?: string;
  clientPincode?: string;
}

function getDisplayStatus(inv: Invoice): { label: string; style: string } {
  switch (inv.status) {
    case "confirmed":
      return { label: "Confirmed", style: "text-emerald-600 bg-emerald-50" };
    case "sent":
      return { label: "Sent", style: "bg-blue-50 text-blue-600" };
    case "paid":
      return { label: "Paid", style: "bg-emerald-50 text-emerald-600" };
    case "overdue":
      return { label: "Overdue", style: "bg-red-50 text-red-500" };
    default:
      return { label: "Draft", style: "bg-gray-100 text-gray-500" };
  }
}

function getInvoicePermissions(status: InvoiceStatus) {
  switch (status) {
    case "draft":
      return {
        canEdit: true,
        canSend: false,
        canDelete: true,
        reason: "Draft must be confirmed before sending",
      };
    case "confirmed":
      return { canEdit: true, canSend: true, canDelete: true };
    case "sent":
      return {
        canEdit: false,
        canSend: false,
        canDelete: false,
        reason: "Invoice already sent",
      };
    case "paid":
      return {
        canEdit: false,
        canSend: false,
        canDelete: false,
        reason: "Paid invoices are locked",
      };
    case "overdue":
      return {
        canEdit: false,
        canSend: false,
        canDelete: false,
        canRemind: true,
        reason: "Overdue invoice — send reminder instead",
      };
  }
}

const TABS: { label: string; value: FilterTab }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Sent", value: "sent" },
  { label: "Paid", value: "paid" },
  { label: "Overdue", value: "overdue" },
];

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-600",
  "bg-emerald-100 text-emerald-600",
  "bg-orange-100 text-orange-600",
  "bg-pink-100 text-pink-600",
  "bg-violet-100 text-violet-600",
];

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function formatINR(amount: number, currency?: "INR" | "USD" | "EUR") {
  return formatCurrency(amount, currency ?? "INR");
}

function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function matchesTab(inv: Invoice, tab: FilterTab): boolean {
  if (tab === "all") return true;
  return inv.status === tab;
}

const COL_WIDTHS = "grid-cols-[160px_1fr_140px_140px_120px_110px_48px]";

export function InvoiceListPage() {
  const navigate = useNavigate();
  const { getUserProfile } = useAuth();
  const { user, isLoaded } = useUser();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [menuFlip, setMenuFlip] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null
  );
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isLoaded || !user) return;
    (async () => {
      try {
        const data = await getUserInvoices(user.id);
        setInvoices(data);
      } catch (err) {
        console.error("Failed to fetch invoices:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const filtered = invoices.filter((inv) => {
    const matchTab = matchesTab(inv, activeTab);
    const matchSearch =
      inv.clientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const tabCounts = {
    all: invoices.length,
    draft: invoices.filter((i) => i.status === "draft").length,
    confirmed: invoices.filter((i) => i.status === "confirmed").length,
    sent: invoices.filter((i) => i.status === "sent").length,
    paid: invoices.filter((i) => i.status === "paid").length,
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };

  const handleDownloadPDF = async (inv: Invoice) => {
    setOpenMenuId(null);
    try {
      const profile = await getUserProfile();
      await downloadInvoicePDF(
        {
          clientName: inv.clientName,
          lineItems: inv.lineItems,
          paymentTermsDays: inv.paymentTermsDays,
          gstPercent: inv.gstPercent,
          gstType: inv.gstType,
          cgstAmount: inv.cgstAmount,
          sgstAmount: inv.sgstAmount,
          igstAmount: inv.igstAmount,
          gstAmount: inv.gstAmount,
          taxPercent: inv.taxPercent,
          taxAmount: inv.taxAmount,
          taxLabel: inv.taxLabel,
          discountType: inv.discountType,
          discountValue: inv.discountValue,
          discountAmount: inv.discountAmount,
          taxableAmount: inv.taxableAmount,
          notes: inv.notes,
          subtotal: inv.subtotal,
          total: inv.total,
          currency: inv.currency,
        },
        inv.invoiceNumber,
        user?.fullName || user?.firstName || "Ledger User",
        profile
      );
    } catch (err) {
      console.error("PDF download failed:", err);
    }
  };

  const handleDelete = async (invoiceId: string) => {
    setDeletingId(invoiceId);
    try {
      await deleteInvoice(invoiceId);
      setInvoices((prev) => prev.filter((inv) => inv._id !== invoiceId));
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfirmInvoice = async (inv: Invoice) => {
    setOpenMenuId(null);
    try {
      const confirmed = await confirmInvoice(inv._id);
      setInvoices((prev) =>
        prev.map((i) =>
          i._id === inv._id
            ? {
                ...i,
                status: "confirmed",
                invoiceNumber: confirmed.invoiceNumber,
              }
            : i
        )
      );
      toast.success("Invoice confirmed successfully!");
    } catch (err) {
      console.error("Failed to confirm invoice:", err);
      toast.error("Failed to confirm invoice");
    }
  };

  const handleSaveEdit = async (id: string, data: Partial<EditInvoiceData>) => {
    await updateInvoice(id, data);
    setInvoices((prev) =>
      prev.map((inv) => (inv._id === id ? { ...inv, ...data } : inv))
    );
  };

  const handleOpenEditModal = async (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    let invoiceWithClient: Invoice = { ...inv };
    if (inv.clientName && user) {
      try {
        const client = await getClientByName(user.id, inv.clientName);
        if (client) {
          invoiceWithClient = {
            ...invoiceWithClient,
            clientEmail: client.email || "",
            clientAddress: client.address || "",
            clientCity: client.city || "",
            clientState: client.state || "",
            clientPincode: client.pincode || "",
          };
        }
      } catch (err) {
        console.error("Failed to fetch client:", err);
      }
    }
    setEditingInvoice(invoiceWithClient);
  };

  const HEADERS = [
    "Invoice",
    "Client",
    "Date",
    "Due Date",
    "Amount",
    "Status",
    "",
  ];

  return (
    <div className="h-screen bg-[#F9FAFB] flex flex-col overflow-hidden">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="rounded-lg text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate("/dashboard")}
            >
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

      <main className="max-w-6xl mx-auto px-6 py-8 w-full flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8 flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              All Invoices
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {loading
                ? "Loading..."
                : `${invoices.length} total invoice${
                    invoices.length !== 1 ? "s" : ""
                  }`}
            </p>
          </div>
          <Button
            onClick={() => navigate("/create")}
            className="gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all"
            style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}
          >
            <Plus className="w-4 h-4" />
            New Invoice
          </Button>
        </div>

        {/* Search + Tabs */}
        <div className="flex items-center gap-6 mb-6 flex-shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 rounded-xl focus-visible:ring-indigo-400"
            />
          </div>
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <Button
                key={tab.value}
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab(tab.value)}
                className={`rounded-lg px-3 text-sm font-medium gap-1.5 ${
                  activeTab === tab.value
                    ? "bg-gray-100 text-gray-900 hover:bg-gray-100"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                {tab.label}
                {tabCounts[tab.value] > 0 && (
                  <span
                    className={`text-xs rounded-full px-1.5 py-0 font-bold ${
                      activeTab === tab.value
                        ? "bg-gray-200 text-gray-700"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {tabCounts[tab.value]}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>

        {/* Table container — sticky header + scrollable body */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <FileText className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900">
                No invoices found
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {search
                  ? "Try a different search term"
                  : "Create your first invoice to get started"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* ── Sticky header ── */}
              <div
                className={`grid ${COL_WIDTHS} border-b border-gray-100 flex-shrink-0`}
              >
                {HEADERS.map((h, i) => (
                  <div
                    key={i}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide"
                  >
                    {h}
                  </div>
                ))}
              </div>

              {/* ── Scrollable body ── */}
              <div className="overflow-y-auto flex-1">
                {filtered.map((inv) => {
                  const display = getDisplayStatus(inv);
                  const perms = getInvoicePermissions(inv.status);
                  return (
                    <div
                      key={inv._id}
                      onClick={() => navigate(`/invoices/${inv._id}`)}
                      className={`grid ${COL_WIDTHS} border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer items-center`}
                    >
                      {/* Invoice number */}
                      <div className="px-6 py-4">
                        <span className="text-sm font-semibold text-gray-900">
                          {inv.invoiceNumber}
                        </span>
                      </div>

                      {/* Client */}
                      <div className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            className={`w-8 h-8 flex-shrink-0 ${getAvatarColor(
                              inv.clientName
                            )}`}
                          >
                            <AvatarFallback
                              className={`text-xs font-bold ${getAvatarColor(
                                inv.clientName
                              )}`}
                            >
                              {inv.clientName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {inv.clientName}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {inv.lineItems && inv.lineItems.length > 0
                                ? inv.lineItems[0].description
                                : "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Date */}
                      <div className="px-6 py-4">
                        <span className="text-sm text-gray-500 whitespace-nowrap">
                          {formatDate(inv.createdAt)}
                        </span>
                      </div>

                      {/* Due date */}
                      <div className="px-6 py-4">
                        <span className="text-sm text-gray-500 whitespace-nowrap">
                          {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                        </span>
                      </div>

                      {/* Amount */}
                      <div className="px-6 py-4">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatINR(inv.total, inv.currency)}
                        </span>
                      </div>

                      {/* Status */}
                      <div className="px-6 py-4">
                        <Badge
                          className={`capitalize rounded-full text-xs font-medium ${display.style}`}
                        >
                          {display.label}
                        </Badge>
                      </div>

                      {/* Actions menu */}
                      <div className="px-3 py-4">
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="icon"
                            ref={(el) => {
                              buttonRefs.current[inv._id] =
                                el as HTMLButtonElement;
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const id = inv._id;
                              if (openMenuId === id) {
                                setOpenMenuId(null);
                              } else {
                                const btn = buttonRefs.current[id];
                                if (btn) {
                                  const rect = btn.getBoundingClientRect();
                                  const spaceBelow =
                                    window.innerHeight - rect.bottom;
                                  setMenuFlip((prev) => ({
                                    ...prev,
                                    [id]: spaceBelow < 220,
                                  }));
                                }
                                setOpenMenuId(id);
                              }
                            }}
                            className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>

                          {openMenuId === inv._id && (
                            <div
                              ref={menuRef}
                              className={`absolute right-0 z-50 bg-white rounded-2xl border border-gray-100 py-1.5 ${
                                menuFlip[inv._id] ? "bottom-8" : "top-8"
                              }`}
                              style={{
                                boxShadow:
                                  "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
                              }}
                            >
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  navigate(`/invoices/${inv._id}`);
                                }}
                                className="w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm text-gray-700"
                              >
                                <Eye className="w-4 h-4 text-gray-700" />
                                View
                              </Button>

                              <Button
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadPDF(inv);
                                }}
                                className="w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm text-gray-700"
                              >
                                <Download className="w-4 h-4 text-gray-700" />
                                Download PDF
                              </Button>

                              {inv.status === "draft" && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    variant="ghost"
                                    onClick={() => handleConfirmInvoice(inv)}
                                    className="w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm text-gray-700"
                                  >
                                    <CheckCircle className="w-4 h-4 text-gray-700" />
                                    Confirm Invoice
                                  </Button>
                                </div>
                              )}

                              {(inv.status === "sent" ||
                                inv.status === "overdue") && (
                                <Button
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const link = `${window.location.origin}/pay/${inv._id}`;
                                    navigator.clipboard.writeText(link);
                                    toast.success("Payment link copied!");
                                  }}
                                  className="w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm text-gray-700"
                                >
                                  <Copy className="w-4 h-4 text-gray-700" />
                                  Copy Payment Link
                                </Button>
                              )}

                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  disabled={!perms.canEdit}
                                  title={!perms.canEdit ? perms.reason : ""}
                                  onClick={
                                    perms.canEdit
                                      ? (e) => handleOpenEditModal(inv, e)
                                      : undefined
                                  }
                                  className={`w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm ${
                                    perms.canEdit
                                      ? "text-gray-700"
                                      : "text-gray-300 cursor-not-allowed"
                                  }`}
                                >
                                  <Edit2 className="w-4 h-4" />
                                  Edit
                                </Button>
                              </div>

                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  disabled={!perms.canSend}
                                  title={!perms.canSend ? perms.reason : ""}
                                  onClick={
                                    perms.canSend
                                      ? () => {
                                          setOpenMenuId(null);
                                          setSendingInvoice(inv);
                                        }
                                      : undefined
                                  }
                                  className={`w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm ${
                                    perms.canSend
                                      ? "text-gray-700"
                                      : "text-gray-300 cursor-not-allowed"
                                  }`}
                                >
                                  <Send className="w-4 h-4" />
                                  Send
                                </Button>
                              </div>

                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  disabled={!perms.canDelete}
                                  title={!perms.canDelete ? perms.reason : ""}
                                  onClick={
                                    perms.canDelete
                                      ? () => {
                                          setOpenMenuId(null);
                                          setShowDeleteConfirm(inv._id);
                                        }
                                      : undefined
                                  }
                                  className={`w-full justify-start gap-3 px-4 py-2.5 h-auto rounded-none text-sm ${
                                    perms.canDelete
                                      ? "text-red-500 hover:bg-red-50"
                                      : "text-gray-300 cursor-not-allowed"
                                  }`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {editingInvoice && (
        <EditInvoiceModal
          invoice={editingInvoice}
          onSave={handleSaveEdit}
          onClose={() => setEditingInvoice(null)}
        />
      )}

      {sendingInvoice && (
        <SendInvoiceModal
          invoiceId={sendingInvoice._id}
          invoiceNumber={sendingInvoice.invoiceNumber}
          clientName={sendingInvoice.clientName}
          total={sendingInvoice.total}
          invoice={sendingInvoice}
          onClose={() => setSendingInvoice(null)}
          onSent={() => {
            setInvoices((prev) =>
              prev.map((inv) =>
                inv._id === sendingInvoice._id
                  ? { ...inv, status: "sent" }
                  : inv
              )
            );
            setSendingInvoice(null);
          }}
        />
      )}

      {showDeleteConfirm && (
        <DeleteInvoiceModal
          invoiceNumber={
            invoices.find((inv) => inv._id === showDeleteConfirm)
              ?.invoiceNumber || ""
          }
          isDeleting={!!deletingId}
          onConfirm={() => handleDelete(showDeleteConfirm)}
          onCancel={() => setShowDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
