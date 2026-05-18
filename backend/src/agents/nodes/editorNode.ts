import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { InvoiceAgentState } from "../state";
import { ParsedInvoice, invoiceSchema } from "../schemas/invoiceSchema";
import { EDITOR_PROMPT } from "../prompts/invoicePrompt";
import {
  recalculateTotals,
  diffLineItems,
  formatINR,
} from "../utils/invoiceUtils";

const FIELD_LABELS: Record<string, string> = {
  clientName: "client name",
  gstPercent: "GST rate",
  gstType: "GST type",
  paymentTermsDays: "payment terms",
  invoiceDate: "invoice date",
  invoiceMonth: "invoice month",
  discountType: "discount type",
  discountValue: "discount value",
  notes: "notes",
};

function detectGstChange(
  prompt: string
): { gstPercent: number; gstType?: "CGST_SGST" | "IGST" } | null {
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
    `New total: **${formatINR(invoice.total)}**`,
    `Review the updated invoice in the side panel.`,
    warning ? `⚠️ ${warning}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatLineItemsForPrompt(
  lineItems: ParsedInvoice["lineItems"]
): string {
  return lineItems
    .map(
      (item, i) =>
        `${i + 1}. "${item.description}" | Qty: ${item.quantity} ${
          item.unit
        } | Rate: ₹${item.rate.toLocaleString(
          "en-IN"
        )} | Amount: ₹${item.amount.toLocaleString("en-IN")}`
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

export async function editorNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const ref = state.targetRef || "";
  const existing = state.parsedInvoice;

  if (!existing) {
    return {
      agentResult: {
        action: "not_found",
        message: `I couldn't find the invoice to edit. Please specify an invoice number (e.g. INV-2026-001) or say "last invoice".`,
      },
    };
  }

  const gstChange = detectGstChange(state.prompt);
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

  // ── Deterministic REMOVE — match by name, no LLM needed ──
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
      // Found and removed at least one item
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
    // If no match found → fall through to LLM
  }

  // ── LLM path: focused EDITOR_PROMPT — only sees the one invoice ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const structured = model.withStructuredOutput(invoiceSchema);
  const template = PromptTemplate.fromTemplate(EDITOR_PROMPT);

  const formatted = await template.format({
    prompt: state.prompt,
    clientName: existing.clientName,
    invoiceMonth: existing.invoiceMonth ?? "",
    gstPercent: String(existing.gstPercent),
    gstType: existing.gstType,
    discountType: existing.discountType,
    discountValue: String(existing.discountValue),
    paymentTermsDays: String(existing.paymentTermsDays),
    notes: existing.notes || "",
    subtotal: existing.subtotal.toLocaleString("en-IN"),
    total: existing.total.toLocaleString("en-IN"),
    lineItems: formatLineItemsForPrompt(existing.lineItems),
  });

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

  // ── Line item changes ──
  if (changedFields.includes("lineItems")) {
    const promptLower = state.prompt.toLowerCase();
    const isAdd =
      /\badd\b/.test(promptLower) &&
      !/\bremove\b|\breplace\b|\bdelete\b|\bswap\b/.test(promptLower);

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

    // Replace / Remove: diff to verify real change
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
