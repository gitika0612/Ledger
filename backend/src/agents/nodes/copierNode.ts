import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { COPIER_PROMPT } from "../prompts/invoicePrompt";
import { findClientMatch } from "../../lib/clientMatcher";
import { recalculateTotals, formatINR } from "../utils/invoiceUtils";
import { Invoice } from "../../models/Invoice";

// Parse session context blocks
function parseSessionBlocks(sessionContext: string): Array<{
  ref: string;
  clientName: string;
  total: string;
  month: string;
  raw: string;
}> {
  if (
    !sessionContext ||
    sessionContext === "No existing invoices in this session."
  )
    return [];
  const blocks = sessionContext.split("---").filter((b) => b.trim());
  return blocks
    .map((block) => {
      const clientMatch = block.match(/Client:\s*(.+)/i);
      if (!clientMatch) return null;
      return {
        ref:
          block
            .match(/Invoice Ref:\s*(.+)/i)?.[1]
            ?.replace(/\[MOST RECENT\]/i, "")
            .trim() ?? "",
        clientName: clientMatch[1].trim(),
        total: block.match(/Total:\s*₹?([\d,]+)/)?.[1]?.trim() ?? "0",
        month: block.match(/Invoice Month:\s*(.+)/i)?.[1]?.trim() ?? "",
        raw: block.trim(),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);
}

// Find matching session blocks by client name or invoice number
function findMatchingBlocks(sessionContext: string, ref: string) {
  const lower = ref.toLowerCase().trim();
  const blocks = parseSessionBlocks(sessionContext);
  return blocks.filter(
    (b) =>
      b.clientName.toLowerCase() === lower ||
      b.clientName.toLowerCase().includes(lower) ||
      b.ref.toLowerCase() === lower
  );
}

// Find the source block to copy from (returns most recent match)
function findSourceBlock(sessionContext: string, ref: string): string | null {
  const lower = ref.toLowerCase().trim();
  const blocks = parseSessionBlocks(sessionContext);
  const matching: string[] = [];

  for (const block of blocks) {
    const cn = block.clientName.toLowerCase();
    const invRef = block.ref.toLowerCase();
    if (lower && (invRef === lower || cn === lower)) {
      matching.push(block.raw);
    }
  }

  if (matching.length > 0) return matching[matching.length - 1]; // most recent

  // Fallback: last block = most recent invoice
  if (!lower || lower === "last" || lower === "last one") {
    const allBlocks = parseSessionBlocks(sessionContext);
    return allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].raw : null;
  }
  return null;
}

async function fetchLastConfirmedInvoice(userId: string): Promise<string> {
  try {
    const last = await Invoice.findOne({ userId, status: "confirmed" })
      .sort({ createdAt: -1 })
      .lean();
    if (!last) return "";
    const items = last.lineItems
      .map((i) => `${i.description} | Qty: ${i.quantity} | Rate: ₹${i.rate}`)
      .join("\n");
    return `Invoice Ref: ${last.invoiceNumber}\nClient: ${last.clientName}\nInvoice Month: ${last.invoiceMonth}\nGST: ${last.gstPercent}% ${last.gstType}\nPayment Terms: ${last.paymentTermsDays} days\nSubtotal: ₹${last.subtotal}\nTotal: ₹${last.total}\nLine Items:\n${items}`;
  } catch {
    return "";
  }
}

export async function copierNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const ref = state.targetRef || "";
  const hasSession =
    state.sessionContext &&
    state.sessionContext !== "No existing invoices in this session.";

  // ── Multiple matches → ask which one ──
  if (ref && hasSession) {
    const matches = findMatchingBlocks(state.sessionContext, ref);
    if (matches.length > 1) {
      const list = matches
        .map(
          (m) =>
            `• **${m.ref || "Draft"}** — ${m.month || "unknown"} — ₹${m.total}`
        )
        .join("\n");
      return {
        agentResult: {
          action: "ambiguous",
          message: `Found **${
            matches.length
          } invoices** for **${ref}**:\n\n${list}\n\nWhich one should I copy? Reply with the invoice number (e.g. **${
            matches[0].ref || "INV-2026-001"
          }**).`,
          targetRef: ref,
        },
      };
    }
  }

  // ── Find source block ──
  const promptLower = state.prompt.toLowerCase();
  const isCrossSession =
    !hasSession &&
    (promptLower.includes("same as last") ||
      promptLower.includes("last one") ||
      promptLower.includes("like last time") ||
      promptLower.includes("previous invoice"));

  let sourceBlock: string | null = null;

  if (isCrossSession) {
    const dbContext = await fetchLastConfirmedInvoice(state.userId);
    if (!dbContext) {
      return {
        agentResult: {
          action: "not_found",
          message: `I couldn't find any previous invoices to copy. Please create and confirm an invoice first.`,
        },
      };
    }
    sourceBlock = dbContext;
  } else if (hasSession) {
    sourceBlock = findSourceBlock(state.sessionContext, ref || "last");
    if (!sourceBlock) {
      return {
        agentResult: {
          action: "not_found",
          message: `I couldn't find **${ref}** in this session. Please check the invoice number and try again.`,
        },
      };
    }
  } else {
    return {
      agentResult: {
        action: "not_found",
        message: `There are no invoices in this session to copy. Please create an invoice first.`,
      },
    };
  }

  // ── Extract new client name from prompt ──
  // "Copy Priya's invoice for Rahul" → "Rahul"
  // "Same as last one but for Ankit" → "Ankit"
  // "Copy last invoice for a new client named Meera" → "Meera"
  const namedMatch =
    state.prompt.match(/named\s+([A-Z][a-zA-Z]+)/i)?.[1] || // "named Meera"
    state.prompt.match(/but\s+for\s+([A-Z][a-zA-Z]+)/i)?.[1] || // "but for Ankit"
    state.prompt.match(/for\s+([A-Z][a-zA-Z]{1,}?)(?:\s+with|\s*$|,)/)?.[1] || // "for Rahul"
    state.prompt.match(
      /for\s+a\s+(?:new\s+)?client\s+(?:named\s+)?([A-Z][a-zA-Z]+)/i
    )?.[1] || // "for a new client named X"
    "";
  const newClientName = namedMatch.trim() || "Client";

  // ── Use focused COPIER_PROMPT ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const structured = model.withStructuredOutput(invoiceSchema);
  const template = PromptTemplate.fromTemplate(COPIER_PROMPT);

  const currentMonth = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const currentDate = new Date().toISOString().split("T")[0];

  // Extract any override instructions from the prompt
  // e.g. "with no GST", "30 day payment terms", "with 12% GST"
  const overrideParts: string[] = [];
  const pl = state.prompt.toLowerCase();
  if (/no gst|without gst|0% gst|gst exempt/.test(pl))
    overrideParts.push("Set gstPercent=0, all GST amounts=0");
  if (/with igst/.test(pl)) overrideParts.push("Set gstType=IGST");
  const gstPctMatch = pl.match(/with\s+(\d+)%\s+gst/);
  if (gstPctMatch) overrideParts.push(`Set gstPercent=${gstPctMatch[1]}`);
  const termMatch = pl.match(/(\d+)\s*day(?:s)?\s+(?:payment\s+)?terms?/);
  if (termMatch) overrideParts.push(`Set paymentTermsDays=${termMatch[1]}`);
  const overrides =
    overrideParts.length > 0
      ? overrideParts.join("; ")
      : "None — copy all fields exactly as in source";

  const formatted = await template.format({
    sourceBlock,
    newClientName,
    currentDate,
    currentMonth,
    overrides,
  });

  const raw = (await structured.invoke(formatted)) as ParsedInvoice;
  const parsedInvoice = recalculateTotals({
    ...raw,
    clientName: newClientName,
  });

  // ── Client match for new client ──
  const matchResult = state.userId
    ? await findClientMatch(state.userId, newClientName)
    : { type: "none" as const, client: null, score: 0 };

  let action: AgentResult["action"];
  let message: string;

  if (matchResult.type === "exact") {
    action = "copied";
    message = `Copied invoice for **${newClientName}** ✓\n\nUsing their saved details. Total: **${formatINR(
      parsedInvoice.total
    )}** — review it in the side panel.`;
  } else if (matchResult.type === "partial") {
    action = "needs_client";
    message = `I found a saved client named **${matchResult.client?.name}**.\nIs **${newClientName}** the same client? Reply **same** or **different**.`;
  } else {
    action = "needs_client";
    message = `Copied invoice for **${newClientName}**!\n\nTotal: **${formatINR(
      parsedInvoice.total
    )}**\n\nPlease share their contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr say **skip**.`;
  }

  return {
    parsedInvoice,
    matchResult,
    agentResult: {
      action,
      message,
      invoice: parsedInvoice,
      matchResult,
      targetRef: ref,
    },
  };
}
