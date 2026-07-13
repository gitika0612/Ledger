import { ChatOpenAI } from "@langchain/openai";
import { InvoiceAgentState } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { EDITOR_PROMPT } from "../prompts/invoicePrompt";
import {
  recalculateTotals,
  diffLineItems,
  formatCurrency,
} from "../utils/invoiceUtils";
import { Invoice } from "../../models/Invoice";
import {
  isIndianCurrency,
  getCurrencyInfo,
  getCurrencySymbol,
  isValidCurrencyCode,
} from "../../lib/currencies";

const FIELD_LABELS: Record<string, string> = {
  clientName: "client name",
  gstPercent: "GST rate",
  gstType: "GST type",
  taxPercent: "VAT/Tax rate",
  taxAmount: "VAT/Tax amount",
  paymentTermsDays: "payment terms",
  invoiceDate: "invoice date",
  invoiceMonth: "invoice month",
  discountType: "discount type",
  discountValue: "discount value",
  notes: "notes",
};

function detectGstChange(
  prompt: string,
  currency: string
): { gstPercent: number; gstType?: "CGST_SGST" | "IGST" } | null {
  if (!isIndianCurrency(currency)) return null;
  const lower = prompt.toLowerCase();
  const removeGst =
    /\b(remove|no|without|zero|0%)\b.*\bgst\b/.test(lower) ||
    /\bgst.*\b(remove|no|without|zero|0%)\b/.test(lower);
  const addGst = /\b(add|apply|put|include|set)\b.*\bgst\b/.test(lower);
  if (removeGst) return { gstPercent: 0 };
  if (!addGst) return null;
  const pctMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*%?\s*gst|gst\s*(?:at|of|@|to)?\s*(\d+(?:\.\d+)?)\s*%?/
  );
  const gstPercent = pctMatch ? parseFloat(pctMatch[1] || pctMatch[2]) : 18;
  const gstType = lower.includes("igst")
    ? ("IGST" as const)
    : ("CGST_SGST" as const);
  return { gstPercent, gstType };
}

function detectTaxChange(
  prompt: string,
  currency: string
): { taxPercent: number; taxLabel: string } | null {
  if (isIndianCurrency(currency)) return null;
  const lower = prompt.toLowerCase();
  const taxLabel = getCurrencyInfo(currency).taxLabel;
  const removeTax =
    /\b(remove|no|without|zero|0%)\b.*\b(vat|tax)\b/.test(lower) ||
    /\b(vat|tax)\b.*\b(remove|no|without|zero|0%)\b/.test(lower);
  if (removeTax) return { taxPercent: 0, taxLabel };
  const changeTax =
    /\b(add|apply|put|include|set|change|update)\b.*\b(vat|tax)\b/.test(
      lower
    ) ||
    /\b(vat|tax)\b.*\b(add|apply|put|include|set|change|update)\b/.test(lower);
  if (!changeTax) return null;
  const pctMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*%?\s*(?:vat|tax)|(?:vat|tax)\s*(?:to|at|of|@)?\s*(\d+(?:\.\d+)?)\s*%?/
  );
  const taxPercent = pctMatch ? parseFloat(pctMatch[1] || pctMatch[2]) : 0;
  return { taxPercent, taxLabel };
}

function extractRemoveTarget(prompt: string): string | null {
  const REMOVE_STOP_WORDS = new Set([
    "it",
    "that",
    "this",
    "them",
    "those",
    "everything",
    "all",
    "them all",
  ]);
  const TRAILING_NOISE =
    /\s+(?:please|now|wala\s*item|wala|yeh|woh|line\s+item|item)\s*$/i;
  const removeRegex =
    /\b(?:remove|delete)\b\s+(.+?)(?:\s+from|\s+in|\s+please|\s+now|\s*$)/i;
  const m = prompt.match(removeRegex);
  if (!m) return null;
  let captured = m[1]
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "");
  captured = captured.replace(TRAILING_NOISE, "").trim();
  if (!captured || captured.length < 2 || REMOVE_STOP_WORDS.has(captured))
    return null;
  return captured;
}

// ── Detect late fee: "add X% late fee" ──
function detectLateFee(prompt: string): number | null {
  const m =
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*late\s*fee/i) ||
    prompt.match(/late\s*fee\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/i) ||
    prompt.match(/add\s+(\d+(?:\.\d+)?)\s*%\s*late/i);
  if (m) return parseFloat(m[1]);
  return null;
}

