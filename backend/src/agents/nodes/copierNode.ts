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
    if (lower && (invRef === lower || cn === lower || cn.includes(lower))) {
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
  const discountLineMatch = block.match(
    /Discount:\s*(percent|amount)\s+([\d.]+)/i
  );
  const discountType = discountLineMatch
    ? (discountLineMatch[1].toLowerCase() as "percent" | "amount")
    : ("none" as const);
  const discountValue = discountLineMatch
    ? parseFloat(discountLineMatch[2])
    : 0;

  if (!totalMatch) return null;

  const subtotal = parseInt((subtotalMatch?.[1] ?? "0").replace(/,/g, ""));
  const total = parseInt((totalMatch[1] ?? "0").replace(/,/g, ""));
  const discountAmount =
    discountType === "percent"
      ? Math.round((subtotal * discountValue) / 100)
      : discountType === "amount"
      ? discountValue
      : 0;
  const taxableAmount = subtotal - discountAmount;
  const gstAmount = total - taxableAmount;

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
      taxableAmount,
      discountType,
      discountValue,
      discountAmount,
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
      taxableAmount,
      discountType,
      discountValue,
      discountAmount,
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

// ── Fetch most recent invoice for a specific client from DB ──
async function fetchClientInvoiceFromDB(
  userId: string,
  clientName: string
): Promise<ParsedInvoice | null> {
  try {
    const inv = await Invoice.findOne({
      userId,
      clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
    })
      .sort({ createdAt: -1 })
      .lean();
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

function parseAmountOverride(
  prompt: string,
  currency: "INR" | "USD" | "EUR"
): number | null {
  let match: RegExpMatchArray | null = null;
  if (currency === "USD") {
    match = prompt.match(
      /\$\s*([\d,]+(?:\.\d+)?(?:k|thousand)?)|USD\s*([\d,]+(?:\.\d+)?(?:k|thousand)?)/i
    );
  } else if (currency === "EUR") {
    match = prompt.match(
      /€\s*([\d,]+(?:\.\d+)?(?:k|thousand)?)|EUR\s*([\d,]+(?:\.\d+)?(?:k|thousand)?)/i
    );
  } else {
    match = prompt.match(
      /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?(?:k|L|lakh|thousand)?)/i
    );
  }
  if (!match) return null;
  const raw = (match[1] || match[2] || "").replace(/,/g, "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const num = parseFloat(lower);
  if (isNaN(num)) return null;
  if (lower.endsWith("lakh") || lower.endsWith("l")) return num * 100000;
  if (lower.endsWith("thousand") || lower.endsWith("k")) return num * 1000;
  return num;
}

const ALL_MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]);

function extractDestinationClient(prompt: string): string | null {
  // Strip leading punctuation typos (e.g. ":Same invoice" → "Same invoice")
  prompt = prompt.replace(/^[^a-zA-Z0-9₹$€]+/, "").trim();

  const STOP_WORDS = new Set([
    "invoice",
    "bill",
    "same",
    "last",
    "previous",
    "month",
    "this",
    "that",
    "the",
    "a",
    "an",
    "with",
    "and",
    "or",
    "but",
    "for",
    "to",
    "from",
    "in",
    "on",
    "at",
    "of",
    "copy",
    "create",
    "make",
    "generate",
    "next",
    "again",
    "work",
    "time",
    "before",
    "new",
    "client",
    "named",
    ...Array.from(ALL_MONTHS),
  ]);

  const specificPatterns: RegExp[] = [
    /copy\s+(?:last\s+)?(?:\w+'s\s+)?invoice\s+for\s+([A-Za-z]+)/i,
    /(?:same|copy)\s+invoice\s+for\s+([A-Za-z]+)\b/i,
    /but\s+for\s+(?:(?:a\s+)?new\s+)?(?:client\s+)?(?:named\s+)?([A-Za-z]+)\s*$/i,
    /but\s+for\s+(?:(?:a\s+)?new\s+)?(?:client\s+)?(?:named\s+)?([A-Za-z]+)/i,
    /for\s+(?:a\s+)?new\s+client\s+(?:named\s+)?([A-Za-z]+)/i,
    /client\s+(?:named\s+)?([A-Za-z]+)\s*$/i,
    /named\s+([A-Za-z]+)\s*$/i,
    /for\s+([A-Za-z]+)\s*$/i,
  ];

  for (const pattern of specificPatterns) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !STOP_WORDS.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

const HAS_NEW_CLIENT_SIGNAL = /\bnew\s+client\b/i;

export async function copierNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  console.log("=== COPIER NODE ===");
  console.log("targetRef:", state.targetRef);
  console.log("prompt:", state.prompt);

  const ref = state.targetRef || "";
  const isInvoiceRef = /^INV-\d{4}-\d+$/i.test(ref);
  const hasSession =
    state.sessionContext &&
    state.sessionContext !== "No existing invoices in this session.";

  // ── Multiple matches → ask which one ──
  if (
    !isInvoiceRef &&
    ref &&
    hasSession &&
    ref !== "last" &&
    ref !== "last one"
  ) {
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

  const promptLower = state.prompt.toLowerCase();
  const isAgainPrompt = /^(invoice|bill)\s+\w+\s+again\b/i.test(
    state.prompt.trim()
  );
  const isCrossSession =
    !hasSession &&
    (promptLower.includes("same as last") ||
      promptLower.includes("last one") ||
      promptLower.includes("like last time") ||
      promptLower.includes("previous invoice") ||
      promptLower.includes("last month") ||
      promptLower.includes("pichle mahine") ||
      promptLower.includes("same work") ||
      isAgainPrompt);

  let sourceInv: ParsedInvoice | null = null;

  if (state.parsedInvoice && state.parsedInvoice.clientName) {
    sourceInv = state.parsedInvoice;
    console.log("✅ Priority 1: using parsedInvoice from state");
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
          sourceInv.currency
        );
    }

    // ── DB fallback by client name ──
    // Fires when: ref is a specific client name AND not found in session.
    // Covers "Invoice Priya again" in a new session when Priya has past invoices.
    if (
      !sourceInv &&
      ref &&
      ref !== "last" &&
      ref !== "last one" &&
      !isInvoiceRef &&
      state.userId
    ) {
      sourceInv = await fetchClientInvoiceFromDB(state.userId, ref);
      if (sourceInv)
        console.log(
          "✅ Priority 2b: found client invoice from DB, client:",
          sourceInv.clientName
        );
    }

    if (!sourceInv) {
      return {
        agentResult: {
          action: "not_found",
          message:
            ref && ref !== "last"
              ? `I couldn't find any invoice for **${ref}** in this session or your history. Please create one first.`
              : `There are no invoices in this session to copy. Please create an invoice first.`,
        },
      };
    }
  } else if (isCrossSession) {
    // For "Invoice Priya again" with no session — look up Priya specifically
    if (isAgainPrompt && ref && ref !== "last" && state.userId) {
      sourceInv = await fetchClientInvoiceFromDB(state.userId, ref);
      if (sourceInv)
        console.log("✅ Priority 3a: last invoice for", ref, "from DB");
    }
    if (!sourceInv) {
      sourceInv = await fetchLastConfirmedInvoice(state.userId);
      if (sourceInv) console.log("✅ Priority 3b: last confirmed from DB");
    }
    if (!sourceInv) {
      return {
        agentResult: {
          action: "not_found",
          message:
            ref && ref !== "last"
              ? `I couldn't find any previous invoice for **${ref}**. Please create and confirm one first.`
              : `I couldn't find any previous invoices to copy. Please create and confirm an invoice first.`,
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

  // ── Extract destination client name ──
  // If the frontend already resolved a distinguishing name (collision
  // retry flow), use it directly — skip extractDestinationClient entirely.
  // That regex only captures bare letters, so it would truncate something
  // like "Priya - Marketing" down to just "Priya", re-triggering the exact
  // collision this name was meant to resolve.
  const resolvedDestinationName = state.pendingState?.resolvedDestinationName;
  const extractedDestination = resolvedDestinationName
    ? null
    : extractDestinationClient(state.prompt);
  const newClientName =
    resolvedDestinationName ?? extractedDestination ?? sourceInv.clientName;
  console.log("✅ Destination client:", newClientName);

  const isNameCollision =
    !resolvedDestinationName &&
    HAS_NEW_CLIENT_SIGNAL.test(state.prompt) &&
    newClientName.toLowerCase().trim() ===
      sourceInv.clientName.toLowerCase().trim();

  if (isNameCollision) {
    return {
      agentResult: {
        action: "ambiguous",
        message: `You said **"new client"** but the name I'm seeing — **${newClientName}** — is the same as the invoice you're copying from. Since two clients can't share the exact same name, please add something to tell them apart — e.g. **"${newClientName} - Marketing"** or include their company name.`,
        targetRef: ref,
        collisionType: "name_collision",
        sourceClientName: sourceInv.clientName,
      },
    };
  }

  // ── Detect currency override in prompt ──
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

  const amountOverride = parseAmountOverride(state.prompt, currency);

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

  let lineItems = sourceInv.lineItems;
  if (amountOverride !== null) {
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
    lineItems = sourceInv.lineItems.map((item) => ({
      ...item,
      rate: 0,
      amount: 0,
    }));
  }

  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const MONTH_ABBREV_MAP: Record<string, string> = {
    jan: "January",
    january: "January",
    feb: "February",
    february: "February",
    mar: "March",
    march: "March",
    apr: "April",
    april: "April",
    may: "May",
    jun: "June",
    june: "June",
    jul: "July",
    july: "July",
    aug: "August",
    august: "August",
    sep: "September",
    sept: "September",
    september: "September",
    oct: "October",
    october: "October",
    nov: "November",
    november: "November",
    dec: "December",
    december: "December",
  };

  const monthOverrideMatch = state.prompt.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );
  const now = new Date();
  let invoiceMonth = now.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  let invoiceDate = now.toISOString().split("T")[0];

  if (monthOverrideMatch) {
    const monthName = MONTH_ABBREV_MAP[monthOverrideMatch[1].toLowerCase()];
    if (monthName) {
      const monthIdx = MONTH_NAMES.indexOf(monthName);
      const year = now.getFullYear();
      invoiceMonth = `${monthName} ${year}`;
      invoiceDate = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
    }
  }

  const parsedInvoice = recalculateTotals({
    ...sourceInv,
    clientName: newClientName,
    currency,
    invoiceDate,
    invoiceMonth,
    lineItems,
    gstPercent,
    gstType,
    taxPercent,
    taxLabel,
    paymentTermsDays,
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

  const matchResult = resolvedDestinationName
    ? { type: "none" as const, client: null, score: 0 }
    : state.userId
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
