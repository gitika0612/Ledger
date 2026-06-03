import { ChatOpenAI } from "@langchain/openai";
import { InvoiceAgentState, AgentResult } from "../state";
import {
  ParsedInvoice,
  invoiceSchema,
  multiInvoiceSchema,
} from "../schemas/invoiceSchema";
import {
  MULTI_INVOICE_PROMPT,
  MULTI_DETECT_PROMPT,
  GENERATOR_PROMPT,
} from "../prompts/invoicePrompt";
import { findClientMatch } from "../../lib/clientMatcher";
import { buildCurrencyContext } from "../utils/currencyService";
import { recalculateTotals, formatCurrency } from "../utils/invoiceUtils";

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

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

function esc(str: string): string {
  return str ?? "";
}

function extractExplicitMonths(prompt: string, year: number): string[] {
  const monthAbbrevMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  const lower = prompt.toLowerCase();
  const skipSet = new Set<number>();
  const skipRegex =
    /\b(?:skip|except|not\s+includ\w*|exclud\w*)\b\s+([\w\s,]+?)(?:[).!?]|$)/gi;
  let skipMatch;
  while ((skipMatch = skipRegex.exec(lower)) !== null) {
    for (const part of skipMatch[1].split(/[\s,]+/)) {
      const clean = part.replace(/[^a-z]/g, "");
      if (clean in monthAbbrevMap) skipSet.add(monthAbbrevMap[clean]);
    }
  }

  const found: number[] = [];
  const parts = lower.split(/[\s,()!?]+/);
  for (const part of parts) {
    const clean = part.replace(/[^a-z]/g, "");
    if (clean in monthAbbrevMap) {
      const idx = monthAbbrevMap[clean];
      if (!found.includes(idx) && !skipSet.has(idx)) found.push(idx);
    }
  }

  return found.map((idx) => `${MONTH_NAMES[idx]} ${year}`);
}

function generateConsecutiveMonths(
  startMonthIdx: number,
  startYear: number,
  count: number
): string[] {
  const result: string[] = [];
  let m = startMonthIdx;
  let y = startYear;
  for (let i = 0; i < count; i++) {
    result.push(`${MONTH_NAMES[m]} ${y}`);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return result;
}

function monthToDate(monthStr: string): string {
  const [monthName, yearStr] = monthStr.split(" ");
  const monthIdx = MONTH_NAMES.indexOf(monthName);
  const year = parseInt(yearStr);
  if (monthIdx === -1 || isNaN(year))
    return new Date().toISOString().split("T")[0];
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

function extractClientName(prompt: string): string {
  const STOP_WORDS = new Set([
    "monthly",
    "weekly",
    "daily",
    "annual",
    "yearly",
    "invoice",
    "bill",
    "services",
    "maintenance",
    "retainer",
    "create",
    "make",
    "generate",
    "new",
    "next",
    "each",
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

  const forMatches = [...prompt.matchAll(/\bfor\s+([A-Z][a-zA-Z]+)/gi)];
  for (const m of forMatches) {
    const name = m[1];
    if (!STOP_WORDS.has(name.toLowerCase())) return name;
  }

  const possessive = prompt.match(
    /([A-Z][a-zA-Z]+)'s\s+(?:[\d,₹$€]+\s+)?invoice/i
  );
  if (possessive && !STOP_WORDS.has(possessive[1].toLowerCase()))
    return possessive[1];

  const direct = prompt.match(/^(?:invoice|bill)\s+([A-Z][a-zA-Z]+)/i);
  if (direct && !STOP_WORDS.has(direct[1].toLowerCase())) return direct[1];

  return "Client";
}

function detectCurrency(prompt: string): "INR" | "USD" | "EUR" {
  if (/\$|USD|dollars?/i.test(prompt)) return "USD";
  if (/€|EUR|euros?/i.test(prompt)) return "EUR";
  return "INR";
}

// ── Detect GST percent from prompt for INR invoices ──
function detectGstPercent(prompt: string): number {
  const match =
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*gst/i) ||
    prompt.match(/gst\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)\s*%/i);
  return match ? parseFloat(match[1]) : 18; // default 18%
}

// ── Detect tax percent from prompt for USD/EUR invoices ──
function detectTaxPercent(prompt: string): number {
  const match =
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:tax|vat)/i) ||
    prompt.match(/(?:tax|vat)\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)\s*%/i);
  return match ? parseFloat(match[1]) : 0; // default 0 for USD/EUR
}

