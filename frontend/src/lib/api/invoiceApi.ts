import api from "@/lib/api/api";
import { ParsedInvoice } from "@/components/invoice/InvoicePreviewCard";
import { ClientAPI } from "@/lib/api/clientApi";

export type MatchType = "exact" | "partial" | "none";

export interface MatchResult {
  type: MatchType;
  client: ClientAPI | null;
  score: number;
}

export type AgentAction =
  | "created"
  | "edited"
  | "copied"
  | "multi_created"
  | "needs_client"
  | "ambiguous"
  | "not_found"
  | "unclear"
  | "info";

export interface AgentResult {
  action: AgentAction;
  message: string;
  invoice?: ParsedInvoice | null;
  invoices?: ParsedInvoice[];
  targetRef?: string;
  changedFields?: string[];
  warning?: string;
  matchResult?: MatchResult | null;
  invoicesWithMatch?: { invoice: ParsedInvoice; matchResult: MatchResult }[];
  splitDetails?: {
    originalAmount: number;
    parts: number;
    amountPerPart: number;
  };
  pendingClientName?: string;
  rawClientDetails?: string;
}

export interface SavedDraft {
  invoiceNumber: string;
  isDuplicate: boolean;
  hasSimilar: boolean;
  similarInvoiceNumber?: string;
  similarInvoiceMonth?: string;
  _id: string;
}

export interface PendingStateContext {
  status:
    | "awaiting_client_details"
    | "awaiting_confirm_same"
    | "awaiting_client_name"
    | "awaiting_ambiguity"
    | "awaiting_edit_ambiguity";
  clientName?: string;
  invoice?: ParsedInvoice | null;
  originalPrompt?: string;
  matchedClient?: unknown;
}

export async function parseInvoiceWithAI(
  prompt: string,
  userId?: string,
  sessionContext?: string,
  currentInvoice?: ParsedInvoice | null,
  pendingState?: PendingStateContext | null
): Promise<AgentResult> {
  const response = await api.post("/invoices/parse", {
    prompt,
    userId,
    sessionContext,
    currentInvoice,
    pendingState: pendingState || null,
  });
  return response.data as AgentResult;
}

export async function saveDraftInvoice(
  invoice: ParsedInvoice,
  userId: string,
  originalPrompt: string,
  clientId?: string
): Promise<SavedDraft> {
  const idempotencyKey = `${userId}_${invoice.clientName}_${
    invoice.total
  }_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const response = await api.post("/invoices/save", {
    userId,
    clientName: invoice.clientName,
    currency: invoice.currency || "INR",
    lineItems: invoice.lineItems,
    paymentTermsDays: invoice.paymentTermsDays,
    // INR GST fields
    gstPercent: invoice.gstPercent,
    gstType: invoice.gstType || "CGST_SGST",
    cgstPercent: invoice.cgstPercent,
    sgstPercent: invoice.sgstPercent,
    igstPercent: invoice.igstPercent,
    cgstAmount: invoice.cgstAmount,
    sgstAmount: invoice.sgstAmount,
    igstAmount: invoice.igstAmount,
    gstAmount: invoice.gstAmount,
    // USD/EUR Tax fields
    taxPercent: invoice.taxPercent || 0,
    taxAmount: invoice.taxAmount || 0,
    taxLabel: invoice.taxLabel || "",
    // Common
    discountType: invoice.discountType || "none",
    discountValue: invoice.discountValue || 0,
    discountAmount: invoice.discountAmount || 0,
    notes: invoice.notes || "",
    subtotal: invoice.subtotal,
    taxableAmount: invoice.taxableAmount || invoice.subtotal,
    total: invoice.total,
    isTaxInclusive: invoice.isTaxInclusive || false,
    originalPrompt,
    invoiceDate: invoice.invoiceDate,
    invoiceMonth: invoice.invoiceMonth,
    clientId: clientId || "",
    idempotencyKey,
  });

  return {
    invoiceNumber: response.data.invoice.invoiceNumber,
    isDuplicate: response.data.isDuplicate || false,
    hasSimilar: response.data.hasSimilar || false,
    similarInvoiceNumber: response.data.similarInvoice?.invoiceNumber,
    similarInvoiceMonth: response.data.similarInvoice?.invoiceMonth,
    _id: response.data.invoice._id,
  };
}

export async function confirmInvoice(
  invoiceId: string
): Promise<{ invoiceNumber: string }> {
  const response = await api.patch(`/invoices/${invoiceId}/confirm`);
  return { invoiceNumber: response.data.invoice.invoiceNumber };
}

export async function updateInvoice(
  invoiceId: string,
  data: Partial<ParsedInvoice> & { status?: string; dueDate?: string }
): Promise<void> {
  await api.put(`/invoices/${invoiceId}`, data);
}

export async function getUserInvoices(userId: string) {
  const response = await api.get("/invoices", {
    headers: { "x-clerk-id": userId },
  });
  return response.data.invoices;
}

export async function fetchDashboardStats(userId: string) {
  const response = await api.get("/invoices/dashboard-stats", {
    headers: { "x-clerk-id": userId },
  });
  return response.data;
}

export async function deleteInvoice(invoiceId: string): Promise<void> {
  await api.delete(`/invoices/${invoiceId}`);
}

export async function fetchInvoiceById(id: string) {
  const response = await api.get(`/invoices/${id}`);
  if (!response.data.invoice) throw new Error("Invoice not found");
  return response.data.invoice;
}
