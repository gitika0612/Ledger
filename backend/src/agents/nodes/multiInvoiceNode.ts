import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
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
import { recalculateTotals, formatINR } from "../utils/invoiceUtils";

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

  // Step 1: Build skip set — find everything after "skip"/"except"/"excluding"
  const skipSet = new Set<number>();
  // Use greedy match and stop at closing paren, period, or end
  const skipRegex =
    /\b(?:skip|except|not\s+includ\w*|exclud\w*)\b\s+([\w\s,]+?)(?:[).!?]|$)/gi;
  let skipMatch;
  while ((skipMatch = skipRegex.exec(lower)) !== null) {
    for (const part of skipMatch[1].split(/[\s,]+/)) {
      const clean = part.replace(/[^a-z]/g, "");
      if (clean in monthAbbrevMap) skipSet.add(monthAbbrevMap[clean]);
    }
  }

  // Step 2: Extract included months in ORDER they appear, excluding skipped ones
  const found: number[] = [];
  // Split on non-alpha characters but preserve order
  const parts = lower.split(/[\s,()!?]+/);
  for (const part of parts) {
    const clean = part.replace(/[^a-z]/g, "");
    if (clean in monthAbbrevMap) {
      const idx = monthAbbrevMap[clean];
      if (!found.includes(idx) && !skipSet.has(idx)) {
        found.push(idx);
      }
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
  // "April 2026" → "2026-04-01"
  const [monthName, yearStr] = monthStr.split(" ");
  const monthIdx = MONTH_NAMES.indexOf(monthName);
  const year = parseInt(yearStr);
  if (monthIdx === -1 || isNaN(year))
    return new Date().toISOString().split("T")[0];
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

// Extract client name from prompt
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

  // Try "for [Name]" — first capitalized word after "for" that isn't a stop word
  const forMatches = [...prompt.matchAll(/\bfor\s+([A-Z][a-zA-Z]+)/gi)];
  for (const m of forMatches) {
    const name = m[1];
    if (!STOP_WORDS.has(name.toLowerCase())) return name;
  }

  // Try "[Name]'s invoice"
  const possessive = prompt.match(
    /([A-Z][a-zA-Z]+)'s\s+(?:[\d,₹]+\s+)?invoice/i
  );
  if (possessive && !STOP_WORDS.has(possessive[1].toLowerCase())) {
    return possessive[1];
  }

  // Try "Invoice/Bill [Name]"
  const direct = prompt.match(/^(?:invoice|bill)\s+([A-Z][a-zA-Z]+)/i);
  if (direct && !STOP_WORDS.has(direct[1].toLowerCase())) {
    return direct[1];
  }

  return "Client";
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

  // ── Step 1: Detect how many invoices and which months ──
  const multiStructured = model.withStructuredOutput(multiInvoiceSchema);
  const multiTemplate = PromptTemplate.fromTemplate(MULTI_DETECT_PROMPT);
  const multiFormatted = await multiTemplate.format({
    prompt: state.prompt,
    currentMonth,
    currentDate,
  });
  const detection = await multiStructured.invoke(multiFormatted);

  if (!detection.isMultiple || detection.subPrompts.length <= 1) {
    return { isMultiple: false };
  }

  // Use subPrompts count — the detect prompt now generates meaningful subPrompts again
  const count = detection.subPrompts.length;

  // ── Step 2: Determine correct months ──
  const explicitMonths = extractExplicitMonths(state.prompt, currentYear);
  let expectedMonths: string[];
  let finalCount = count; // from LLM detection

  if (explicitMonths.length >= 2) {
    // Explicit months found (with or without skip) — use them directly
    // Override LLM count since LLM ignores skip instructions
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

  // ── Step 3: Extract base info from prompt ──
  const clientName = extractClientName(state.prompt);
  const currencyRates = await buildCurrencyContext();

  // ── Step 4: Generate each invoice ──
  const invoiceStructured = model.withStructuredOutput(invoiceSchema);
  const invoiceTemplate = PromptTemplate.fromTemplate(MULTI_INVOICE_PROMPT);

  const parsedInvoices: ParsedInvoice[] = [];

  // Detect if this is multi-CLIENT (different clients) vs multi-MONTH (same client)
  // Multi-client: subPrompts have different client names
  // Multi-month: same client, different months
  const isMultiClient =
    detection.subPrompts.length > 1 &&
    new Set(
      detection.subPrompts.map((sp) => {
        const m = sp.match(/Invoice\s+([A-Z][a-z]+)/i);
        return m?.[1]?.toLowerCase() ?? "";
      })
    ).size > 1;

  if (isMultiClient) {
    // ── Multi-client: generate each invoice directly from its subPrompt ──
    for (const subPrompt of detection.subPrompts) {
      const currencyRates = await buildCurrencyContext();
      const generatorTemplate = PromptTemplate.fromTemplate(GENERATOR_PROMPT);
      const formatted = await generatorTemplate.format({
        prompt: subPrompt,
        memoryContext: state.memoryContext ?? "No past invoice history.",
        currentMonth,
        currentDate,
        currencyRates,
      });
      const raw = (await invoiceStructured.invoke(formatted)) as ParsedInvoice;
      parsedInvoices.push(recalculateTotals(raw));
    }
  } else {
    // ── Multi-month: existing loop unchanged ──
    for (let i = 0; i < finalCount; i++) {
      const invoiceMonth = expectedMonths[i];
      const invoiceDate = monthToDate(invoiceMonth);
      const formatted = await invoiceTemplate.format({
        index: String(i + 1),
        total: String(finalCount),
        basePrompt: state.prompt,
        invoiceMonth,
        invoiceDate,
        clientName,
        memoryContext: state.memoryContext,
      });
      const raw = (await invoiceStructured.invoke(formatted)) as ParsedInvoice;
      parsedInvoices.push(
        recalculateTotals({
          ...raw,
          clientName,
          invoiceMonth,
          invoiceDate,
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

  // ── Step 6: Summary message ──
  const totalSum = parsedInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const summaryLabel = isMultiClient
    ? parsedInvoices
        .map(
          (inv) => `**${inv.clientName}** ₹${inv.total.toLocaleString("en-IN")}`
        )
        .join(", ")
    : `**${clientName}** (${expectedMonths.join(", ")})`;

  const result: AgentResult = {
    action: "multi_created",
    message: `Done! Prepared **${
      parsedInvoices.length
    } invoices** for ${summaryLabel}.\n\nTotal value: **${formatINR(
      totalSum
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
