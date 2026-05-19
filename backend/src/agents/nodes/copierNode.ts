import { InvoiceAgentState, AgentResult } from "../state";
import { ParsedInvoice } from "../schemas/invoiceSchema";
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

  if (matching.length > 0) return matching[matching.length - 1];

  // Fallback: last block = most recent invoice
  if (!lower || lower === "last" || lower === "last one") {
    const allBlocks = parseSessionBlocks(sessionContext);
    return allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].raw : null;
  }
  return null;
}

// Parse a session context block into a ParsedInvoice
// Works because buildSessionContext now includes line items
function parseBlockToInvoice(block: string): ParsedInvoice | null {
  const lineItemsMatch = [
    ...block.matchAll(
      /-\s*(.+?)\s*\|\s*Qty:\s*([\d.]+)\s*(.+?)\s*\|\s*Rate:\s*₹([\d,]+)\s*\|\s*Amount:\s*₹([\d,]+)/g
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
  const totalMatch = block.match(/Total:\s*₹?([\d,]+)/i);
  const subtotalMatch = block.match(/Subtotal:\s*₹?([\d,]+)/i);
  const termsMatch = block.match(/Payment Terms:\s*(\d+)/i);
  const clientMatch = block.match(/Client:\s*(.+)/i);
  const monthMatch = block.match(/Invoice Month:\s*(.+)/i);

  if (!totalMatch) return null;

  const subtotal = parseInt((subtotalMatch?.[1] ?? "0").replace(/,/g, ""));
  const total = parseInt((totalMatch[1] ?? "0").replace(/,/g, ""));
  const gstPercent = parseFloat(gstMatch?.[1] ?? "18");
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
      gstPercent: last.gstPercent,
      gstType: last.gstType as "IGST" | "CGST_SGST",
      paymentTermsDays: last.paymentTermsDays,
      subtotal: last.subtotal,
      taxableAmount: last.taxableAmount ?? last.subtotal,
      gstAmount: last.gstAmount,
      cgstAmount: last.cgstAmount ?? 0,
      sgstAmount: last.sgstAmount ?? 0,
      igstAmount: last.igstAmount ?? 0,
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

export async function copierNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  console.log("=== COPIER NODE ===");
  console.log("targetRef:", state.targetRef);
  console.log("parsedInvoice clientName:", state.parsedInvoice?.clientName);
  console.log(
    "parsedInvoice lineItems:",
    JSON.stringify(
      state.parsedInvoice?.lineItems?.map((i) => ({
        description: i.description,
        qty: i.quantity,
        rate: i.rate,
      }))
    )
  );

  const ref = state.targetRef || "";
  const hasSession =
    state.sessionContext &&
    state.sessionContext !== "No existing invoices in this session.";

  // ── Multiple matches → ask which one ──
  // Skip ambiguity check for "last" references
  if (ref && hasSession && ref !== "last" && ref !== "last one") {
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

  // ── Find source invoice ──
  // Priority 1: full invoice passed from frontend — most reliable (has all line items)
  // Priority 2: parse from enriched session context block (buildSessionContext includes line items)
  // Priority 3: cross-session → fetch last confirmed from DB
  // Priority 4: nothing found

  const promptLower = state.prompt.toLowerCase();
  const isCrossSession =
    !hasSession &&
    (promptLower.includes("same as last") ||
      promptLower.includes("last one") ||
      promptLower.includes("like last time") ||
      promptLower.includes("previous invoice"));

  let sourceInv: ParsedInvoice | null = null;

  if (state.parsedInvoice && state.parsedInvoice.clientName) {
    // Priority 1: full invoice from frontend
    sourceInv = state.parsedInvoice;
    console.log("✅ Priority 1: parsedInvoice from frontend");
  } else if (hasSession) {
    // Priority 2: parse from session context block
    const block = findSourceBlock(state.sessionContext, ref || "last");
    if (block) {
      sourceInv = parseBlockToInvoice(block);
      if (sourceInv) {
        console.log(
          "✅ Priority 2: parsed from session context block, client:",
          sourceInv.clientName
        );
      }
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
    // Priority 3: last confirmed invoice from DB
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

  // ── Extract new client name from prompt ──
  const namedMatch =
    state.prompt.match(/named\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
    state.prompt.match(/but\s+for\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
    state.prompt.match(/for\s+([A-Z][a-zA-Z]{1,}?)(?:\s+with|\s*$|,)/)?.[1] ||
    state.prompt.match(
      /for\s+a\s+(?:new\s+)?client\s+(?:named\s+)?([A-Z][a-zA-Z]+)/i
    )?.[1] ||
    "";
  const newClientName = namedMatch.trim() || "Client";

  // ── Apply overrides deterministically from prompt ──
  let gstPercent = sourceInv.gstPercent;
  let gstType = sourceInv.gstType ?? "CGST_SGST";
  let paymentTermsDays = sourceInv.paymentTermsDays;

  const pl = state.prompt.toLowerCase();

  if (/no gst|without gst|0% gst|gst exempt/.test(pl)) gstPercent = 0;

  const gstPctOverride = pl.match(/with\s+(\d+(?:\.\d+)?)\s*%\s*gst/);
  if (gstPctOverride) gstPercent = parseFloat(gstPctOverride[1]);

  if (/with igst/.test(pl)) gstType = "IGST";
  if (/with cgst|with cgst.sgst/.test(pl)) gstType = "CGST_SGST";

  const termOverride = pl.match(/(\d+)\s*day(?:s)?\s+(?:payment\s+)?terms?/);
  const netOverride = pl.match(/net\s+(\d+)/);
  if (termOverride) paymentTermsDays = parseInt(termOverride[1]);
  else if (netOverride) paymentTermsDays = parseInt(netOverride[1]);

  // ── Build copied invoice deterministically — no LLM ──
  const now = new Date();
  const parsedInvoice = recalculateTotals({
    ...sourceInv,
    clientName: newClientName,
    invoiceDate: now.toISOString().split("T")[0],
    invoiceMonth: now.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    }),
    lineItems: sourceInv.lineItems,
    gstPercent,
    gstType,
    paymentTermsDays,
    discountType: sourceInv.discountType ?? "none",
    discountValue: sourceInv.discountValue ?? 0,
    notes: sourceInv.notes ?? "",
    changedFields: [],
    warning: "",
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
