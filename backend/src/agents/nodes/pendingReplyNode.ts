import { ChatOpenAI } from "@langchain/openai";
import { InvoiceAgentState, AgentResult } from "../state";
import { findClientMatch } from "../../lib/clientMatcher";
import { Invoice } from "../../models/Invoice";
import { ParsedInvoice } from "../schemas/invoiceSchema";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";
import { copierNode } from "./copierNode";
import { editorNode } from "./editorNode";

const PENDING_REPLY_PROMPT = `You are handling a conversational reply in an invoice chat assistant.

The user was asked for information and has replied. Determine what they mean and return a JSON response.

━━━ CURRENT PENDING STATE ━━━
Status: {pendingStatus}
Client Name (what we asked about): {clientName}
Invoice Total: {invoiceTotal}
Original Prompt: {originalPrompt}

━━━ USER'S REPLY ━━━
{reply}

━━━ YOUR TASK ━━━
Classify the reply into one of these actions:

1. NAME_CORRECTION — user is correcting the client name
   Signals: "sorry it's X", "name is X", "X not Y", "I meant X", "correct name is X"
   Return: { "action": "name_correction", "correctedName": "X" }

2. HAS_SAVED_DETAILS — user is asking if we have their details already
   Signals: "don't you have", "do you have", "already have", "saved details", "use existing", "you should have"
   Return: { "action": "check_existing" }

3. SKIP — user wants to skip adding details
   Signals: "skip", "no details", "without details", "proceed", "continue", "later", "just create"
   Return: { "action": "skip" }

4. SAME_CLIENT — user confirms it's the same client (for awaiting_confirm_same)
   Signals: "same", "yes", "haan", "confirm", "correct", "that's right", "yep", "y"
   Return: { "action": "same_client" }

5. DIFFERENT_CLIENT — user says it's a different client (for awaiting_confirm_same)
   Signals: "different", "no", "nahi", "not same", "new client"
   Return: { "action": "different_client" }

6. CLIENT_DETAILS — user is providing contact information
   Signals: contains email address, phone number, address, GSTIN
   Return: { "action": "client_details", "rawText": "<the full reply>" }

7. NEW_CLIENT_NAME — user is providing the client name (for awaiting_client_name)
   Signals: any name that doesn't match other patterns
   Return: { "action": "new_client_name", "name": "<the name>" }

RESPOND WITH ONLY VALID JSON. No explanation.`;

async function fetchInvoiceFromDB(
  userId: string,
  invoiceNumber: string
): Promise<ParsedInvoice | null> {
  try {
    const inv = await Invoice.findOne({
      userId,
      invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, "i") },
    }).lean();
    if (!inv) return null;
    return {
      clientName: inv.clientName,
      lineItems: inv.lineItems,
      currency: inv.currency ?? "INR",
      gstPercent: inv.gstPercent,
      gstType: inv.gstType as "IGST" | "CGST_SGST",
      paymentTermsDays: inv.paymentTermsDays,
      subtotal: inv.subtotal,
      taxableAmount: inv.taxableAmount ?? inv.subtotal,
      gstAmount: inv.gstAmount,
      cgstAmount: inv.cgstAmount ?? 0,
      sgstAmount: inv.sgstAmount ?? 0,
      igstAmount: inv.igstAmount ?? 0,
      taxPercent: inv.taxPercent ?? 0,
      taxAmount: inv.taxAmount ?? 0,
      taxLabel: inv.taxLabel ?? "",
      discountType:
        (inv.discountType as "percent" | "amount" | "none") ?? "none",
      discountValue: inv.discountValue ?? 0,
      discountAmount: inv.discountAmount ?? 0,
      notes: inv.notes ?? "",
      total: inv.total,
      invoiceDate: inv.invoiceDate
        ? new Date(inv.invoiceDate).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      invoiceMonth: inv.invoiceMonth ?? "",
      changedFields: [],
      warning: "",
    } as unknown as ParsedInvoice;
  } catch {
    return null;
  }
}

