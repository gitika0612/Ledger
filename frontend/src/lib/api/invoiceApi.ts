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
  | "ambiguous"
  | "not_found"
  | "unclear"
  | "info";

// The unified response from the AI agent
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
}

export interface SavedDraft {
  invoiceNumber: string;
  isDuplicate: boolean;
  hasSimilar: boolean;
  similarInvoiceNumber?: string;
  similarInvoiceMonth?: string;
  _id: string;
}

// Main AI parse endpoint - now returns AgentResult
export async function parseInvoiceWithAI(
  prompt: string,
  userId?: string,
  sessionContext?: string,
  memoryContext?: string,
  currentInvoice?: ParsedInvoice | null // For edit context
): Promise<AgentResult> {
  const response = await api.post("/invoices/parse", {
    prompt,
    userId,
    sessionContext,
    memoryContext,
    currentInvoice,
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
    lineItems: invoice.lineItems,
    paymentTermsDays: invoice.paymentTermsDays,
    gstPercent: invoice.gstPercent,
    gstType: invoice.gstType || "CGST_SGST",
    cgstPercent: invoice.cgstPercent,
    sgstPercent: invoice.sgstPercent,
    igstPercent: invoice.igstPercent,
    cgstAmount: invoice.cgstAmount,
    sgstAmount: invoice.sgstAmount,
    igstAmount: invoice.igstAmount,
    gstAmount: invoice.gstAmount,
    discountType: invoice.discountType || "none",
    discountValue: invoice.discountValue || 0,
    discountAmount: invoice.discountAmount || 0,
    notes: invoice.notes || "",
    subtotal: invoice.subtotal,
    taxableAmount: invoice.taxableAmount || invoice.subtotal,
    total: invoice.total,
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

export async function fetchClientHistory(clientName: string, userId: string) {
  const response = await api.get(
    `/invoices/client-history/${encodeURIComponent(clientName)}`,
    { headers: { "x-clerk-id": userId } }
  );
  return response.data.invoices;
}

// Fetch most recent invoice for a client (any status)
export async function fetchLatestClientInvoice(
  clientName: string,
  userId: string
): Promise<ParsedInvoice | null> {
  try {
    const response = await api.get(
      `/invoices/client/${encodeURIComponent(clientName)}/latest`,
      { params: { userId } }
    );
    return response.data ?? null;
  } catch {
    return null;
  }
}
