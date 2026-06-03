import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice } from "../schemas/invoiceSchema";
import { findClientMatch } from "../../lib/clientMatcher";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";
import { Invoice } from "../../models/Invoice";

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
        total: block.match(/Total:\s*[₹$€]?([\d,]+)/)?.[1]?.trim() ?? "0",
        month: block.match(/Invoice Month:\s*(.+)/i)?.[1]?.trim() ?? "",
        raw: block.trim(),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);
}

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

  if (matching.length > 0) return matching[matching.length - 1];

  if (!lower || lower === "last" || lower === "last one") {
    const allBlocks = parseSessionBlocks(sessionContext);
    return allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].raw : null;
  }
  return null;
}

function parseBlockToInvoice(block: string): ParsedInvoice | null {
  const currencyMatch = block.match(/Currency:\s*(INR|USD|EUR)/i);
  const currency: "INR" | "USD" | "EUR" = currencyMatch
    ? (currencyMatch[1].toUpperCase() as "INR" | "USD" | "EUR")
    : block.includes("$")
    ? "USD"
    : block.includes("€")
    ? "EUR"
    : "INR";

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
  const taxLineMatch = block.match(/Tax:\s*([\d.]+)%\s*(\w+)/i);
  const totalMatch = block.match(/Total:\s*[₹$€]?([\d,]+)/i);
  const subtotalMatch = block.match(/Subtotal:\s*[₹$€]?([\d,]+)/i);
  const termsMatch = block.match(/Payment Terms:\s*(\d+)/i);
  const clientMatch = block.match(/Client:\s*(.+)/i);
  const monthMatch = block.match(/Invoice Month:\s*(.+)/i);

  if (!totalMatch) return null;

  const subtotal = parseInt((subtotalMatch?.[1] ?? "0").replace(/,/g, ""));
  const total = parseInt((totalMatch[1] ?? "0").replace(/,/g, ""));
  const gstAmount = total - subtotal;

  const fallbackLineItems = [
    {
      description: "Services",
      quantity: 1,
      unit: "item",
      rate: subtotal,
      amount: subtotal,
      hsnSacCode: "",
      hsnSacType: "SAC" as const,
    },
  ];

  if (currency === "INR") {
    const gstPercent = parseFloat(gstMatch?.[1] ?? "18");
    const gstType =
      (gstMatch?.[2] ?? "CGST_SGST") === "IGST"
        ? ("IGST" as const)
        : ("CGST_SGST" as const);

    return {
      clientName: clientMatch?.[1]?.trim() ?? "Client",
      currency,
      lineItems: lineItems.length > 0 ? lineItems : fallbackLineItems,
      gstPercent,
      gstType,
      gstAmount,
      cgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
      sgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
      igstAmount: gstType === "IGST" ? gstAmount : 0,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      paymentTermsDays: parseInt(termsMatch?.[1] ?? "15"),
      subtotal,
      taxableAmount: subtotal,
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
  } else {
    const taxPercent = taxLineMatch
      ? parseFloat(taxLineMatch[1])
      : gstMatch
      ? parseFloat(gstMatch[1])
      : 0;
    const taxLabel = taxLineMatch?.[2] || (currency === "EUR" ? "VAT" : "Tax");
    const taxAmount =
      gstAmount > 0 ? gstAmount : Math.round((subtotal * taxPercent) / 100);

    return {
      clientName: clientMatch?.[1]?.trim() ?? "Client",
      currency,
      lineItems: lineItems.length > 0 ? lineItems : fallbackLineItems,
      gstPercent: 0,
      gstType: "CGST_SGST" as const,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxPercent,
      taxAmount,
      taxLabel,
      paymentTermsDays: parseInt(termsMatch?.[1] ?? "15"),
      subtotal,
      taxableAmount: subtotal,
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
}

async function fetchLastConfirmedInvoice(
  userId: string
): Promise<ParsedInvoice | null> {
  try {
    const last = await Invoice.findOne({ userId, status: "confirmed" })
      .sort({ createdAt: -1 })
      .lean();
    if (!last) return null;
    return {
      clientName: last.clientName,
      lineItems: last.lineItems,
      currency: last.currency ?? "INR",
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
  } catch {
    return null;
  }
}

// ── Parse amount override from prompt for a specific currency ──
function parseAmountOverride(
  prompt: string,
  currency: "INR" | "USD" | "EUR"
): number | null {
  let match: RegExpMatchArray | null = null;
  if (currency === "USD") {
    match = prompt.match(
      /\$\s*([\d,]+(?:\.\d+)?k?)|USD\s*([\d,]+(?:\.\d+)?k?)/i
    );
  } else if (currency === "EUR") {
    match = prompt.match(
      /€\s*([\d,]+(?:\.\d+)?k?)|EUR\s*([\d,]+(?:\.\d+)?k?)/i
    );
  } else {
    match = prompt.match(
      /₹\s*([\d,]+(?:\.\d+)?k?)|Rs\.?\s*([\d,]+(?:\.\d+)?k?)|INR\s*([\d,]+(?:\.\d+)?k?)/i
    );
  }
  if (!match) return null;
  const raw = (match[1] || match[2] || match[3] || "").replace(/,/g, "");
  if (!raw) return null;
  const isK = raw.toLowerCase().endsWith("k");
  const num = parseFloat(isK ? raw.slice(0, -1) : raw);
  return isK ? num * 1000 : num;
}

export async function copierNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  console.log("=== COPIER NODE ===");
  console.log("targetRef:", state.targetRef);

  const ref = state.targetRef || "";
  const hasSession =
    state.sessionContext &&
    state.sessionContext !== "No existing invoices in this session.";

  // ── Multiple matches → ask which one ──
  if (ref && hasSession && ref !== "last" && ref !== "last one") {
    const matches = findMatchingBlocks(state.sessionContext, ref);
    if (matches.length > 1) {
      const list = matches
        .map(
          (m) =>
            `• **${m.ref || "Draft"}** — ${m.month || "unknown"} — ${m.total}`
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

  const promptLower = state.prompt.toLowerCase();
  const isCrossSession =
    !hasSession &&
    (promptLower.includes("same as last") ||
      promptLower.includes("last one") ||
      promptLower.includes("like last time") ||
      promptLower.includes("previous invoice"));

  let sourceInv: ParsedInvoice | null = null;

  if (state.parsedInvoice && state.parsedInvoice.clientName) {
    sourceInv = state.parsedInvoice;
  } else if (hasSession) {
    const lookupRef = ref || "last";
    const block = findSourceBlock(state.sessionContext, lookupRef);
    if (block) {
      sourceInv = parseBlockToInvoice(block);
      if (sourceInv)
        console.log(
          "✅ Priority 2: parsed from session context, client:",
          sourceInv.clientName,
          "currency:",
          sourceInv.currency,
          "taxPercent:",
          sourceInv.taxPercent
        );
    }
    if (!sourceInv) {
      return {
        agentResult: {
          action: "not_found",
          message:
            ref && ref !== "last"
              ? `I couldn't find **${ref}** in this session. Please check the invoice number and try again.`
              : `There are no invoices in this session to copy. Please create an invoice first.`,
        },
      };
    }
  } else if (isCrossSession) {
    sourceInv = await fetchLastConfirmedInvoice(state.userId);
    if (!sourceInv) {
      return {
        agentResult: {
          action: "not_found",
          message: `I couldn't find any previous invoices to copy. Please create and confirm an invoice first.`,
        },
      };
    }
    console.log("✅ Priority 3: last confirmed from DB");
  } else {
    return {
      agentResult: {
        action: "not_found",
        message: `There are no invoices in this session to copy. Please create an invoice first.`,
      },
    };
  }

  //  Extract new client name — greedy match, handles "for X but" pattern ──
  const namedMatch =
    state.prompt.match(/named\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
    state.prompt.match(/but\s+for\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
    state.prompt.match(
      /for\s+([A-Z][a-zA-Z]+)(?:\s+but|\s+with|\s+in\s|\s*$|,)/i
    )?.[1] ||
    state.prompt.match(
      /for\s+a\s+(?:new\s+)?client\s+(?:named\s+)?([A-Z][a-zA-Z]+)/i
    )?.[1] ||
    "";
  const newClientName = namedMatch.trim() || "Client";

  //  Detect currency override in prompt ──
  const promptCurrency: "INR" | "USD" | "EUR" | null = /\$|USD|dollars?/i.test(
    state.prompt
  )
    ? "USD"
    : /€|EUR|euros?/i.test(state.prompt)
    ? "EUR"
    : /₹|INR|Rs\.?|rupees?/i.test(state.prompt)
    ? "INR"
    : null;

  const currency = (promptCurrency ?? sourceInv.currency ?? "INR") as
    | "INR"
    | "USD"
    | "EUR";
  const currencyChanged =
    promptCurrency !== null && promptCurrency !== sourceInv.currency;

  //  Detect amount override in prompt ──
  const amountOverride = parseAmountOverride(state.prompt, currency);

  // ── Apply overrides ──
  let gstPercent =
    currencyChanged && currency !== "INR" ? 0 : sourceInv.gstPercent;
  let gstType = sourceInv.gstType ?? "CGST_SGST";
  let taxPercent =
    currencyChanged && currency === "INR" ? 0 : sourceInv.taxPercent ?? 0;
  let taxLabel =
    sourceInv.taxLabel ||
    (currency === "EUR" ? "VAT" : currency === "USD" ? "Tax" : "");
  let paymentTermsDays = sourceInv.paymentTermsDays;

  const pl = state.prompt.toLowerCase();

  if (currency === "INR") {
    if (/no gst|without gst|0% gst|gst exempt/.test(pl)) gstPercent = 0;
    const gstPctOverride = pl.match(/with\s+(\d+(?:\.\d+)?)\s*%\s*gst/);
    if (gstPctOverride) gstPercent = parseFloat(gstPctOverride[1]);
    if (/with igst/.test(pl)) gstType = "IGST";
    if (/with cgst|with cgst.sgst/.test(pl)) gstType = "CGST_SGST";
  } else {
    // USD/EUR: reset GST, apply tax overrides
    gstPercent = 0;
    if (/no tax|no vat|0% tax|0% vat|tax exempt/.test(pl)) taxPercent = 0;
    const taxPctOverride = pl.match(/with\s+(\d+(?:\.\d+)?)\s*%\s*(?:tax|vat)/);
    if (taxPctOverride) taxPercent = parseFloat(taxPctOverride[1]);
    taxLabel = currency === "EUR" ? "VAT" : "Tax";
  }

  const termOverride = pl.match(/(\d+)\s*day(?:s)?\s+(?:payment\s+)?terms?/);
  const netOverride = pl.match(/net\s+(\d+)/);
  if (termOverride) paymentTermsDays = parseInt(termOverride[1]);
  else if (netOverride) paymentTermsDays = parseInt(netOverride[1]);

  // ── Build line items — apply amount override if currency changed or amount specified ──
  let lineItems = sourceInv.lineItems;
  if (amountOverride !== null) {
    // Override all line items to single item with new amount
    lineItems = [
      {
        description: sourceInv.lineItems[0]?.description || "Services",
        quantity: 1,
        unit: sourceInv.lineItems[0]?.unit || "item",
        rate: amountOverride,
        amount: amountOverride,
        hsnSacCode: "",
        hsnSacType: "SAC" as const,
      },
    ];
  } else if (currencyChanged) {
    // Currency changed but no amount specified — keep descriptions, reset amounts to 0 so user can update
    lineItems = sourceInv.lineItems.map((item) => ({
      ...item,
      rate: 0,
      amount: 0,
    }));
  }

  // ── Build copied invoice ──
  const now = new Date();
  const parsedInvoice = recalculateTotals({
    ...sourceInv,
    clientName: newClientName,
    currency,
    invoiceDate: now.toISOString().split("T")[0],
    invoiceMonth: now.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    }),
    lineItems,
    gstPercent,
    gstType,
    taxPercent,
    taxLabel,
    paymentTermsDays,
    // Reset GST amounts when switching to USD/EUR
    gstAmount: currency !== "INR" ? 0 : (undefined as unknown as number),
    cgstAmount: currency !== "INR" ? 0 : (undefined as unknown as number),
    sgstAmount: currency !== "INR" ? 0 : (undefined as unknown as number),
    igstAmount: currency !== "INR" ? 0 : (undefined as unknown as number),
    discountType: sourceInv.discountType ?? "none",
    discountValue: sourceInv.discountValue ?? 0,
    notes: sourceInv.notes ?? "",
    changedFields: [],
    warning: "",
  });

  // ── Client match ──
  const matchResult = state.userId
    ? await findClientMatch(state.userId, newClientName)
    : { type: "none" as const, client: null, score: 0 };

  let action: AgentResult["action"];
  let message: string;

  if (matchResult.type === "exact") {
    action = "copied";
    message = `Copied invoice for **${newClientName}** ✓\n\nUsing their saved details. Total: **${formatCurrency(
      parsedInvoice.total,
      parsedInvoice.currency
    )}** — review it in the side panel.`;
  } else if (matchResult.type === "partial") {
    action = "needs_client";
    message = `I found a saved client named **${matchResult.client?.name}**.\nIs **${newClientName}** the same client? Reply **same** or **different**.`;
  } else {
    action = "needs_client";
    message = `Copied invoice for **${newClientName}**!\n\nTotal: **${formatCurrency(
      parsedInvoice.total,
      parsedInvoice.currency
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
