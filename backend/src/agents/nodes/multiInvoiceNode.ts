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

  const QUARTERS: Record<string, number[]> = {
    q1: [0, 1, 2],
    q2: [3, 4, 5],
    q3: [6, 7, 8],
    q4: [9, 10, 11],
  };
  const lower = prompt.toLowerCase();
  for (const [q, months] of Object.entries(QUARTERS)) {
    const qMatch = lower.match(new RegExp(`\\b${q}\\b\\s*(\\d{4})?`));
    if (qMatch) {
      const qYear = qMatch[1] ? parseInt(qMatch[1]) : year;
      return months.map((idx) => `${MONTH_NAMES[idx]} ${qYear}`);
    }
  }

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

function detectGstPercent(prompt: string): number {
  const match =
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*gst/i) ||
    prompt.match(/gst\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)\s*%/i);
  return match ? parseFloat(match[1]) : 18;
}

function detectTaxPercent(prompt: string): number {
  const match =
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:tax|vat)/i) ||
    prompt.match(/(?:tax|vat)\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)\s*%/i);
  return match ? parseFloat(match[1]) : 0;
}

function extractPerInvoiceAmount(prompt: string): number | null {
  const m1 = prompt.match(
    /[₹]([0-9,]+(?:\.[0-9]+)?)\s*(?:\/month|per\s+month)?(?:\s+for\b|\s+with\b|\s*$)/i
  );
  if (m1) return parseInt(m1[1].replace(/,/g, ""));
  const m2 = prompt.match(/[₹]([0-9,]+)/);
  if (m2) return parseInt(m2[1].replace(/,/g, ""));
  const m3 = prompt.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
  if (m3) return parseFloat(m3[1].replace(/,/g, ""));
  const m4 = prompt.match(/€([0-9,]+(?:\.[0-9]+)?)/);
  if (m4) return parseFloat(m4[1].replace(/,/g, ""));
  return null;
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

  const hasExplicitTax =
    /\d+\s*%\s*(?:gst|tax|vat)/i.test(state.prompt) ||
    /(?:gst|tax|vat)\s*(?:at|of|@)?\s*\d+\s*%/i.test(state.prompt);
  const noTaxMentioned =
    /no\s*(?:gst|tax|vat)|tax\s*exempt|tax\s*free|\b0%\s*(?:gst|tax|vat)/i.test(
      state.prompt
    );

  const gstPercent =
    currency === "INR"
      ? noTaxMentioned
        ? 0
        : detectGstPercent(state.prompt)
      : 0;
  const taxPercent =
    currency !== "INR"
      ? noTaxMentioned
        ? 0
        : detectTaxPercent(state.prompt)
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
    for (const subPrompt of detection.subPrompts) {
      const subCurrency = detectCurrency(subPrompt);
      const subGstPercent =
        subCurrency === "INR"
          ? /no\s*(gst|tax)/i.test(subPrompt)
            ? 0
            : detectGstPercent(subPrompt)
          : 0;
      const subTaxPercent =
        subCurrency !== "INR"
          ? /no\s*(tax|vat)/i.test(subPrompt)
            ? 0
            : detectTaxPercent(subPrompt)
          : 0;

      const formatted = fillTemplate(GENERATOR_PROMPT, {
        prompt: esc(subPrompt),
        memoryContext: "No past invoice history.",
        currentMonth,
        currentDate,
        currencyRates: esc(currencyRates),
      });
      const raw = (await invoiceStructured.invoke(formatted)) as ParsedInvoice;

      // Extract clientName from subprompt directly — don't trust LLM for this
      const subClientName =
        subPrompt.match(/^Invoice\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
        subPrompt.match(/\bfor\s+([A-Z][a-zA-Z]+)/i)?.[1] ||
        raw.clientName ||
        "Client";

      let enforced = recalculateTotals({
        ...raw,
        clientName: subClientName,
        currency: subCurrency,
        gstPercent: subGstPercent,
        gstType: raw.gstType ?? "CGST_SGST",
        taxPercent: subTaxPercent,
        taxLabel:
          subCurrency === "EUR" ? "VAT" : subCurrency === "USD" ? "Tax" : "",
      });

      // ── Enforce stated amount from subprompt ──
      const subAmounts = [
        ...subPrompt.matchAll(/[₹$€]([0-9,]+(?:\.[0-9]+)?)/g),
      ];
      if (subAmounts.length === 1 && enforced.lineItems?.length > 0) {
        const subStatedBase = parseInt(subAmounts[0][1].replace(/,/g, ""));
        const llmAmt = enforced.lineItems[0].amount;
        const absDiff = Math.abs(llmAmt - subStatedBase);
        if (
          absDiff > 0 &&
          (absDiff / subStatedBase > 0.005 ||
            (subStatedBase % 100 === 0 && absDiff <= 10))
        ) {
          enforced = recalculateTotals({
            ...enforced,
            lineItems: [
              {
                ...enforced.lineItems[0],
                amount: subStatedBase,
                rate: subStatedBase,
              },
            ],
          });
          console.log(
            `✅ Multi-client amount corrected for ${subClientName}: ${llmAmt} → ${subStatedBase}`
          );
        }
      }

      parsedInvoices.push(enforced);
    }
  } else {
    let basePromptWithTax = state.prompt;
    if (currency === "INR" && !hasExplicitTax && !noTaxMentioned) {
      basePromptWithTax = `${state.prompt} with 18% CGST_SGST`;
    } else if (currency !== "INR" && noTaxMentioned) {
      basePromptWithTax = `${state.prompt} no tax`;
    }

    const statedAmount = extractPerInvoiceAmount(state.prompt);

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
      let inv = recalculateTotals({
        ...raw,
        clientName,
        invoiceMonth,
        invoiceDate,
        currency,
        gstPercent: currency === "INR" ? gstPercent : 0,
        gstType:
          raw.gstType === "IGST" && !/igst|inter.state/i.test(state.prompt)
            ? "CGST_SGST"
            : raw.gstType,
        taxPercent: currency !== "INR" ? taxPercent : 0,
      });

      // ── Enforce stated amount — LLM sometimes hallucinates different amounts ──
      if (statedAmount !== null && inv.lineItems?.length > 0) {
        const llmAmount = inv.lineItems[0].amount;
        const absDiff = Math.abs(llmAmount - statedAmount);
        if (
          absDiff > 0 &&
          (absDiff / statedAmount > 0.005 ||
            (statedAmount % 100 === 0 && absDiff <= 10))
        ) {
          console.log(
            `⚠️ Multi-invoice amount mismatch for ${invoiceMonth}: LLM=${llmAmount}, correcting to ${statedAmount}`
          );
          inv = recalculateTotals({
            ...inv,
            lineItems: [
              { ...inv.lineItems[0], amount: statedAmount, rate: statedAmount },
            ],
          });
        }
      }

      // ── Enforce paymentTermsDays — LLM returns 0 for some months ──
      if (!inv.paymentTermsDays || inv.paymentTermsDays === 0) {
        inv = {
          ...inv,
          paymentTermsDays:
            raw.paymentTermsDays > 0 ? raw.paymentTermsDays : 15,
        };
      }

      parsedInvoices.push(inv);
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
  // For mixed currency batches, don't sum totals — currencies can't be combined
  const allSameCurrency = parsedInvoices.every(
    (inv) => inv.currency === parsedInvoices[0].currency
  );
  const totalSum = parsedInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const summaryLabel = isMultiClient
    ? parsedInvoices
        .map(
          (inv) =>
            `**${inv.clientName}** ${formatCurrency(inv.total, inv.currency)}`
        )
        .join(", ")
    : `**${clientName}** (${expectedMonths.join(", ")})`;

  const totalLine = allSameCurrency
    ? `\n\nTotal value: **${formatCurrency(
        totalSum,
        parsedInvoices[0].currency
      )}**`
    : "";

  const result: AgentResult = {
    action: "multi_created",
    message: `Done! Prepared **${parsedInvoices.length} invoices** for ${summaryLabel}.${totalLine}\n\nReview each invoice in the side panel.`,
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