function buildEditMessage(
  invoice: ParsedInvoice,
  ref: string,
  changeParts: string[],
  warning: string
): string {
  const nameRef =
    ref && ref !== invoice.clientName
      ? `**${invoice.clientName}**'s invoice (${ref})`
      : `**${invoice.clientName}**'s invoice`;
  return [
    `Updated ${nameRef}.`,
    changeParts.filter(Boolean).join(" · "),
    `New total: **${formatCurrency(invoice.total, invoice.currency)}**`,
    `Review the updated invoice in the side panel.`,
    warning ? `⚠️ ${warning}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatLineItemsForPrompt(
  lineItems: ParsedInvoice["lineItems"],
  currency: string
): string {
  const symbol = getCurrencySymbol(currency);
  return lineItems
    .map(
      (item, i) =>
        `${i + 1}. "${item.description}" | Qty: ${item.quantity} ${
          item.unit
        } | Rate: ${symbol}${item.rate.toLocaleString(
          "en-US"
        )} | Amount: ${symbol}${item.amount.toLocaleString("en-US")}`
    )
    .join("\n");
}

function applyNonLineItemChanges(
  existing: ParsedInvoice,
  parsed: ParsedInvoice,
  changedFields: string[]
): ParsedInvoice {
  const updated = { ...existing };
  if (changedFields.includes("clientName"))
    updated.clientName = parsed.clientName;
  if (changedFields.includes("gstPercent"))
    updated.gstPercent = parsed.gstPercent;
  if (changedFields.includes("gstType")) updated.gstType = parsed.gstType;
  if (changedFields.includes("taxPercent"))
    updated.taxPercent = parsed.taxPercent;
  if (changedFields.includes("taxAmount")) updated.taxAmount = parsed.taxAmount;
  if (changedFields.includes("taxLabel")) updated.taxLabel = parsed.taxLabel;
  if (changedFields.includes("paymentTermsDays"))
    updated.paymentTermsDays = parsed.paymentTermsDays;
  if (changedFields.includes("invoiceDate"))
    updated.invoiceDate = parsed.invoiceDate;
  if (changedFields.includes("invoiceMonth"))
    updated.invoiceMonth = parsed.invoiceMonth;
  if (changedFields.includes("discountType"))
    updated.discountType = parsed.discountType;
  if (changedFields.includes("discountValue"))
    updated.discountValue = parsed.discountValue;
  if (changedFields.includes("notes")) updated.notes = parsed.notes;
  return updated;
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

function resolveTargetFromSession(
  sessionContext: string,
  targetRef: string
): ParsedInvoice | null {
  const blocks = parseSessionBlocks(sessionContext);
  if (blocks.length === 0) return null;
  const lower = targetRef.toLowerCase().trim();
  let block: (typeof blocks)[0] | undefined;
  if (lower) {
    block = blocks.find(
      (b) =>
        b.ref.toLowerCase() === lower ||
        b.clientName.toLowerCase() === lower ||
        b.clientName.toLowerCase().includes(lower)
    );
  }
  if (!block) block = blocks[blocks.length - 1];
  if (!block) return null;
  return parseBlockToInvoice(block.raw);
}

function parseBlockToInvoice(block: string): ParsedInvoice | null {
  const lineItemsMatch = [
    ...block.matchAll(
      /-\s*(.+?)\s*\|\s*Qty:\s*([\d.]+)\s*(.+?)\s*\|\s*Rate:\s*[^\d]*?([\d,]+)\s*\|\s*Amount:\s*[^\d]*?([\d,]+)/g
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

  const currencyMatch = block.match(/Currency:\s*([A-Za-z]{3})/i);
  const currency: string =
    currencyMatch && isValidCurrencyCode(currencyMatch[1])
      ? currencyMatch[1].toUpperCase()
      : block.includes("$")
      ? "USD"
      : block.includes("€")
      ? "EUR"
      : block.includes("£")
      ? "GBP"
      : block.includes("¥")
      ? "JPY"
      : "INR";

  // ── isTaxInclusive flag ──
  // Stored in session context as "Tax Inclusive: true" when the invoice
  // was created with an inclusive total (e.g. "€3,500 VAT included").
  // Without this, editorNode would add tax on top instead of back-calculating.
  const isTaxInclusive = /Tax Inclusive:\s*true/i.test(block);

  const gstMatch = block.match(/GST:\s*([\d.]+)%\s*(\w+)/i);
  const taxLineMatch = block.match(/Tax:\s*([\d.]+)%\s*(\w+)/i);
  const totalMatch = block.match(/Total:\s*[^\d]*?([\d,]+)/i);
  const subtotalMatch = block.match(/Subtotal:\s*[^\d]*?([\d,]+)/i);
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

  if (isIndianCurrency(currency)) {
    const gstPercent = parseFloat(gstMatch?.[1] ?? "0");
    const gstType =
      (gstMatch?.[2] ?? "CGST_SGST") === "IGST"
        ? ("IGST" as const)
        : ("CGST_SGST" as const);
    return {
      clientName: clientMatch?.[1]?.trim() ?? "Client",
      currency,
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
      gstAmount,
      cgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
      sgstAmount: gstType === "CGST_SGST" ? Math.round(gstAmount / 2) : 0,
      igstAmount: gstType === "IGST" ? gstAmount : 0,
      taxPercent: 0,
      taxAmount: 0,
      taxLabel: "",
      paymentTermsDays: parseInt(termsMatch?.[1] ?? "15"),
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      taxableAmount,
      notes: "",
      total,
      invoiceDate: new Date().toISOString().split("T")[0],
      invoiceMonth:
        monthMatch?.[1]?.trim() ??
        new Date().toLocaleDateString("en-IN", {
          month: "long",
          year: "numeric",
        }),
      isTaxInclusive,
      changedFields: [],
      warning: "",
    } as unknown as ParsedInvoice;
  } else {
    const taxPercent = taxLineMatch
      ? parseFloat(taxLineMatch[1])
      : gstMatch
      ? parseFloat(gstMatch[1])
      : 0;
    const taxLabel = taxLineMatch?.[2] || getCurrencyInfo(currency).taxLabel;
    const taxAmount =
      gstAmount > 0 ? gstAmount : Math.round((subtotal * taxPercent) / 100);
    return {
      clientName: clientMatch?.[1]?.trim() ?? "Client",
      currency,
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
      discountType,
      discountValue,
      discountAmount,
      taxableAmount,
      notes: "",
      total,
      invoiceDate: new Date().toISOString().split("T")[0],
      invoiceMonth:
        monthMatch?.[1]?.trim() ??
        new Date().toLocaleDateString("en-IN", {
          month: "long",
          year: "numeric",
        }),
      isTaxInclusive,
      changedFields: [],
      warning: "",
    } as unknown as ParsedInvoice;
  }
}

async function fetchInvoiceFromDB(
  userId: string,
  targetRef: string
): Promise<ParsedInvoice | null> {
  try {
    const query: Record<string, unknown> = { userId };
    if (/^INV-/i.test(targetRef)) {
      query.invoiceNumber = { $regex: new RegExp(`^${targetRef}$`, "i") };
    } else if (targetRef) {
      query.clientName = { $regex: new RegExp(`^${targetRef}$`, "i") };
    }
    const inv = await Invoice.findOne(query).sort({ createdAt: -1 }).lean();
    if (!inv) return null;
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
      isTaxInclusive: inv.isTaxInclusive ?? false,
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

export async function editorNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const ref = state.targetRef || "";

  let existing = state.parsedInvoice;

  // ── Resolve from session context first ──
  if (!existing) {
    existing = resolveTargetFromSession(state.sessionContext, ref);
    if (existing)
      console.log(
        "✅ Editor: resolved from sessionContext, client:",
        existing.clientName,
        "currency:",
        existing.currency
      );
  }

  // ── DB fallback ONLY for explicit invoice numbers (INV-XXXX) ──
  // Never fall back to DB by client name — that would edit invoices from other sessions.
  if (!existing && state.userId && ref && /^INV-/i.test(ref)) {
    existing = await fetchInvoiceFromDB(state.userId, ref);
    if (existing)
      console.log(
        "✅ Editor: resolved from DB by invoice number, client:",
        existing.clientName
      );
  }

  if (!existing) {
    const hasSpecificTarget = ref.length > 0;
    const notFoundMsg = hasSpecificTarget
      ? `I couldn't find an invoice for **${ref}** in this session. Check the side panel or try specifying an invoice number (e.g. INV-2026-001).`
      : `I couldn't find the invoice to edit. Please specify an invoice number (e.g. INV-2026-001) or say "last invoice".`;
    return {
      agentResult: {
        action: "not_found",
        message: notFoundMsg,
      },
    };
  }

  const currency = existing.currency ?? "INR";

  // ── Deterministic GST change — INR only ──
  const gstChange = detectGstChange(state.prompt, currency);
  if (gstChange) {
    let updated: ParsedInvoice;
    let label: string;

    if (existing.isTaxInclusive && (gstChange.gstPercent ?? 0) > 0) {
      // ── Tax-inclusive invoice: back-calculate from original total ──
      // The user stated a total that already includes GST.
      // When they now specify the GST rate, we split it correctly
      // instead of adding MORE tax on top.
      const statedTotal = existing.total;
      const rate = gstChange.gstPercent;
      const preTax = Math.round((statedTotal * 100) / (100 + rate));
      const gstAmount = statedTotal - preTax;
      const gstType = gstChange.gstType ?? existing.gstType ?? "CGST_SGST";

      updated = recalculateTotals({
        ...existing,
        isTaxInclusive: true,
        gstPercent: rate,
        gstType,
        lineItems: existing.lineItems.map((item, i) =>
          i === 0 ? { ...item, amount: preTax, rate: preTax } : item
        ),
        subtotal: preTax,
        taxableAmount: preTax,
        total: statedTotal,
      });
      label = `Set GST to ${rate}% (back-calculated from ₹${statedTotal.toLocaleString(
        "en-IN"
      )} — total unchanged)`;
    } else {
      // Standard add-on GST
      updated = recalculateTotals({
        ...existing,
        gstPercent: gstChange.gstPercent,
        gstType: gstChange.gstType ?? existing.gstType,
      });
      label =
        gstChange.gstPercent === 0
          ? "Removed GST (0%)"
          : `Added GST (${gstChange.gstPercent}%)`;
    }

    return {
      parsedInvoice: updated,
      agentResult: {
        action: "edited",
        message: buildEditMessage(updated, ref, [label], ""),
        invoice: updated,
        targetRef: ref,
        changedFields: ["gstPercent", "gstType"],
      },
    };
  }

  // ── Deterministic VAT/Tax change — USD/EUR only ──
  const taxChange = detectTaxChange(state.prompt, currency);
  if (taxChange) {
    let updated: ParsedInvoice;
    let label: string;

    if (existing.isTaxInclusive && taxChange.taxPercent > 0) {
      // ── Tax-inclusive invoice: back-calculate from original total ──
      // "Invoice Emma €3,500 VAT included" → total=€3,500 already includes VAT.
      // "Add 10% VAT" → back-calculate: preTax=€3,182, VAT=€318, total stays €3,500.
      const statedTotal = existing.total;
      const rate = taxChange.taxPercent;
      const preTax = Math.round((statedTotal * 100) / (100 + rate));
      const taxAmount = statedTotal - preTax;

      updated = recalculateTotals({
        ...existing,
        isTaxInclusive: true,
        taxPercent: rate,
        taxAmount,
        taxLabel: taxChange.taxLabel,
        lineItems: existing.lineItems.map((item, i) =>
          i === 0 ? { ...item, amount: preTax, rate: preTax } : item
        ),
        subtotal: preTax,
        taxableAmount: preTax,
        total: statedTotal, // total stays exactly as originally stated
      });
      label = `Set ${
        taxChange.taxLabel
      } to ${rate}% (back-calculated from ${getCurrencySymbol(
        currency
      )}${statedTotal.toLocaleString("en-US")} — total unchanged)`;
    } else {
      // Standard add-on tax
      updated = recalculateTotals({
        ...existing,
        taxPercent: taxChange.taxPercent,
        taxLabel: taxChange.taxLabel,
      });
      label =
        taxChange.taxPercent === 0
          ? `Removed ${taxChange.taxLabel} (0%)`
          : `Updated ${taxChange.taxLabel} to ${taxChange.taxPercent}%`;
    }

    return {
      parsedInvoice: updated,
      agentResult: {
        action: "edited",
        message: buildEditMessage(updated, ref, [label], ""),
        invoice: updated,
        targetRef: ref,
        changedFields: ["taxPercent", "taxAmount"],
      },
    };
  }

  // ── Deterministic DISCOUNT ──
  const discountPctMatch =
    state.prompt.match(/([0-9]+(?:[.][0-9]+)?)\s*%\s*(?:off|discount)/i) ||
    state.prompt.match(/discount\s+(?:of\s+)?([0-9]+(?:[.][0-9]+)?)\s*%/i) ||
    state.prompt.match(
      /([0-9]+(?:[.][0-9]+)?)\s+percent\s+(?:off|discount)/i
    ) ||
    state.prompt.match(
      /(?:apply|give|add|set)\s+([0-9]+(?:[.][0-9]+)?)\s*%?\s*(?:percent\s+)?(?:off|discount)/i
    );

  if (discountPctMatch) {
    const discountValue = parseFloat(discountPctMatch[1]);
    if (!isNaN(discountValue) && discountValue > 0) {
      const updated = recalculateTotals({
        ...existing,
        discountType: "percent" as const,
        discountValue,
      });
      return {
        parsedInvoice: updated,
        agentResult: {
          action: "edited",
          message: buildEditMessage(
            updated,
            ref,
            [`Applied ${discountValue}% discount`],
            ""
          ),
          invoice: updated,
          targetRef: ref,
          changedFields: ["discountType", "discountValue"],
        },
      };
    }
  }

  // ── Deterministic LATE FEE ──
  const lateFeeRate = detectLateFee(state.prompt);
  if (lateFeeRate !== null && lateFeeRate > 0) {
    const feeAmount = Math.round((existing.subtotal * lateFeeRate) / 100);
    const lateFeeItem = {
      description: `Late Fee (${lateFeeRate}%)`,
      quantity: 1,
      unit: "item",
      rate: feeAmount,
      amount: feeAmount,
      hsnSacCode: "",
      hsnSacType: "SAC" as const,
    };
    const updated = recalculateTotals({
      ...existing,
      lineItems: [...existing.lineItems, lateFeeItem],
    });
    return {
      parsedInvoice: updated,
      agentResult: {
        action: "edited",
        message: buildEditMessage(
          updated,
          ref,
          [`Added **Late Fee (${lateFeeRate}%)**`],
          ""
        ),
        invoice: updated,
        targetRef: ref,
        changedFields: ["lineItems"],
      },
    };
  }

  // ── Deterministic REMOVE ──
  const removeTarget = extractRemoveTarget(state.prompt);
  if (removeTarget) {
    const remaining = existing.lineItems.filter(
      (item) => !item.description.toLowerCase().includes(removeTarget)
    );
    if (remaining.length < existing.lineItems.length) {
      const updated = recalculateTotals({ ...existing, lineItems: remaining });
      const removedItems = existing.lineItems
        .filter((item) => item.description.toLowerCase().includes(removeTarget))
        .map((i) => `**${i.description}**`);
      return {
        parsedInvoice: updated,
        agentResult: {
          action: "edited",
          message: buildEditMessage(
            updated,
            ref,
            [`Removed ${removedItems.join(", ")}`],
            ""
          ),
          invoice: updated,
          targetRef: ref,
          changedFields: ["lineItems"],
        },
      };
    }
  }

  // ── LLM path ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
  const structured = model.withStructuredOutput(invoiceSchema);

  const taxInfo = isIndianCurrency(currency)
    ? `GST ${existing.gstPercent}% ${existing.gstType}`
    : `${existing.taxLabel || getCurrencyInfo(currency).taxLabel} ${
        existing.taxPercent ?? 0
      }%`;

  const formatted = EDITOR_PROMPT.replace("{prompt}", state.prompt)
    .replace("{clientName}", existing.clientName)
    .replace("{currency}", currency)
    .replace("{invoiceMonth}", existing.invoiceMonth ?? "")
    .replace("{taxInfo}", taxInfo)
    .replace("{discountType}", existing.discountType)
    .replace("{discountValue}", String(existing.discountValue))
    .replace("{paymentTermsDays}", String(existing.paymentTermsDays))
    .replace("{notes}", existing.notes || "")
    .replace("{subtotal}", formatCurrency(existing.subtotal, currency))
    .replace("{total}", formatCurrency(existing.total, currency))
    .replace(
      "{lineItems}",
      formatLineItemsForPrompt(existing.lineItems, currency)
    );

  const parsedEdit = (await structured.invoke(formatted)) as ParsedInvoice;
  const changedFields: string[] = parsedEdit.changedFields ?? [];
  const warning: string = parsedEdit.warning ?? "";

  if (changedFields.length === 0) {
    return {
      agentResult: {
        action: "edited",
        message: `⚠️ Couldn't apply that change to **${
          existing.clientName
        }**'s invoice.\n\nCurrent items: ${existing.lineItems
          .map((i) => `**${i.description}**`)
          .join(
            ", "
          )}\n\nTry: "Add 18% GST", "Remove the hosting item", "Change payment terms to 30 days".`,
        targetRef: ref,
        changedFields: [],
        warning,
      },
      parsedInvoice: existing,
    };
  }

  if (changedFields.includes("lineItems")) {
    const promptLower = state.prompt.toLowerCase();
    const isDiscountPrompt =
      /\b(add|apply|set|give)\b.*\bdiscount\b/.test(promptLower) ||
      /\bdiscount\b.*\b(add|apply|set)\b/.test(promptLower);

    if (isDiscountPrompt && !changedFields.includes("discountType")) {
      if (parsedEdit.discountType && parsedEdit.discountType !== "none") {
        const withDiscount = applyNonLineItemChanges(existing, parsedEdit, [
          "discountType",
          "discountValue",
        ]);
        const updated = recalculateTotals(withDiscount);
        return {
          parsedInvoice: updated,
          agentResult: {
            action: "edited",
            message: buildEditMessage(
              updated,
              ref,
              [`Applied ${parsedEdit.discountValue}% discount`],
              ""
            ),
            invoice: updated,
            targetRef: ref,
            changedFields: ["discountType", "discountValue"],
          },
        };
      }
    }

    const isAdd =
      /\badd\b/.test(promptLower) &&
      !/\bremove\b|\breplace\b|\bdelete\b|\bswap\b|\bdiscount\b/.test(
        promptLower
      );

    if (isAdd) {
      const existingKeys = new Set(
        existing.lineItems.map((i) => i.description.toLowerCase().trim())
      );
      const newItems = parsedEdit.lineItems
        .filter((i) => !existingKeys.has(i.description.toLowerCase().trim()))
        .map((item) => ({ ...item, amount: item.quantity * item.rate }));

      if (newItems.length === 0) {
        return {
          agentResult: {
            action: "edited",
            message: `⚠️ Couldn't identify what to add to **${existing.clientName}**'s invoice. Please be more specific (e.g. "Add brand strategy ₹10,000").`,
            targetRef: ref,
            changedFields: [],
          },
          parsedInvoice: existing,
        };
      }

      const updated = recalculateTotals({
        ...existing,
        lineItems: [...existing.lineItems, ...newItems],
      });
      return {
        parsedInvoice: updated,
        agentResult: {
          action: "edited",
          message: buildEditMessage(
            updated,
            ref,
            [`Added ${newItems.map((i) => `**${i.description}**`).join(", ")}`],
            ""
          ),
          invoice: updated,
          targetRef: ref,
          changedFields,
        },
      };
    }

    const candidateItems = parsedEdit.lineItems.map((item) => ({
      ...item,
      amount: item.quantity * item.rate,
    }));
    const diff = diffLineItems(existing.lineItems, candidateItems, currency);

    if (!diff.hasRealChange) {
      return {
        agentResult: {
          action: "edited",
          message: `⚠️ Couldn't find that item in **${
            existing.clientName
          }**'s invoice — nothing was changed.\n\nCurrent items: ${existing.lineItems
            .map((i) => `**${i.description}**`)
            .join(", ")}`,
          targetRef: ref,
          changedFields: [],
          warning: "Item not found",
        },
        parsedInvoice: existing,
      };
    }

    const base = applyNonLineItemChanges(existing, parsedEdit, changedFields);
    const updated = recalculateTotals({ ...base, lineItems: candidateItems });
    const otherChanges = changedFields
      .filter((f) => f !== "lineItems")
      .map((f) => FIELD_LABELS[f] || f);
    return {
      parsedInvoice: updated,
      agentResult: {
        action: "edited",
        message: buildEditMessage(
          updated,
          ref,
          [
            diff.summary,
            otherChanges.length > 0 ? `Updated ${otherChanges.join(", ")}` : "",
          ],
          warning
        ),
        invoice: updated,
        targetRef: ref,
        changedFields,
        warning,
      },
    };
  }

  const updated = recalculateTotals(
    applyNonLineItemChanges(existing, parsedEdit, changedFields)
  );
  const labels = changedFields.map((f) => FIELD_LABELS[f] || f);
  return {
    parsedInvoice: updated,
    agentResult: {
      action: "edited",
      message: buildEditMessage(
        updated,
        ref,
        [`Updated ${labels.join(", ")}`],
        warning
      ),
      invoice: updated,
      targetRef: ref,
      changedFields,
    },
  };
}
