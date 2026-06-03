import { ParsedInvoice } from "./schemas/invoiceSchema";
import { IClientDocument } from "../models/Client";
import { IInvoiceDocument } from "../models/Invoice";

export type AgentIntent =
  | "new"
  | "edit"
  | "copy"
  | "multi"
  | "memory"
  | "split"
  | "query"
  | "unclear"
  | null;

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

export interface MatchResult {
  type: "exact" | "partial" | "none";
  client: IClientDocument | null;
  score: number;
}

export interface InvoiceWithMatch {
  invoice: ParsedInvoice;
  matchResult: MatchResult;
}

// ── Pending state passed from frontend ──
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
  matchedClient?: IClientDocument | null;
}

export interface AgentResult {
  action: AgentAction;
  message: string;
  invoice?: ParsedInvoice | null;
  invoices?: ParsedInvoice[];
  targetRef?: string;
  changedFields?: string[];
  warning?: string;
  matchResult?: MatchResult | null;
  invoicesWithMatch?: InvoiceWithMatch[];
  splitDetails?: {
    originalAmount: number;
    parts: number;
    amountPerPart: number;
  };
  pendingClientName?: string;
  rawClientDetails?: string;
}

export interface InvoiceAgentState {
  prompt: string;
  userId: string;
  sessionId: string;
  sessionContext: string;
  intent: AgentIntent;
  isMultiple: boolean;
  isSplit: boolean;
  splitCount: number;
  targetRef: string;
  routerNotes: string;
  memoryContext: string;
  retrievedInvoices: IInvoiceDocument[];
  parsedInvoice: ParsedInvoice | null;
  parsedInvoices: ParsedInvoice[];
  invoicesWithMatch: InvoiceWithMatch[];
  matchResult: MatchResult | null;
  agentResult: AgentResult | null;
  responseMessage: string;
  error: string | null;
  pendingState: PendingStateContext | null;
}

export const initialState: Omit<
  InvoiceAgentState,
  "prompt" | "userId" | "sessionId" | "sessionContext"
> = {
  intent: null,
  isMultiple: false,
  isSplit: false,
  splitCount: 1,
  targetRef: "",
  routerNotes: "",
  memoryContext: "No past invoice history for this client.",
  retrievedInvoices: [],
  parsedInvoice: null,
  parsedInvoices: [],
  invoicesWithMatch: [],
  matchResult: null,
  agentResult: null,
  responseMessage: "",
  error: null,
  pendingState: null,
};
