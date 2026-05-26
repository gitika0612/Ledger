import { useState, useMemo } from "react";
import {
  FileText,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from "lucide-react";
import { ParsedInvoice } from "./InvoicePreviewCard";
import { InvoicePreviewCard } from "./InvoicePreviewCard";
import { InvoicePanelFilters } from "./filters/InvoicePanelFilters";
import { SendInvoiceModal } from "./modals/SendInvoiceModel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SessionInvoice {
  messageId: string;
  invoice: ParsedInvoice;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  invoiceNumber?: string;
  invoiceId?: string;
  dbMessageId: string;
}

interface InvoicePanelProps {
  sessionInvoices: SessionInvoice[];
  selectedMessageId: string | null;
  activeTab?: "draft" | "confirmed";
  onTabChange?: () => void;
  onConfirm: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
  onEdit: (messageId: string, updated: ParsedInvoice) => void;
  onSelect: (messageId: string | null) => void;
  onSend?: (messageId: string) => void;
  userName?: string;
}

type SortOption = "newest" | "oldest" | "highest" | "lowest" | "az";
type StatusFilter = "draft" | "confirmed";

function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseMonthKey(key: string): Date {
  const months: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const parts = key.toLowerCase().split(" ");
  const month = months[parts[0]] ?? 0;
  const year = parseInt(parts[1]) || new Date().getFullYear();
  return new Date(year, month, 1);
}

function sortMonthKeys(keys: string[]): string[] {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [...keys].sort((a, b) => {
    const aMs = parseMonthKey(a).getTime();
    const bMs = parseMonthKey(b).getTime();
    const nowMs = currentMonthStart.getTime();
    if (aMs === nowMs) return -1;
    if (bMs === nowMs) return 1;
    if (aMs > nowMs && bMs > nowMs) return aMs - bMs;
    if (aMs > nowMs) return -1;
    if (bMs > nowMs) return 1;
    return bMs - aMs;
  });
}

