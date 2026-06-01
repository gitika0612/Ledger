import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { GENERATOR_PROMPT } from "../prompts/invoicePrompt";
import { findClientMatch } from "../../lib/clientMatcher";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";
import { buildCurrencyContext } from "../utils/currencyService";

export async function generatorNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  // ── SPLIT INVOICE — use existing session invoice if available ──
  // Use parsedInvoice from state (set by handleSend from session) instead of calling LLM.
  if (state.isSplit && state.splitCount > 1) {
    const sourceInvoice = state.parsedInvoice;
    if (!sourceInvoice || sourceInvoice.subtotal === 0) {
      return {
        agentResult: {
          action: "not_found",
          message: `I couldn't find the invoice to split. Please specify which invoice to split.`,
        },
      };
    }
    const finalInvoice = sourceInvoice;
    const parts = state.splitCount;
    // Split the SUBTOTAL (pre-GST), recalculate GST per part
    const baseSubtotal = finalInvoice.subtotal;
    const subtotalPerPart = Math.round(baseSubtotal / parts);

    const invoices: ParsedInvoice[] = Array.from({ length: parts }, (_, i) => {
      const splitItems = finalInvoice.lineItems.map((item) => ({
        ...item,
        rate: Math.round(item.rate / parts),
        amount: Math.round(item.amount / parts),
      }));
      return recalculateTotals({
        ...finalInvoice,
        lineItems: splitItems,
        notes: `Split invoice ${i + 1} of ${parts}${
          finalInvoice.notes ? ` — ${finalInvoice.notes}` : ""
        }`,
      });
    });

    const matchResult = state.userId
      ? await findClientMatch(state.userId, finalInvoice.clientName)
      : { type: "none" as const, client: null, score: 0 };

    const invoicesWithMatch = invoices.map((inv) => ({
      invoice: inv,
      matchResult,
    }));

    return {
      parsedInvoice: finalInvoice,
      parsedInvoices: invoices,
      invoicesWithMatch,
      matchResult,
      agentResult: {
        action: "multi_created",
        message: `Done! Split **${formatCurrency(
          baseSubtotal,
          finalInvoice.currency
        )}** into **${parts} equal invoices** of **${formatCurrency(
          subtotalPerPart,
          finalInvoice.currency
        )}** each for **${
          finalInvoice.clientName
        }**. Review them in the side panel.`,
        invoices,
        invoicesWithMatch,
        splitDetails: {
          originalAmount: baseSubtotal,
          parts,
          amountPerPart: subtotalPerPart,
        },
      },
    };
  }

  // ── SINGLE INVOICE — call LLM to parse the prompt ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
  const structured = model.withStructuredOutput(invoiceSchema);
  const template = PromptTemplate.fromTemplate(GENERATOR_PROMPT);
  const currentMonth = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const currentDate = new Date().toISOString().split("T")[0];
  const currencyRates = await buildCurrencyContext();
  const formatted = await template.format({
    prompt: state.prompt,
    memoryContext: state.memoryContext,
    currentMonth,
    currentDate,
    currencyRates,
  });
  const raw = (await structured.invoke(formatted)) as ParsedInvoice;
  const finalInvoice = recalculateTotals(raw);

  const matchResult = state.userId
    ? await findClientMatch(state.userId, finalInvoice.clientName)
    : { type: "none" as const, client: null, score: 0 };

  const isMilestone = finalInvoice.lineItems.some((i) =>
    i.description.toLowerCase().includes("milestone")
  );
  const isAdvance = finalInvoice.lineItems.some((i) =>
    i.description.toLowerCase().includes("advance")
  );
  const isRetainer = finalInvoice.lineItems.some((i) =>
    i.description.toLowerCase().includes("retainer")
  );
  const isCreditNote = (finalInvoice.notes ?? "")
    .toLowerCase()
    .includes("credit");

  const typeLabel = isCreditNote
    ? "Credit note"
    : isAdvance
    ? "Advance invoice"
    : isMilestone
    ? "Milestone invoice"
    : isRetainer
    ? "Retainer invoice"
    : "Invoice";

  let action: AgentResult["action"];
  let message: string;

  if (matchResult.type === "exact") {
    action = "created";
    message = `Got it! Using **${
      matchResult.client?.name
    }**'s saved details ✓\n\n${typeLabel} of **${formatCurrency(
      finalInvoice.total,
      finalInvoice.currency
    )}** ready for **${
      finalInvoice.clientName
    }**. Review it in the side panel.`;
  } else if (matchResult.type === "partial") {
    action = "needs_client";
    message = `I found a saved client named **${matchResult.client?.name}**.\nIs **${finalInvoice.clientName}** the same client? Reply **same** or **different**.`;
  } else {
    action = "needs_client";
    message = `${typeLabel} of **${formatCurrency(
      finalInvoice.total,
      finalInvoice.currency
    )}** is ready for **${
      finalInvoice.clientName
    }**!\n\nPlease share their contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr type **skip** to continue without details.`;
  }

  return {
    parsedInvoice: finalInvoice,
    matchResult,
    agentResult: { action, message, invoice: finalInvoice, matchResult },
  };
}
