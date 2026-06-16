import { ChatOpenAI } from "@langchain/openai";
import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { GENERATOR_PROMPT } from "../prompts/invoicePrompt";
import { findClientMatch } from "../../lib/clientMatcher";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";
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
      .limit(3)
      .lean();

    if (invoices.length === 0) {
      invoices = await Invoice.find({
        userId,
        clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean();
    }
    if (invoices.length === 0)
      return "No past invoice history for this client.";

    const latest = invoices[0];
    const latestCurrency = latest.currency ?? "INR";
    const taxInfo =
      latestCurrency === "INR"
        ? `GST ${latest.gstPercent ?? 18}% CGST_SGST`
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
      if (inv) return inv;
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

/**
 * Deterministically correct the invoice based on prompt keywords.
 * Runs AFTER the LLM — overrides all tax fields.
 * LLM is trusted only for: clientName, lineItem descriptions, currency,
 * paymentTermsDays, invoiceDate, invoiceMonth, notes, discount fields.
 */

// Extract the stated base amount from the prompt (handles Indian comma formatting)
// Returns null if prompt has multiple line items or per-unit pricing (let LLM handle those)
function extractStatedBaseAmount(prompt: string): number | null {
  // Skip if prompt has multiple amounts (multi-line-item invoice)
  const allAmounts = [...prompt.matchAll(/[₹$€]([0-9,]+(?:\.[0-9]+)?)/g)];
  if (allAmounts.length > 1) return null; // let LLM handle multi-item

  // Skip per-unit pricing like "₹10,000/day" — LLM calculates total correctly
  if (/\/\s*(day|hour|hr|month|item|unit|piece|kg)/i.test(prompt)) return null;

  // ₹ with Indian commas
  const m1 = prompt.match(/[₹]([0-9,]+(?:\.[0-9]+)?)/);
  if (m1) return parseInt(m1[1].replace(/,/g, ""));
  // lakh suffix
  const m2 = prompt.match(/[₹]?([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|L)/i);
  if (m2) return parseFloat(m2[1]) * 100000;
  // k suffix
  const m3 = prompt.match(/[₹]?([0-9]+(?:\.[0-9]+)?)\s*k/i);
  if (m3) return parseFloat(m3[1]) * 1000;
  // $ or €
  const m4 = prompt.match(/[$€]([0-9,]+(?:\.[0-9]+)?)/);
  if (m4) return parseFloat(m4[1].replace(/,/g, ""));
  return null;
}

// Extract tax rate ONLY from tax-adjacent context (not split % like "40% design")
function extractTaxRate(prompt: string): number {
  // "X% GST/VAT/Tax/IGST/CGST/SGST"
  const m1 = prompt.match(
    /(\d+(?:\.\d+)?)\s*%\s*(gst|vat|tax|igst|cgst|sgst)\b/i
  );
  if (m1) return parseFloat(m1[1]);
  // "GST/VAT/Tax X%" or "GST/VAT/Tax @X%" or "GST/VAT/Tax of X%"
  const m2 = prompt.match(
    /\b(gst|vat|tax|igst|cgst|sgst)\b[^%\d]*?(\d+(?:\.\d+)?)\s*%/i
  );
  if (m2) return parseFloat(m2[2]);
  // "with X%" — only if not followed by a non-tax descriptor word
  const m3 = prompt.match(/with\s+(\d+(?:\.\d+)?)\s*%\s*([a-z]*)/i);
  if (m3) {
    const word = (m3[2] || "").toLowerCase();
    const nonTaxWords = [
      "design",
      "development",
      "dev",
      "advance",
      "deposit",
      "off",
      "discount",
      "markup",
    ];
    if (!nonTaxWords.includes(word)) return parseFloat(m3[1]);
  }
  return 0;
}

// Detect "plus tax" / "ex. tax" — unknown rate, needs warning
function detectPlusTax(prompt: string): boolean {
  return /(plus\s+tax|plus\s+vat|ex\.\s*tax|ex\.\s*vat)/i.test(prompt);
}

function applyTaxCorrection(raw: ParsedInvoice, prompt: string): ParsedInvoice {
  const currency = raw.currency ?? "INR";
  const statedTotal = raw.total;

  const isInclusive = /\b(inclusive|included|including|incl\.)\b/i.test(prompt);
  console.log("🔍 applyTax:", { isInclusive, prompt: prompt.slice(0, 50) });

  const isNoTax =
    /(no\s+vat|no\s+tax|no\s+gst|excluding|excludes|excl\.|tax[\s-]?exempt|tax[\s-]?free|0%\s*(vat|tax|gst)?)/i.test(
      prompt
    );
  const isPlusTax = detectPlusTax(prompt);
  const promptRate = extractTaxRate(prompt);
  const hasRate = promptRate > 0;

  // ── Case 1: No tax / Excluding ──
  if (isNoTax && !isInclusive) {
    return {
      ...raw,
      isTaxInclusive: false,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: currency === "EUR" ? "VAT" : currency === "USD" ? "Tax" : "",
      gstPercent: 0,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      warning: "",
    };
  }

  // ── Case 2: "plus tax" / "ex. tax" — unknown rate ──
  if (isPlusTax && !isInclusive) {
    const taxLabel =
      currency === "EUR" ? "VAT" : currency === "USD" ? "Tax" : "GST";
    return {
      ...raw,
      isTaxInclusive: false,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: currency !== "INR" ? taxLabel : "",
      gstPercent: 0,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      warning: `Tax rate not specified — set to 0%. Please update if needed.`,
    };
  }

  console.log("🔍 beforeCase5:", { isInclusive, hasRate, promptRate });
  // ── Case 3: Inclusive WITH rate — back-calculate ──
  if (isInclusive && hasRate) {
    const preTax = Math.round((statedTotal * 100) / (100 + promptRate));
    const taxAmt = statedTotal - preTax;
    const items = (
      raw.lineItems?.length > 0
        ? raw.lineItems
        : [
            {
              description: "Services",
              quantity: 1,
              unit: "item",
              rate: preTax,
              amount: preTax,
              hsnSacCode: "",
              hsnSacType: "SAC" as const,
            },
          ]
    ).map((item, i) =>
      i === 0 ? { ...item, amount: preTax, rate: preTax } : item
    );
    if (currency === "INR") {
      const gstType = raw.gstType || "CGST_SGST";
      return {
        ...raw,
        isTaxInclusive: true,
        gstPercent: promptRate,
        gstAmount: taxAmt,
        cgstAmount: gstType === "CGST_SGST" ? Math.round(taxAmt / 2) : 0,
        sgstAmount:
          gstType === "CGST_SGST" ? taxAmt - Math.round(taxAmt / 2) : 0,
        igstAmount: gstType === "IGST" ? taxAmt : 0,
        taxPercent: 0,
        taxAmount: 0,
        taxLabel: "",
        lineItems: items,
        subtotal: preTax,
        taxableAmount: preTax,
        total: statedTotal,
        warning: "",
      };
    } else {
      return {
        ...raw,
        isTaxInclusive: true,
        taxPercent: promptRate,
        taxAmount: taxAmt,
        taxLabel: raw.taxLabel || (currency === "EUR" ? "VAT" : "Tax"),
        gstPercent: 0,
        gstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        lineItems: items,
        subtotal: preTax,
        taxableAmount: preTax,
        total: statedTotal,
        warning: "",
      };
    }
  }

  // ── Case 4: Inclusive WITHOUT rate — warn ──
  if (isInclusive && !hasRate) {
    const warningLabel =
      currency === "EUR" ? "VAT" : currency === "USD" ? "Tax" : "GST";
    const items = (raw.lineItems?.length > 0 ? raw.lineItems : []).map(
      (item, i) =>
        i === 0 ? { ...item, amount: statedTotal, rate: statedTotal } : item
    );
    return {
      ...raw,
      isTaxInclusive: true,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: currency !== "INR" ? warningLabel : "",
      gstPercent: 0,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      lineItems:
        items.length > 0
          ? items
          : [
              {
                description: "Services",
                quantity: 1,
                unit: "item",
                rate: statedTotal,
                amount: statedTotal,
                hsnSacCode: "",
                hsnSacType: "SAC" as const,
              },
            ],
      subtotal: statedTotal,
      taxableAmount: statedTotal,
      total: statedTotal,
      warning: `${warningLabel} rate not specified — set to 0%. Please update if needed.`,
    };
  }

  // ── Case 5: Add-on tax WITH rate — let recalculateTotals compute ──
  if (!isInclusive && hasRate) {
    // Fix lineItems if LLM back-calculated the amount (treating add-on as inclusive).
    // If single line item and a clear stated amount exists, use it directly.
    const statedBase = extractStatedBaseAmount(prompt);
    console.log("🔍 Case5:", {
      statedBase,
      lineItemsLen: raw.lineItems?.length,
      llmAmt: raw.lineItems?.[0]?.amount,
    });
    let correctedLineItems = raw.lineItems;
    if (
      statedBase !== null &&
      raw.lineItems !== null &&
      raw.lineItems !== undefined &&
      raw.lineItems.length === 1
    ) {
      const llmAmount = raw.lineItems[0].amount;
      const diffPct =
        statedBase > 0 ? Math.abs(llmAmount - statedBase) / statedBase : 0;
      if (
        diffPct > 0.005 ||
        (statedBase % 100 === 0 && Math.abs(llmAmount - statedBase) <= 10)
      ) {
        correctedLineItems = [
          { ...raw.lineItems[0], amount: statedBase, rate: statedBase },
        ];
        console.log("✅ Case5 lineItem corrected:", llmAmount, "→", statedBase);
      }
    }
    if (currency === "INR") {
      return {
        ...raw,
        isTaxInclusive: false,
        gstPercent: promptRate,
        taxPercent: 0,
        taxAmount: 0,
        taxLabel: "",
        lineItems: correctedLineItems,
        subtotal: correctedLineItems[0]?.amount ?? raw.subtotal,
        warning: "",
      };
    } else {
      return {
        ...raw,
        isTaxInclusive: false,
        taxPercent: promptRate,
        taxLabel: raw.taxLabel || (currency === "EUR" ? "VAT" : "Tax"),
        gstPercent: 0,
        gstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        lineItems: correctedLineItems,
        subtotal: correctedLineItems[0]?.amount ?? raw.subtotal,
        warning: "",
      };
    }
  }

  // ── Case 6: No tax mention — INR gets default 18% GST, USD/EUR get 0 ──
  if (currency === "INR") {
    // Keep whatever GST the LLM set (it knows the INR default is 18%)
    return {
      ...raw,
      isTaxInclusive: false,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      warning: "",
    };
  }
  return {
    ...raw,
    isTaxInclusive: false,
    taxPercent: 0,
    taxAmount: 0,
    taxLabel: "",
    gstPercent: 0,
    gstAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    warning: "",
  };
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
          message: `I couldn't find the invoice to split. Please specify which invoice to split.`,
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
  const currentMonth = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const currentDate = new Date().toISOString().split("T")[0];

  const [memoryContext, structured] = await Promise.all([
    state.userId
      ? fetchClientMemoryContext(state.userId, state.prompt)
      : Promise.resolve("No past invoice history for this client."),
    Promise.resolve(model.withStructuredOutput(invoiceSchema)),
  ]);

  const formatted = fillTemplate(GENERATOR_PROMPT, {
    prompt: state.prompt,
    memoryContext,
    currentMonth,
    currentDate,
  });
  const raw = (await structured.invoke(formatted)) as ParsedInvoice;

  // ── Apply deterministic tax correction ──
  // This overrides any incorrect LLM tax values based on prompt keywords.
  const corrected = applyTaxCorrection(raw, state.prompt);

  console.log(
    "🔍 Tax corrected:",
    JSON.stringify({
      clientName: corrected.clientName,
      currency: corrected.currency,
      isTaxInclusive: corrected.isTaxInclusive,
      lineItems: corrected.lineItems?.map((i) => ({
        amount: i.amount,
        rate: i.rate,
      })),
      taxPercent: corrected.taxPercent,
      gstPercent: corrected.gstPercent,
      subtotal: corrected.subtotal,
      total: corrected.total,
      warning: corrected.warning,
    })
  );

  // For inclusive invoices where we already computed everything, recalculateTotals
  // only needs to handle discounts and GST splits — it won't touch total.
  const finalInvoice = recalculateTotals(corrected);

  // ── Guard: no amount/price info at all ──
  // "Bill Rahul for logo design" has a real client + service but NO price anywhere.
  // GENERATOR_PROMPT defaults missing rates to 0, which would create a useless
  // ₹0 draft. Neither case should produce a draft — just respond conversationally.
  const isExplicitlyFree =
    /\b(free|complimentary|no charge|gratis|pro bono)\b/i.test(state.prompt);
  const hasZeroAmount =
    finalInvoice.subtotal === 0 &&
    finalInvoice.lineItems.every((i) => i.amount === 0 && i.rate === 0);

  if (hasZeroAmount) {
    if (isExplicitlyFree) {
      return {
        agentResult: {
          action: "info",
          message: `Got it — since this is complimentary, there's nothing to invoice for **${finalInvoice.clientName}**. No invoice needed! Let me know if you'd like to bill them for something else.`,
        },
      };
    }
    const serviceDesc =
      finalInvoice.lineItems[0]?.description?.toLowerCase() || "this work";
    return {
      agentResult: {
        action: "info",
        message: `I'd be happy to create that invoice for **${finalInvoice.clientName}**! What's the amount or rate for ${serviceDesc}?\n\nTry: "Bill ${finalInvoice.clientName} ₹15,000 for ${serviceDesc}"`,
      },
    };
  }

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

  const warning = corrected.warning || "";
  const warningLine = warning ? `\n\n⚠️ *${warning}*` : "";

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
    }**. Review it in the side panel.${warningLine}`;
  } else if (matchResult.type === "partial") {
    action = "needs_client";
    message = `I found a saved client named **${matchResult.client?.name}**.\nIs **${finalInvoice.clientName}** the same client? Reply **same** or **different**.${warningLine}`;
  } else {
    action = "needs_client";
    message = `${typeLabel} of **${formatCurrency(
      finalInvoice.total,
      finalInvoice.currency
    )}** is ready for **${
      finalInvoice.clientName
    }**!\n\nPlease share their contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr type **skip** to continue without details.${warningLine}`;
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
