import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { InvoiceAgentState, AgentIntent } from "../state";

const routerSchema = z.object({
  intent: z.enum(["new", "edit", "copy", "multi", "split", "unclear"]),
  isMultiple: z.boolean(),
  targetRef: z.string(), // For edit/copy: source invoice ref or client name
  clientName: z.string(), // Primary client name from the prompt
  estimatedCount: z.number(),
  notes: z.string(),
});

export async function routerNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const structured = model.withStructuredOutput(routerSchema);

  const result = await structured.invoke(
    `You are routing an invoice request. Be precise.

Session context (existing invoices):
${state.sessionContext}

User prompt: "${state.prompt}"

ROUTING RULES — read carefully:

"new" = create a FRESH invoice. Use when:
  - "Invoice X for ₹Y" — any prompt that states an amount and a client name
  - "Invoice Priya ₹50,000 no GST" → NEW (even if Priya already has an invoice in session)
  - "Bill Rahul for logo design" → NEW
  - "Invoice Priya again" → NEW (new invoice using her history)
  - "₹1,00,000 — 40% design, 60% development" → NEW invoice with 2 line items (NOT split, NOT multi)
  - Percentage split like "40% X, 60% Y" is ALWAYS "new" with multiple line items in ONE invoice
  - CRITICAL: If a prompt has an amount + percentage breakdown (e.g. "₹1,00,000 — 40% X, 60% Y"), it is ALWAYS "new". Never "multi". Never "split".
  - CRITICAL: If the prompt contains a client name + amount/service description with NO edit keywords and NO copy keywords, it is ALWAYS "new".

"edit" = modify an EXISTING invoice in session. Use when:
  - The prompt has an edit keyword (add/remove/replace/change/update/set/increase/decrease/apply/put/delete/swap)
  - AND it references an existing invoice via: "last invoice", "INV-XXX", "[client]'s invoice", "in last invoice"
  Examples:
  - "add hosting fees to last invoice" → edit
  - "add GST to INV-2026-001" → edit
  - "remove logo design from Rahul's invoice" → edit, targetRef="Rahul"
  - "add brand strategy ₹10,000 to Rahul's invoice" → edit, targetRef="Rahul"
  - "change payment terms to 30 days in last invoice" → edit
  - "add late fee to Priya's invoice" → edit, targetRef="Priya"
  - "replace Services with Logo Design in last invoice" → edit
  - "[client]'s invoice" possessive = ALWAYS edit if there's an edit keyword
  - "in last invoice" + any modification = ALWAYS edit
  - "in INV-XXX" + any modification = ALWAYS edit
  IMPORTANT: "Invoice Priya ₹50,000" has NO edit keywords → "new"
  IMPORTANT: "Credit note for Priya ₹5,000 due to revision in last invoice" → "new" (creates a new credit note invoice, not an edit)
  IMPORTANT: Any prompt starting with "credit note" → ALWAYS "new"
  IMPORTANT: "Invoice Priya again for ₹50,000" → "new" (again = repeat, not edit)
  IMPORTANT: "Bill Rahul for logo design" → "new" (no existing invoice reference)
  IMPORTANT: "Add brand strategy ₹10,000 to Rahul's invoice" → "edit" (targetRef="Rahul"), NOT new
  IMPORTANT: "Add/Remove/Replace X to/from [client]'s invoice" → ALWAYS "edit"
  KEY RULE: if prompt has [edit keyword] + [client]'s invoice → it is ALWAYS "edit" regardless of amount

"copy" = duplicate existing invoice for a DIFFERENT client. Use when:
  - "same invoice as [client]'s" → copy, targetRef = that client
  - "same as [client]'s invoice" → copy, targetRef = that client
  - "create same invoice as [client]'s but for [other]" → copy, targetRef = first client
  - "copy [client]'s invoice for [other client]" → copy, targetRef = first client
  - "same as last one but for [client]" → copy, targetRef = "last"
  - targetRef = SOURCE client name or invoice number (the one being copied FROM)
  CRITICAL: "Create same invoice as X's but for Y" starts with "Create" but is ALWAYS "copy" NOT "new"
  CRITICAL: Any phrase containing "same invoice as [client]" or "same as [client]'s" = ALWAYS "copy"
  CRITICAL: "same invoice" + client name = copy, regardless of what verb starts the sentence

"multi" = multiple SEPARATE invoices for different months/periods. Use when:
  - "for Jan, Feb, March" (specific months listed)
  - "for 6 months" / "monthly for N months" / "for next N months"
  - "3 invoices for Rahul" (3 separate invoices)
  - "monthly retainer for 4 months" → multi (4 separate monthly invoices)
  - "retainer for next 3 months" → multi
  - estimatedCount = number of invoices
  NEVER use "multi" for: percentage splits, multiple line items in one invoice, retainer/maintenance without a count

"split" = divide ONE invoice total into N equal parts. Use when:
  - "split [client]'s invoice into N parts"
  - "divide into N equal invoices"
  - NOT for percentage splits like "40% design, 60% development" (that's "new")

DISAMBIGUATION EXAMPLES:
"Invoice Priya ₹50,000 no GST" → new
"Invoice Rahul ₹1,00,000 — 40% design, 60% development" → new (single invoice, 2 line items)
"Add hosting fees in last invoice" → edit, targetRef = last invoice client/number
"Split Ankit's invoice into 2 parts" → split
"Create 3 invoices for Jan, Feb, March" → multi, estimatedCount=3
"Same invoice as last one but for Ankit" → copy, targetRef="last"
"Copy Rahul's invoice for Priya" → copy, targetRef="Rahul"
"Invoice Priya again for ₹50,000 no GST" → new
"Create same invoice as Priya's but for Kartik with no GST" → copy, targetRef="Priya"
"Make same invoice as Rahul's for Meera" → copy, targetRef="Rahul"
"Same as Priya's invoice but for Kartik" → copy, targetRef="Priya"

Also output:
- clientName: the DESTINATION client name (e.g. for "copy Rahul's for Priya" → clientName="Priya")
- targetRef: for copy, the SOURCE client (e.g. for "copy Rahul's for Priya" → targetRef="Rahul")
  for edit, the invoice being edited (client name or INV number)`
  );

  let intent = result.intent as AgentIntent;
  const isSplit = intent === "split";
  if (isSplit) intent = "new";

  console.log(
    "🔀 Router result:",
    JSON.stringify({
      intent: result.intent,
      targetRef: result.targetRef,
      clientName: result.clientName,
    })
  );

  return {
    intent,
    isMultiple: result.isMultiple || (result.estimatedCount > 1 && !isSplit),
    isSplit,
    splitCount: isSplit ? result.estimatedCount : 1,
    targetRef: result.targetRef || "",
    routerNotes: result.notes,
  };
}