export async function multiInvoiceNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYear = now.getFullYear();
  const currentMonth = now.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const currentDate = now.toISOString().split("T")[0];

  // ── Step 1: Detect how many invoices ──
  const multiStructured = model.withStructuredOutput(multiInvoiceSchema);
  const multiFormatted = fillTemplate(MULTI_DETECT_PROMPT, {
    prompt: esc(state.prompt),
    currentMonth,
    currentDate,
  });
  const detection = await multiStructured.invoke(multiFormatted);

  if (!detection.isMultiple || detection.subPrompts.length <= 1) {
    return { isMultiple: false };
  }

  const count = detection.subPrompts.length;

  // ── Step 2: Determine months ──
  const explicitMonths = extractExplicitMonths(state.prompt, currentYear);
  let expectedMonths: string[];
  let finalCount = count;

  if (explicitMonths.length >= 2) {
    expectedMonths = explicitMonths;
    finalCount = explicitMonths.length;
  } else if (explicitMonths.length === 1) {
    expectedMonths = generateConsecutiveMonths(
      MONTH_NAMES.indexOf(explicitMonths[0].split(" ")[0]),
      currentYear,
      count
    );
  } else {
    expectedMonths = generateConsecutiveMonths(
      currentMonthIdx,
      currentYear,
      count
    );
  }

  // ── Step 3: Extract base info ──
  const clientName = extractClientName(state.prompt);
  const currency = detectCurrency(state.prompt);
  const currencyRates = await buildCurrencyContext();

  // ── Detect tax from prompt — use explicit value or sensible default ──
  const hasExplicitTax =
    /\d+\s*%\s*(?:gst|tax|vat)/i.test(state.prompt) ||
    /(?:gst|tax|vat)\s*(?:at|of|@)?\s*\d+\s*%/i.test(state.prompt);
  const noTaxMentioned =
    /no\s*(?:gst|tax|vat)|tax\s*exempt|tax\s*free|0%\s*(?:gst|tax|vat)/i.test(
      state.prompt
    );

  const gstPercent =
    currency === "INR"
      ? noTaxMentioned
        ? 0
        : detectGstPercent(state.prompt) // default 18% for INR
      : 0;
  const taxPercent =
    currency !== "INR"
      ? noTaxMentioned
        ? 0
        : detectTaxPercent(state.prompt) // default 0% for USD/EUR
      : 0;

  // ── Step 4: Generate invoices ──
  const invoiceStructured = model.withStructuredOutput(invoiceSchema);
  const parsedInvoices: ParsedInvoice[] = [];

  const isMultiClient =
    detection.subPrompts.length > 1 &&
    new Set(
      detection.subPrompts.map((sp) => {
        const m = sp.match(/Invoice\s+([A-Z][a-z]+)/i);
        return m?.[1]?.toLowerCase() ?? "";
      })
    ).size > 1;

  if (isMultiClient) {
    // ── Multi-client: each from its own subPrompt via GENERATOR_PROMPT ──
    for (const subPrompt of detection.subPrompts) {
      const formatted = fillTemplate(GENERATOR_PROMPT, {
        prompt: esc(subPrompt),
        memoryContext: "No past invoice history.",
        currentMonth,
        currentDate,
        currencyRates: esc(currencyRates),
      });
      const raw = (await invoiceStructured.invoke(formatted)) as ParsedInvoice;
      parsedInvoices.push(recalculateTotals(raw));
    }
  } else {
    // ── Multi-month: build basePrompt with explicit tax so MULTI_INVOICE_PROMPT
    //    doesn't default to 0 for INR invoices ──
    let basePromptWithTax = state.prompt;

    if (currency === "INR" && !hasExplicitTax && !noTaxMentioned) {
      // Append default GST so the LLM doesn't guess
      basePromptWithTax = `${state.prompt} with 18% CGST_SGST`;
    } else if (currency !== "INR" && noTaxMentioned) {
      basePromptWithTax = `${state.prompt} no tax`;
    }

    for (let i = 0; i < finalCount; i++) {
      const invoiceMonth = expectedMonths[i];
      const invoiceDate = monthToDate(invoiceMonth);
      const formatted = fillTemplate(MULTI_INVOICE_PROMPT, {
        index: String(i + 1),
        total: String(finalCount),
        basePrompt: esc(basePromptWithTax),
        invoiceMonth,
        invoiceDate,
        clientName,
        currency,
        memoryContext: "No past invoice history.",
      });
      const raw = (await invoiceStructured.invoke(formatted)) as ParsedInvoice;
      parsedInvoices.push(
        recalculateTotals({
          ...raw,
          clientName,
          invoiceMonth,
          invoiceDate,
          currency,
          // ── Enforce detected tax — never let MULTI_INVOICE_PROMPT override ──
          gstPercent: currency === "INR" ? gstPercent : 0,
          gstType:
            raw.gstType === "IGST" && !/igst|inter.state/i.test(state.prompt)
              ? "CGST_SGST" // fix IGST default
              : raw.gstType,
          taxPercent: currency !== "INR" ? taxPercent : 0,
        })
      );
    }
  }

  // ── Step 5: Client match ──
  const invoicesWithMatch = await Promise.all(
    parsedInvoices.map(async (invoice) => {
      const matchResult = state.userId
        ? await findClientMatch(state.userId, invoice.clientName)
        : { type: "none" as const, client: null, score: 0 };
      return { invoice, matchResult };
    })
  );

  // ── Step 6: Summary ──
  const totalSum = parsedInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const summaryLabel = isMultiClient
    ? parsedInvoices
        .map(
          (inv) =>
            `**${inv.clientName}** ${formatCurrency(inv.total, inv.currency)}`
        )
        .join(", ")
    : `**${clientName}** (${expectedMonths.join(", ")})`;

  const result: AgentResult = {
    action: "multi_created",
    message: `Done! Prepared **${
      parsedInvoices.length
    } invoices** for ${summaryLabel}.\n\nTotal value: **${formatCurrency(
      totalSum,
      currency
    )}**\n\nReview each invoice in the side panel.`,
    invoices: parsedInvoices,
    invoicesWithMatch,
  };

  return {
    isMultiple: true,
    parsedInvoices,
    invoicesWithMatch,
    agentResult: result,
    responseMessage: result.message,
  };
}