export async function pendingReplyNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const { prompt, userId, pendingState } = state;

  if (!pendingState) {
    return {
      agentResult: {
        action: "unclear",
        message: "Something went wrong. Please try again.",
      },
    };
  }

  // ── awaiting_ambiguity: user was asked which invoice to COPY ──
  if (pendingState.status === "awaiting_ambiguity") {
    const invoiceRefMatch = prompt.match(/INV-\d{4}-\d+/i);
    const resolvedRef = invoiceRefMatch?.[0]?.trim() ?? prompt.trim();

    if (!resolvedRef) {
      return {
        agentResult: {
          action: "unclear",
          message: `Please reply with a valid invoice number (e.g. **INV-2026-001**).`,
        },
      };
    }

    const copierResult = await copierNode({
      ...state,
      targetRef: resolvedRef,
      prompt: pendingState.originalPrompt ?? state.prompt,
    });

    return copierResult;
  }

  if (pendingState.status === "awaiting_collision_name") {
    const copierResult = await copierNode({
      ...state,
      prompt: pendingState.originalPrompt ?? state.prompt,
      pendingState,
    });

    return copierResult;
  }

  // ── awaiting_edit_ambiguity: user was asked which invoice to EDIT ──
  if (pendingState.status === "awaiting_edit_ambiguity") {
    const replyLower = prompt.toLowerCase().trim();
    const invoiceNumberMatch = prompt.match(/INV-\d{4}-\d+/i);

    let targetInvoice: ParsedInvoice | null = null;
    let targetRef = "";

    if (invoiceNumberMatch) {
      targetRef = invoiceNumberMatch[0];
      if (userId) {
        targetInvoice = await fetchInvoiceFromDB(userId, targetRef);
      }
    } else if (replyLower === "latest" || replyLower === "most recent") {
      targetRef = "last";
      if (userId) {
        try {
          const last = await Invoice.findOne({ userId })
            .sort({ createdAt: -1 })
            .lean();
          if (last) {
            targetInvoice = {
              clientName: last.clientName,
              lineItems: last.lineItems,
              currency: (last.currency ?? "INR") as "INR" | "USD" | "EUR",
              gstPercent: last.gstPercent,
              gstType: last.gstType as "IGST" | "CGST_SGST",
              paymentTermsDays: last.paymentTermsDays,
              subtotal: last.subtotal,
              taxableAmount: last.taxableAmount ?? last.subtotal,
              gstAmount: last.gstAmount,
              cgstAmount: last.cgstAmount ?? 0,
              sgstAmount: last.sgstAmount ?? 0,
              igstAmount: last.igstAmount ?? 0,
              taxPercent: last.taxPercent ?? 0,
              taxAmount: last.taxAmount ?? 0,
              taxLabel: last.taxLabel ?? "",
              discountType:
                (last.discountType as "percent" | "amount" | "none") ?? "none",
              discountValue: last.discountValue ?? 0,
              discountAmount: last.discountAmount ?? 0,
              notes: last.notes ?? "",
              total: last.total,
              invoiceDate: last.invoiceDate
                ? new Date(last.invoiceDate).toISOString().split("T")[0]
                : new Date().toISOString().split("T")[0],
              invoiceMonth: last.invoiceMonth ?? "",
              changedFields: [],
              warning: "",
            } as unknown as ParsedInvoice;
            targetRef = last.invoiceNumber ?? "last";
          }
        } catch {
          targetInvoice = null;
        }
      }
    }

    if (!targetInvoice) {
      return {
        agentResult: {
          action: "unclear",
          message: `I couldn't find that invoice. Please reply with a valid invoice number (e.g. **INV-2026-160**) or say **latest**.`,
        },
      };
    }

    // ── Re-run the original edit on the resolved invoice ──
    // Previously this just returned the invoice as-is without applying
    // the edit. The user told us WHICH invoice to edit — now actually
    // apply the original edit (e.g. "Add 10% VAT") to it.
    const editResult = await editorNode({
      ...state,
      parsedInvoice: targetInvoice,
      targetRef,
      prompt: pendingState.originalPrompt ?? state.prompt,
    });

    return editResult;
  }

  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const formattedPrompt = PENDING_REPLY_PROMPT.replace(
    "{pendingStatus}",
    pendingState.status
  )
    .replace("{clientName}", pendingState.clientName || "unknown")
    .replace("{invoiceTotal}", String(pendingState.invoice?.total || 0))
    .replace("{originalPrompt}", pendingState.originalPrompt || "")
    .replace("{reply}", prompt);

  let classification: {
    action: string;
    correctedName?: string;
    name?: string;
    rawText?: string;
  };
  try {
    const response = await model.invoke(formattedPrompt);
    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    classification = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    classification = { action: "client_details", rawText: prompt };
  }

  const invoice = pendingState.invoice || null;
  const clientName = pendingState.clientName || "";

  if (
    classification.action === "name_correction" &&
    classification.correctedName
  ) {
    const correctedName = classification.correctedName;
    const matchResult = userId
      ? await findClientMatch(userId, correctedName)
      : { type: "none" as const, client: null, score: 0 };

    const correctedInvoice = invoice
      ? { ...invoice, clientName: correctedName }
      : invoice;

    if (matchResult.type === "exact") {
      return {
        parsedInvoice: correctedInvoice,
        matchResult,
        agentResult: {
          action: "created",
          message: `Got it! Using **${matchResult.client?.name}**'s saved details ✓`,
          invoice: correctedInvoice,
          matchResult,
        },
      };
    }

    return {
      parsedInvoice: correctedInvoice,
      agentResult: {
        action: "needs_client",
        message: `Got it! Invoice for **${correctedName}**.\n\nPlease share their contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr say **skip**.`,
        invoice: correctedInvoice,
        matchResult: { type: "none", client: null, score: 0 },
        pendingClientName: correctedName,
      } as AgentResult,
    };
  }

  if (classification.action === "check_existing") {
    if (!userId || !clientName) {
      return {
        agentResult: {
          action: "needs_client",
          message: `I don't have saved details for **${clientName}** yet. Please share their email or say **skip**.`,
          invoice,
          matchResult: { type: "none", client: null, score: 0 },
        },
      };
    }
    const matchResult = await findClientMatch(userId, clientName);
    if (matchResult.type === "exact") {
      return {
        parsedInvoice: invoice,
        matchResult,
        agentResult: {
          action: "created",
          message: `Yes! Found **${matchResult.client?.name}**'s saved details ✓`,
          invoice,
          matchResult,
        },
      };
    }
    return {
      agentResult: {
        action: "needs_client",
        message: `I don't have saved details for **${clientName}** yet. Please share their email or say **skip**.`,
        invoice,
        matchResult: { type: "none", client: null, score: 0 },
      },
    };
  }

  if (classification.action === "skip") {
    return {
      parsedInvoice: invoice,
      agentResult: {
        action: "created",
        message: `No problem! Creating invoice without client details.`,
        invoice,
        matchResult: { type: "none", client: null, score: 0 },
      },
    };
  }

  if (classification.action === "same_client" && pendingState.matchedClient) {
    return {
      parsedInvoice: invoice,
      agentResult: {
        action: "created",
        message: `Got it! Using **${
          (pendingState.matchedClient as any).name
        }**'s saved details ✓`,
        invoice,
        matchResult: {
          type: "exact",
          client: pendingState.matchedClient as any,
          score: 1,
        },
      },
    };
  }

  if (classification.action === "different_client") {
    return {
      agentResult: {
        action: "needs_client",
        message: `Got it! Please share **${clientName}**'s contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr say **skip**.`,
        invoice,
        matchResult: { type: "none", client: null, score: 0 },
      },
    };
  }

  if (classification.action === "new_client_name" && classification.name) {
    const newName = classification.name;
    const matchResult = userId
      ? await findClientMatch(userId, newName)
      : { type: "none" as const, client: null, score: 0 };

    const updatedInvoice = invoice
      ? { ...invoice, clientName: newName }
      : invoice;

    if (matchResult.type === "exact") {
      return {
        parsedInvoice: updatedInvoice,
        matchResult,
        agentResult: {
          action: "created",
          message: `Got it! Using **${matchResult.client?.name}**'s saved details ✓`,
          invoice: updatedInvoice,
          matchResult,
        },
      };
    }

    return {
      parsedInvoice: updatedInvoice,
      agentResult: {
        action: "needs_client",
        message: `Got it! Invoice for **${newName}**.\n\nPlease share their contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr say **skip**.`,
        invoice: updatedInvoice,
        matchResult: { type: "none", client: null, score: 0 },
        pendingClientName: newName,
      } as AgentResult,
    };
  }

  // Default: client_details
  return {
    parsedInvoice: invoice,
    agentResult: {
      action: "needs_client",
      message: "_parse_client_details_",
      invoice,
      matchResult: { type: "none", client: null, score: 0 },
      rawClientDetails: classification.rawText || prompt,
    } as AgentResult,
  };
}
