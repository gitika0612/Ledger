import { InvoiceAgentState } from "../state";
import { findSimilarInvoices } from "../../lib/embeddingService";
import { Invoice } from "../../models/Invoice";
import { IInvoiceDocument } from "../../models/Invoice";

function buildMemoryContext(
  invoices: IInvoiceDocument[],
  prompt: string
): string {
  if (invoices.length === 0) return "No past invoice history for this client.";

  const lower = prompt.toLowerCase();
  const isSameWork =
    lower.includes("same work") ||
    lower.includes("same as last") ||
    lower.includes("like last time") ||
    lower.includes("again") ||
    lower.includes("repeat") ||
    lower.includes("previous");

  if (isSameWork) {
    const latest = invoices[0];
    const items = latest.lineItems
      .map((item) => `${item.description} (₹${item.rate}/${item.unit})`)
      .join(", ");
    return (
      `Most recent invoice for this client [${
        latest.invoiceMonth || "unknown month"
      }]:\n` +
      `Items: ${items}\n` +
      `GST: ${latest.gstPercent}% ${latest.gstType}\n` +
      `Terms: ${latest.paymentTermsDays} days\n` +
      `Total: ₹${latest.total.toLocaleString("en-IN")}\n` +
      `Use EXACTLY these line items, rates, GST, and payment terms for the new invoice.`
    );
  }

  const recent = invoices.slice(0, 3);
  const lines = recent.map((inv, i) => {
    const items = inv.lineItems
      .map((item) => `${item.description} (₹${item.rate}/${item.unit})`)
      .join(", ");
    return (
      `Invoice ${i + 1} [${inv.invoiceMonth || "unknown"}]: ` +
      `Items: ${items} | GST: ${inv.gstPercent}% ${inv.gstType} | ` +
      `Terms: ${inv.paymentTermsDays}d | Total: ₹${inv.total.toLocaleString(
        "en-IN"
      )}`
    );
  });

  const mostRecentRates: Record<string, number> = {};
  for (const inv of recent) {
    for (const item of inv.lineItems) {
      if (!mostRecentRates[item.description])
        mostRecentRates[item.description] = item.rate;
    }
  }
  const rateHints = Object.entries(mostRecentRates)
    .map(([desc, rate]) => `${desc}: ₹${rate}`)
    .join(", ");

  return [
    `Past ${recent.length} invoice(s) for this client:`,
    ...lines,
    `Most recent rates: ${rateHints}`,
    `Use these as DEFAULT rates when creating a new invoice for this client.`,
  ].join("\n");
}

export async function ragNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  // Skip RAG for edits and copies — they use session context directly
  if (state.intent === "edit" || state.intent === "copy") {
    return { memoryContext: "No past invoice history for this client." };
  }

  const promptLower = state.prompt.toLowerCase();
  const isSameWorkIntent =
    promptLower.includes("same work") ||
    promptLower.includes("again for same") ||
    promptLower.includes("like last time") ||
    promptLower.includes("again for the same") ||
    (promptLower.includes("again") && promptLower.includes("same"));

  // If "same work" AND session already has a recent invoice for this client,
  // skip RAG (which fetches old DB embeddings) and point to session context.
  if (
    isSameWorkIntent &&
    state.sessionContext &&
    state.sessionContext !== "No existing invoices in this session."
  ) {
    return {
      memoryContext:
        "Use the [MOST RECENT] invoice in session context as the source for line items and rates. Do NOT invent new items.",
    };
  }

  try {
    let pastInvoices: (IInvoiceDocument & { similarityScore: number })[] =
      await findSimilarInvoices(state.userId, state.prompt, undefined, 5);

    if (pastInvoices.length === 0) {
      // Fallback: search by client name extracted from prompt
      const words = state.prompt.split(" ");
      const commonWords = new Set([
        "invoice",
        "bill",
        "create",
        "make",
        "generate",
        "for",
        "to",
        "the",
        "a",
        "an",
        "with",
        "and",
        "or",
        "gst",
        "monthly",
        "again",
        "another",
        "same",
        "like",
        "last",
        "time",
        "send",
        "new",
      ]);
      const possibleClientName = words.find(
        (w) =>
          w.length > 2 && !commonWords.has(w.toLowerCase()) && /^[A-Z]/.test(w)
      );
      if (possibleClientName) {
        const fallback = await Invoice.find({
          userId: state.userId,
          clientName: { $regex: new RegExp(possibleClientName, "i") },
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();
        // Add dummy similarityScore to match findSimilarInvoices return type
        pastInvoices = fallback.map((inv) => ({
          ...inv,
          similarityScore: 0,
        })) as unknown as (IInvoiceDocument & { similarityScore: number })[];
      }
    }

    const memoryContext = buildMemoryContext(
      pastInvoices as IInvoiceDocument[],
      state.prompt
    );
    return {
      retrievedInvoices: pastInvoices as IInvoiceDocument[],
      memoryContext,
    };
  } catch (err) {
    console.warn("⚠️ RAG node failed, continuing without memory:", err);
    return {
      memoryContext: "No past invoice history for this client.",
      retrievedInvoices: [],
    };
  }
}
