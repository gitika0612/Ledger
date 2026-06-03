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

// ── Only fires for INR invoices ──
function detectGstChange(
  prompt: string,
  currency: string
): { gstPercent: number; gstType?: "CGST_SGST" | "IGST" } | null {
  // Never apply GST logic to EUR/USD invoices
  if (currency !== "INR") return null;

  const lower = prompt.toLowerCase();
  const removeGst =
    /\b(remove|no|without|zero|0%)\b.*\bgst\b/.test(lower) ||
    /\bgst.*\b(remove|no|without|zero|0%)\b/.test(lower);
  const addGst = /\b(add|apply|put|include|set)\b.*\bgst\b/.test(lower);

  if (removeGst) return { gstPercent: 0 };
  if (!addGst) return null;

  const pctMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*%?\s*gst|gst\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)\s*%?/
  );
  const gstPercent = pctMatch ? parseFloat(pctMatch[1] || pctMatch[2]) : 18;
  const gstType = lower.includes("igst")
    ? ("IGST" as const)
    : ("CGST_SGST" as const);
  return { gstPercent, gstType };
}

// ── Detect VAT/Tax change for USD/EUR invoices ──
function detectTaxChange(
  prompt: string,
  currency: string
): { taxPercent: number; taxLabel: string } | null {
  if (currency === "INR") return null;

  const lower = prompt.toLowerCase();
  const taxLabel = currency === "EUR" ? "VAT" : "Tax";

  // Remove VAT/Tax
  const removeTax =
    /\b(remove|no|without|zero|0%)\b.*\b(vat|tax)\b/.test(lower) ||
    /\b(vat|tax)\b.*\b(remove|no|without|zero|0%)\b/.test(lower);
  if (removeTax) return { taxPercent: 0, taxLabel };

  // Change VAT/Tax to X%
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
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
  return lineItems
    .map(
      (item, i) =>
        `${i + 1}. "${item.description}" | Qty: ${item.quantity} ${
          item.unit
        } | Rate: ${symbol}${item.rate.toLocaleString(
          "en-IN"
        )} | Amount: ${symbol}${item.amount.toLocaleString("en-IN")}`
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

  //  detect currency from sessionContext block ──
  const currencyMatch = block.match(/Currency:\s*(INR|USD|EUR)/i);
  const currency: "INR" | "USD" | "EUR" = currencyMatch
    ? (currencyMatch[1].toUpperCase() as "INR" | "USD" | "EUR")
    : block.includes("$")
    ? "USD"
    : block.includes("€")
    ? "EUR"
    : "INR";

  const gstMatch = block.match(/GST:\s*([\d.]+)%\s*(\w+)/i);
  const taxLineMatch = block.match(/Tax:\s*([\d.]+)%\s*(\w+)/i); // written by buildSessionContext for USD/EUR
  const totalMatch = block.match(/Total:\s*[₹$€]?([\d,]+)/i);
  const subtotalMatch = block.match(/Subtotal:\s*[₹$€]?([\d,]+)/i);
  const termsMatch = block.match(/Payment Terms:\s*(\d+)/i);
  const clientMatch = block.match(/Client:\s*(.+)/i);
  const monthMatch = block.match(/Invoice Month:\s*(.+)/i);

  if (!totalMatch) return null;

  const subtotal = parseInt((subtotalMatch?.[1] ?? "0").replace(/,/g, ""));
  const total = parseInt((totalMatch[1] ?? "0").replace(/,/g, ""));
  const gstAmount = total - subtotal;

  if (currency === "INR") {
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
    // USD or EUR — tax fields, not GST
    // Read Tax: line first (written by buildSessionContext for USD/EUR), fall back to gstMatch or difference
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

  if (!existing && state.userId && ref) {
    existing = await fetchInvoiceFromDB(state.userId, ref);
    if (existing)
      console.log(
        "✅ Editor: resolved from DB, client:",
        existing.clientName,
        "currency:",
        existing.currency
      );
  }

  if (!existing) {
    return {
      agentResult: {
        action: "not_found",
        message: `I couldn't find the invoice to edit. Please specify an invoice number (e.g. INV-2026-001) or say "last invoice".`,
      },
    };
  }

  const currency = existing.currency ?? "INR";

  // ── Deterministic GST change — INR only ──
  const gstChange = detectGstChange(state.prompt, currency);
  if (gstChange) {
    const updated = recalculateTotals({
      ...existing,
      gstPercent: gstChange.gstPercent,
      gstType: gstChange.gstType ?? existing.gstType,
    });
    const label =
      gstChange.gstPercent === 0
        ? "Removed GST (0%)"
        : `Added GST (${gstChange.gstPercent}%)`;
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
    const updated = recalculateTotals({
      ...existing,
      taxPercent: taxChange.taxPercent,
      taxLabel: taxChange.taxLabel,
    });
    const label =
      taxChange.taxPercent === 0
        ? `Removed ${taxChange.taxLabel} (0%)`
        : `Updated ${taxChange.taxLabel} to ${taxChange.taxPercent}%`;
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

  // ── Deterministic DISCOUNT — fires before LLM ──
  const discountPctMatch =
    state.prompt.match(/([0-9]+(?:[.][0-9]+)?)\s*%?\s*(?:off|discount)/i) ||
    state.prompt.match(/discount\s+(?:of\s+)?([0-9]+(?:[.][0-9]+)?)\s*%/i);
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

  // ── Deterministic REMOVE ──
  const removeMatch = state.prompt.match(
    /\b(?:remove|delete)\b\s+(.+?)(?:\s+from|\s+in|\s*$)/i
  );
  if (removeMatch) {
    const target = removeMatch[1]
      .toLowerCase()
      .trim()
      .replace(/^the\s+/, "");
    const remaining = existing.lineItems.filter(
      (item) => !item.description.toLowerCase().includes(target)
    );

    if (remaining.length < existing.lineItems.length) {
      const updated = recalculateTotals({ ...existing, lineItems: remaining });
      const removedItems = existing.lineItems
        .filter((item) => item.description.toLowerCase().includes(target))
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

  const taxInfo =
    currency === "INR"
      ? `GST ${existing.gstPercent}% ${existing.gstType}`
      : `${existing.taxLabel || (currency === "EUR" ? "VAT" : "Tax")} ${
          existing.taxPercent ?? 0
        }%`;

  // Use plain string replacement — PromptTemplate crashes on {curly} in line item descriptions
  const formatted = EDITOR_PROMPT.replace("{prompt}", state.prompt)
    .replace("{clientName}", existing.clientName)
    .replace("{currency}", currency)
    .replace("{invoiceMonth}", existing.invoiceMonth ?? "")
    .replace("{taxInfo}", taxInfo)
    .replace("{discountType}", existing.discountType)
    .replace("{discountValue}", String(existing.discountValue))
    .replace("{paymentTermsDays}", String(existing.paymentTermsDays))
    .replace("{notes}", existing.notes || "")
    .replace("{subtotal}", existing.subtotal.toLocaleString("en-IN"))
    .replace("{total}", existing.total.toLocaleString("en-IN"))
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

    // ── Detect discount before treating as line item add ──
    // "Add 5% discount" / "Apply 10% discount" should go through applyNonLineItemChanges
    const isDiscountPrompt =
      /\b(add|apply|set|give)\b.*\bdiscount\b/.test(promptLower) ||
      /\bdiscount\b.*\b(add|apply|set)\b/.test(promptLower);
    if (
      isDiscountPrompt &&
      changedFields.includes("lineItems") &&
      !changedFields.includes("discountType")
    ) {
      // The LLM put it in lineItems but it should be a discount — re-check changedFields
      // If parsedEdit has discountType set, apply it
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
    const diff = diffLineItems(existing.lineItems, candidateItems);

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
