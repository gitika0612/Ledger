import { ChatOpenAI } from "@langchain/openai";
import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { GENERATOR_PROMPT } from "../prompts/invoicePrompt";
import { findClientMatch } from "../../lib/clientMatcher";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";
import { buildCurrencyContext } from "../utils/currencyService";
import { Invoice } from "../../models/Invoice";

function extractClientNameFromPrompt(prompt: string): string | null {
  const commonWords = new Set([
    "invoice",
    "bill",
    "create",
    "make",
    "generate",
    "for",
    "to",
    "with",
    "and",
    "or",
    "gst",
    "monthly",
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "from",
    "by",
    "per",
    "hour",
    "day",
    "item",
    "service",
    "payment",
    "terms",
    "days",
    "net",
    "add",
    "change",
    "update",
    "edit",
    "copy",
    "same",
    "duplicate",
    "like",
    "last",
    "previous",
    "next",
  ]);
  const words = prompt.split(/\s+/);
  const candidate = words.find(
    (w) => w.length > 2 && /^[A-Z]/.test(w) && !commonWords.has(w.toLowerCase())
  );
  return candidate || null;
}

async function fetchClientMemoryContext(
  userId: string,
  prompt: string
): Promise<string> {
  const clientName = extractClientNameFromPrompt(prompt);
  if (!clientName) return "No past invoice history for this client.";

  try {
    let invoices = await Invoice.find({
      userId,
      clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
      status: "confirmed",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    if (invoices.length === 0) {
      invoices = await Invoice.find({
        userId,
        clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    }

    if (invoices.length === 0)
      return "No past invoice history for this client.";

    // Only return tax/terms defaults — NOT line items or amounts
    // so the LLM never uses old amounts when the current prompt specifies new ones
    const latest = invoices[0];
    const latestCurrency = latest.currency ?? "INR";
    // Never propagate IGST as default — only use it if prompt explicitly says IGST
    const gstTypeDefault = "CGST_SGST";
    const taxInfo =
      latestCurrency === "INR"
        ? `GST ${latest.gstPercent ?? 18}% ${gstTypeDefault}`
        : `${latest.taxLabel || (latestCurrency === "EUR" ? "VAT" : "Tax")} ${
            latest.taxPercent ?? 0
          }%`;
    return `Client ${clientName} defaults — use ONLY for fields not specified in current prompt: currency=${latestCurrency}, ${taxInfo}, paymentTerms=${
      latest.paymentTermsDays ?? 15
    }days. NEVER copy line item amounts from history.`;
  } catch {
    return "No past invoice history for this client.";
  }
}

function parseSessionBlocks(sessionContext: string) {
  if (
    !sessionContext ||
    sessionContext === "No existing invoices in this session."
  )
    return [];
  return sessionContext
    .split("---")
    .filter((b) => b.trim())
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
        raw: block.trim(),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);
}

function parseBlockToInvoice(block: string): ParsedInvoice | null {
  const lineItemsMatch = [
    ...block.matchAll(
      /-\s*(.+?)\s*\|\s*Qty:\s*([\d.]+)\s*(.+?)\s*\|\s*Rate:\s*[₹$€]?([\d,]+)\s*\|\s*Amount:\s*[₹$€]?([\d,]+)/g
    ),
  ];
  const lineItems = lineItemsMatch.map((m) => ({
    description: m[1].trim(),
    quantity: parseFloat(m[2]),
    unit: m[3].trim(),
    rate: parseInt(m[4].replace(/,/g, "")),
    amount: parseInt(m[5].replace(/,/g, "")),
    hsnSacCode: "",
    hsnSacType: "SAC" as const,
  }));

  const gstMatch = block.match(/GST:\s*([\d.]+)%\s*(\w+)/i);
  const totalMatch = block.match(/Total:\s*[₹$€]?([\d,]+)/i);
  const subtotalMatch = block.match(/Subtotal:\s*[₹$€]?([\d,]+)/i);
  const termsMatch = block.match(/Payment Terms:\s*(\d+)/i);
  const clientMatch = block.match(/Client:\s*(.+)/i);
  const monthMatch = block.match(/Invoice Month:\s*(.+)/i);

  if (!totalMatch) return null;

  const subtotal = parseInt((subtotalMatch?.[1] ?? "0").replace(/,/g, ""));
  const total = parseInt((totalMatch[1] ?? "0").replace(/,/g, ""));
  const gstPercent = parseFloat(gstMatch?.[1] ?? "0");
  const gstType =
    (gstMatch?.[2] ?? "CGST_SGST") === "IGST"
      ? ("IGST" as const)
      : ("CGST_SGST" as const);
  const gstAmount = total - subtotal;

  return {
    clientName: clientMatch?.[1]?.trim() ?? "Client",
    lineItems:
      lineItems.length > 0
        ? lineItems
        : [
            {
              description: "Services",
              quantity: 1,
              unit: "item",
              rate: subtotal,
              amount: subtotal,
              hsnSacCode: "",
              hsnSacType: "SAC" as const,
            },
          ],
    gstPercent,
    gstType,
    paymentTermsDays: parseInt(termsMatch?.[1] ?? "15"),
    subtotal,
    taxableAmount: subtotal,
    gstAmount,
    cgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
    sgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
    igstAmount: gstType === "IGST" ? gstAmount : 0,
    discountType: "none" as const,
    discountValue: 0,
    discountAmount: 0,
    notes: "",
    total,
    invoiceDate: new Date().toISOString().split("T")[0],
    invoiceMonth:
      monthMatch?.[1]?.trim() ??
      new Date().toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      }),
    changedFields: [],
    warning: "",
  } as unknown as ParsedInvoice;
}

async function resolveSplitSource(
  state: InvoiceAgentState
): Promise<ParsedInvoice | null> {
  if (state.parsedInvoice && state.parsedInvoice.subtotal > 0)
    return state.parsedInvoice;

  const blocks = parseSessionBlocks(state.sessionContext);
  if (blocks.length > 0) {
    const ref = state.targetRef?.toLowerCase().trim() || "";
    let block = ref
      ? blocks.find(
          (b) =>
            b.ref.toLowerCase() === ref ||
            b.clientName.toLowerCase() === ref ||
            b.clientName.toLowerCase().includes(ref)
        )
      : blocks[blocks.length - 1];
    if (!block) block = blocks[blocks.length - 1];
    if (block) {
      const inv = parseBlockToInvoice(block.raw);
      if (inv) {
        console.log(
          "✅ Generator split: resolved from sessionContext, client:",
          inv.clientName
        );
        return inv;
      }
    }
  }

  if (state.userId) {
    const ref = state.targetRef;
    const query: Record<string, unknown> = { userId: state.userId };
    if (ref && /^INV-/i.test(ref))
      query.invoiceNumber = { $regex: new RegExp(`^${ref}$`, "i") };
    else if (ref) query.clientName = { $regex: new RegExp(`^${ref}$`, "i") };
    const inv = await Invoice.findOne(query).sort({ createdAt: -1 }).lean();
    if (inv) {
      console.log(
        "✅ Generator split: resolved from DB, client:",
        inv.clientName
      );
      return {
        clientName: inv.clientName,
        lineItems: inv.lineItems,
        currency: inv.currency,
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
    }
  }
  return null;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

export async function generatorNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  // ── SPLIT INVOICE ──
  if (state.isSplit && state.splitCount > 1) {
    const sourceInvoice = await resolveSplitSource(state);
    if (!sourceInvoice || sourceInvoice.subtotal === 0) {
      return {
        agentResult: {
          action: "not_found",
          message: `I couldn't find the invoice to split. Please specify which invoice to split (e.g. "Split Ankit's invoice into 2 parts").`,
        },
      };
    }

    const parts = state.splitCount;
    const baseSubtotal = sourceInvoice.subtotal;
    const subtotalPerPart = Math.round(baseSubtotal / parts);

    const invoices: ParsedInvoice[] = Array.from({ length: parts }, (_, i) => {
      const splitItems = sourceInvoice.lineItems.map((item) => ({
        ...item,
        rate: Math.round(item.rate / parts),
        amount: Math.round(item.amount / parts),
      }));
      return recalculateTotals({
        ...sourceInvoice,
        lineItems: splitItems,
        notes: `Split invoice ${i + 1} of ${parts}${
          sourceInvoice.notes ? ` — ${sourceInvoice.notes}` : ""
        }`,
      });
    });

    const matchResult = state.userId
      ? await findClientMatch(state.userId, sourceInvoice.clientName)
      : { type: "none" as const, client: null, score: 0 };

    const invoicesWithMatch = invoices.map((inv) => ({
      invoice: inv,
      matchResult,
    }));

    return {
      parsedInvoice: sourceInvoice,
      parsedInvoices: invoices,
      invoicesWithMatch,
      matchResult,
      agentResult: {
        action: "multi_created",
        message: `Done! Split **${formatCurrency(
          baseSubtotal,
          sourceInvoice.currency
        )}** (pre-GST) into **${parts} equal invoices** of **${formatCurrency(
          subtotalPerPart,
          sourceInvoice.currency
        )}** each for **${
          sourceInvoice.clientName
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

  // ── SINGLE INVOICE ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const memoryContext = state.userId
    ? await fetchClientMemoryContext(state.userId, state.prompt)
    : "No past invoice history for this client.";

  const structured = model.withStructuredOutput(invoiceSchema);
  const currentMonth = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const currentDate = new Date().toISOString().split("T")[0];
  const currencyRates = await buildCurrencyContext();

  const formatted = fillTemplate(GENERATOR_PROMPT, {
    prompt: state.prompt,
    memoryContext,
    currentMonth,
    currentDate,
    currencyRates,
  });

  const raw = (await structured.invoke(formatted)) as ParsedInvoice;

  // ── Debug log ──
  console.log(
    "🔍 Raw parsed:",
    JSON.stringify({
      clientName: raw.clientName,
      currency: raw.currency,
      lineItems: raw.lineItems?.map((i) => ({
        desc: i.description,
        qty: i.quantity,
        rate: i.rate,
        amount: i.amount,
      })),
      taxPercent: raw.taxPercent,
      gstPercent: raw.gstPercent,
      total: raw.total,
      warning: raw.warning,
    })
  );

  // Capture warning before recalculate, make it currency-aware
  const rawWarning = raw.warning || "";
  const warning =
    rawWarning && raw.currency === "EUR"
      ? rawWarning.replace("Tax rate", "VAT rate")
      : rawWarning;

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
    agentResult: {
      action,
      message,
      invoice: finalInvoice,
      matchResult,
      warning: warning || undefined,
    },
  };
}