function getGroupKey(si: SessionInvoice): string {
  if (si.invoice.invoiceMonth) return si.invoice.invoiceMonth;
  return new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function isCurrentMonth(key: string): boolean {
  const current = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  return key.toLowerCase() === current.toLowerCase();
}

function isFutureMonth(key: string): boolean {
  const date = parseMonthKey(key);
  const currentStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  return date.getTime() > currentStart.getTime();
}

export function InvoicePanel({
  sessionInvoices,
  selectedMessageId,
  activeTab,
  onTabChange,
  onConfirm,
  onDiscard,
  onEdit,
  onSelect,
  onSend,
  userName,
}: InvoicePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [userSelectedTab, setUserSelectedTab] = useState<StatusFilter | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(
    new Set()
  );
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);

  const sendingInvoice = sendingMessageId
    ? sessionInvoices.find((s) => s.messageId === sendingMessageId) ?? null
    : null;

  const drafts = sessionInvoices.filter((s) => s.status === "draft");
  const confirmed = sessionInvoices.filter((s) => s.status === "confirmed");
  const latestInvoice = sessionInvoices[sessionInvoices.length - 1];
  const defaultTab: StatusFilter =
    latestInvoice?.status === "confirmed" ? "confirmed" : "draft";
  const manualTab: StatusFilter = activeTab ?? userSelectedTab ?? defaultTab;
  const baseList = manualTab === "draft" ? drafts : confirmed;

  const allClients = useMemo(
    () => [...new Set(baseList.map((si) => si.invoice.clientName))].sort(),
    [baseList]
  );

  const allMonths = useMemo(() => {
    const months = [...new Set(baseList.map((si) => getGroupKey(si)))];
    return sortMonthKeys(months);
  }, [baseList]);

  const activeFilterCount = useMemo(
    () =>
      (selectedClients.size > 0 ? 1 : 0) + (selectedMonths.size > 0 ? 1 : 0),
    [selectedClients, selectedMonths]
  );

  const filtered = useMemo(
    () =>
      baseList.filter((si) => {
        const q = search.toLowerCase();
        const matchSearch =
          si.invoice.clientName.toLowerCase().includes(q) ||
          (si.invoiceNumber || "").toLowerCase().includes(q);
        const matchClient =
          selectedClients.size === 0 ||
          selectedClients.has(si.invoice.clientName);
        const matchMonth =
          selectedMonths.size === 0 || selectedMonths.has(getGroupKey(si));
        return matchSearch && matchClient && matchMonth;
      }),
    [baseList, search, selectedClients, selectedMonths]
  );

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        switch (sortBy) {
          case "newest":
            return b.dbMessageId.localeCompare(a.dbMessageId);
          case "oldest":
            return a.dbMessageId.localeCompare(b.dbMessageId);
          case "highest":
            return b.invoice.total - a.invoice.total;
          case "lowest":
            return a.invoice.total - b.invoice.total;
          case "az":
            return a.invoice.clientName.localeCompare(b.invoice.clientName);
          default:
            return 0;
        }
      }),
    [filtered, sortBy]
  );

  const grouped = useMemo(() => {
    const groups: Record<string, SessionInvoice[]> = {};
    sorted.forEach((si) => {
      const key = getGroupKey(si);
      if (!groups[key]) groups[key] = [];
      groups[key].push(si);
    });
    return groups;
  }, [sorted]);

  const sortedGroupKeys = useMemo(
    () => sortMonthKeys(Object.keys(grouped)),
    [grouped]
  );
  const hasFilters =
    search || selectedClients.size > 0 || selectedMonths.size > 0;

  const toggleClient = (client: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  };
  const toggleMonth = (month: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };
  const clearAll = () => {
    setSearch("");
    setSelectedClients(new Set());
    setSelectedMonths(new Set());
  };
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  if (sessionInvoices.length === 0) return null;

  return (
    <>
      <div
        className={`relative flex flex-col border-l border-gray-100 bg-[#FAFAFA] transition-all duration-300 flex-shrink-0 h-full ${
          collapsed ? "w-10" : "w-[500px]"
        }`}
      >
        <div className="absolute top-3 right-2 z-20">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="w-7 h-7 text-gray-400 hover:text-gray-600"
          >
            {collapsed ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </div>

        {!collapsed && (
          <>
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b border-gray-100">
              <div className="px-4 pt-4 pb-3 pr-10">
                <p className="text-xs font-bold text-gray-900 uppercase tracking-widest">
                  Session Invoices
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {sessionInvoices.length} invoice
                  {sessionInvoices.length !== 1 ? "s" : ""} ·{" "}
                  <span className="text-amber-500 font-medium">
                    {drafts.length} draft{drafts.length !== 1 ? "s" : ""}
                  </span>
                  {" · "}
                  <span className="text-emerald-500 font-medium">
                    {confirmed.length} confirmed
                  </span>
                </p>
              </div>

              {/* Status tabs */}
              <div className="flex gap-1.5 px-4 pb-3">
                {(
                  [
                    { key: "draft", label: "Drafts", count: drafts.length },
                    {
                      key: "confirmed",
                      label: "Confirmed",
                      count: confirmed.length,
                    },
                  ] as const
                ).map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setUserSelectedTab(key);
                      onTabChange?.();
                      const list = key === "draft" ? drafts : confirmed;
                      const stillExists = list.find(
                        (item) => item.messageId === selectedMessageId
                      );
                      onSelect(
                        stillExists
                          ? stillExists.messageId
                          : list.length > 0
                          ? list[0].messageId
                          : null
                      );
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all select-none flex-1 justify-center ${
                      manualTab === key
                        ? key === "draft"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-gray-50 text-gray-500 border border-transparent hover:bg-gray-100"
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        manualTab === key
                          ? key === "draft"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search + Filter + Sort */}
              <div className="flex items-start px-3 pb-3">
                <div className="flex-1 min-w-0">
                  <InvoicePanelFilters
                    search={search}
                    onSearchChange={setSearch}
                    selectedClients={selectedClients}
                    onToggleClient={toggleClient}
                    onClearClients={() => setSelectedClients(new Set())}
                    selectedMonths={selectedMonths}
                    onToggleMonth={toggleMonth}
                    onClearMonths={() => setSelectedMonths(new Set())}
                    onClearAll={clearAll}
                    allClients={allClients}
                    allMonths={allMonths}
                    activeFilterCount={activeFilterCount}
                  />
                </div>
                <Select
                  value={sortBy}
                  onValueChange={(val) => setSortBy(val as SortOption)}
                >
                  <SelectTrigger className="w-24 h-8 text-xs bg-gray-50 border-gray-200 rounded-lg gap-1 flex-shrink-0 mt-0">
                    <ArrowUpDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                    <SelectItem value="highest">Highest</SelectItem>
                    <SelectItem value="lowest">Lowest</SelectItem>
                    <SelectItem value="az">A–Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Invoice list */}
            <ScrollArea className="flex-1 bg-white">
              <div className="py-3">
                {sorted.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                      <FileText className="w-6 h-6 text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400 font-medium">
                      No invoices found
                    </p>
                    <p className="text-xs text-gray-300 mt-1">
                      {hasFilters
                        ? "Try adjusting your filters"
                        : `No ${manualTab} invoices yet`}
                    </p>
                    {hasFilters && (
                      <button
                        onClick={clearAll}
                        className="text-xs text-indigo-500 mt-2 font-medium"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  sortedGroupKeys.map((group) => {
                    const items = grouped[group];
                    if (!items) return null;
                    const isGroupCollapsed = collapsedGroups[group];
                    const isCurrent = isCurrentMonth(group);
                    const isFuture = isFutureMonth(group);

                    return (
                      <div key={group} className="mb-1">
                        <button
                          onClick={() => toggleGroup(group)}
                          className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                isCurrent || isFuture
                                  ? "bg-indigo-400"
                                  : "bg-gray-300"
                              }`}
                            />
                            <span
                              className={`text-xs font-bold uppercase tracking-wider ${
                                isCurrent || isFuture
                                  ? "text-indigo-600"
                                  : "text-gray-400"
                              }`}
                            >
                              {group}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-500 text-[9px] font-bold rounded-md uppercase tracking-wide">
                                Current
                              </span>
                            )}
                            {isFuture && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-400 text-[9px] font-bold rounded-md uppercase tracking-wide">
                                Upcoming
                              </span>
                            )}
                            <span className="text-[10px] text-gray-400 font-medium">
                              {items.length} invoice
                              {items.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500">
                              {formatINR(
                                items.reduce(
                                  (sum, si) => sum + si.invoice.total,
                                  0
                                )
                              )}
                            </span>
                            {isGroupCollapsed ? (
                              <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-gray-400" />
                            ) : (
                              <ChevronUp className="w-3 h-3 text-gray-300 group-hover:text-gray-400" />
                            )}
                          </div>
                        </button>

                        {!isGroupCollapsed && (
                          <div className="space-y-1.5 px-3 pb-1">
                            {items.map((si) => {
                              const isSelected =
                                selectedMessageId === si.messageId;
                              return (
                                <div key={si.messageId}>
                                  <div
                                    className={`rounded-xl border overflow-hidden transition-all duration-200 ${
                                      isSelected
                                        ? "border-indigo-200 shadow-[0_0_0_3px_rgba(99,102,241,0.08)]"
                                        : "border-gray-300 bg-white hover:shadow-sm"
                                    }`}
                                  >
                                    <button
                                      onClick={() =>
                                        onSelect(
                                          isSelected ? null : si.messageId
                                        )
                                      }
                                      className={`w-full text-left px-3.5 py-3 flex items-start gap-3 transition-colors ${
                                        isSelected
                                          ? "bg-indigo-50/30"
                                          : "bg-white hover:bg-gray-50/50"
                                      }`}
                                    >
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                          si.status === "confirmed"
                                            ? "bg-emerald-400"
                                            : "bg-amber-400"
                                        }`}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              {si.invoiceNumber && (
                                                <span
                                                  className={`text-[10px] font-bold tracking-wide font-mono ${
                                                    isSelected
                                                      ? "text-indigo-600"
                                                      : "text-gray-400"
                                                  }`}
                                                >
                                                  {si.invoiceNumber}
                                                </span>
                                              )}
                                              <span
                                                className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                                                  si.status === "confirmed"
                                                    ? "bg-emerald-50 text-emerald-600"
                                                    : "bg-gray-100 text-gray-600"
                                                }`}
                                              >
                                                {si.status === "confirmed"
                                                  ? "Confirmed"
                                                  : "Draft"}
                                              </span>
                                            </div>
                                            <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                                              {si.invoice.clientName}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                              <span className="text-xs text-gray-400">
                                                {si.invoice.lineItems?.length ||
                                                  0}{" "}
                                                item
                                                {(si.invoice.lineItems
                                                  ?.length || 0) !== 1
                                                  ? "s"
                                                  : ""}
                                              </span>
                                              <span className="text-gray-200">
                                                ·
                                              </span>
                                              <span className="text-xs text-gray-400">
                                                GST {si.invoice.gstPercent}%
                                              </span>
                                              {si.invoice.invoiceMonth && (
                                                <>
                                                  <span className="text-gray-200">
                                                    ·
                                                  </span>
                                                  <span
                                                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                                                      isCurrentMonth(
                                                        si.invoice.invoiceMonth
                                                      ) ||
                                                      isFutureMonth(
                                                        si.invoice.invoiceMonth
                                                      )
                                                        ? "bg-indigo-50 text-indigo-500"
                                                        : "bg-gray-50 text-gray-400"
                                                    }`}
                                                  >
                                                    {si.invoice.invoiceMonth}
                                                  </span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                            <p className="text-sm font-bold text-gray-900">
                                              {formatINR(si.invoice.total)}
                                            </p>
                                            {isSelected ? (
                                              <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                                            ) : (
                                              <ChevronDown className="w-3.5 h-3.5 text-gray-300" />
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </button>

                                    {isSelected && (
                                      <div className="border-t border-indigo-100">
                                        <div className="p-3 overflow-y-auto">
                                          <InvoicePreviewCard
                                            invoice={si.invoice}
                                            status={si.status}
                                            invoiceId={si.invoiceId}
                                            invoiceNumber={si.invoiceNumber}
                                            userName={userName}
                                            onConfirm={() =>
                                              onConfirm(si.messageId)
                                            }
                                            onEdit={(updated) =>
                                              onEdit(si.messageId, updated)
                                            }
                                            onDiscard={() => {
                                              onDiscard(si.messageId);
                                              const remaining = sorted.filter(
                                                (s) =>
                                                  s.messageId !== si.messageId
                                              );
                                              onSelect(
                                                remaining.length > 0
                                                  ? remaining[0].messageId
                                                  : null
                                              );
                                            }}
                                            onSend={
                                              si.status === "confirmed" &&
                                              si.invoiceId
                                                ? () =>
                                                    setSendingMessageId(
                                                      si.messageId
                                                    )
                                                : undefined
                                            }
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </div>

      {sendingInvoice && sendingInvoice.invoiceId && (
        <SendInvoiceModal
          invoiceId={sendingInvoice.invoiceId}
          invoiceNumber={sendingInvoice.invoiceNumber ?? ""}
          clientName={sendingInvoice.invoice.clientName}
          total={sendingInvoice.invoice.total}
          invoice={{
            ...sendingInvoice.invoice,
            lineItems: sendingInvoice.invoice.lineItems ?? [],
            paymentTermsDays: sendingInvoice.invoice.paymentTermsDays ?? 15,
          }}
          onClose={() => setSendingMessageId(null)}
          onSent={() => {
            onSend?.(sendingInvoice.messageId);
            setSendingMessageId(null);
            toast.success(
              `Invoice sent to ${sendingInvoice.invoice.clientName} ✓`,
              {
                description: `${
                  sendingInvoice.invoiceNumber ?? "Invoice"
                } delivered successfully`,
              }
            );
          }}
        />
      )}
    </>
  );
}
