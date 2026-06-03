import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { InvoiceAgentState, AgentIntent } from "../state";

const routerSchema = z.object({
  intent: z.enum(["new", "edit", "copy", "multi", "split", "query", "unclear"]),
  isMultiple: z.boolean(),
  targetRef: z.string(),
  clientName: z.string(),
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

"query" = user is ASKING about existing invoices (not creating/editing). Use when:
  - "show me all overdue invoices" → query
  - "which invoices are due this week?" → query
  - "which invoices are due this month?" → query
  - "which invoices are due for May?" → query
  - "show me all draft/confirmed/sent invoices" → query
  - "show me all invoices for Priya" → query
  - "what's the total I've billed Rahul?" → query
  - "what's the total I've billed in 2026?" → query
  - "find all invoices above ₹1,00,000" → query
  - "show unpaid invoices" / "show outstanding invoices" → query
  - "show me all clients with outstanding payments" → query
  - "mark Priya's invoice as paid" / "mark INV-2026-001 as paid" → query
  - "Ankit paid ₹50,000 today" → query
  - Any question about existing invoice data → query
  CRITICAL: "show", "find", "list", "which", "what's my total", "how much", "mark as paid" → ALWAYS query

"new" = create a FRESH invoice. Use when:
  - "Invoice X for ₹Y" — any prompt that states an amount and a client name
  - "Invoice Priya ₹50,000 no GST" → NEW (even if Priya already has an invoice in session)
  - "Bill Rahul for logo design" → NEW
  - "Invoice Priya again" → NEW (new invoice using her history)
  - "₹1,00,000 — 40% design, 60% development" → NEW invoice with 2 line items (NOT split, NOT multi)
  - Percentage split like "40% X, 60% Y" is ALWAYS "new" with multiple line items in ONE invoice
  - CRITICAL: If a prompt has an amount + percentage breakdown (e.g. "₹1,00,000 — 40% X, 60% Y"), it is ALWAYS "new". Never "multi". Never "split".
  - CRITICAL: If the prompt contains a client name + amount/service description with NO edit keywords and NO copy keywords, it is ALWAYS "new".

"edit" = modify an EXISTING invoice in session. Use when the user wants to change something about an invoice they already created.

Standard edit keywords: add / remove / replace / change / update / set / increase / decrease / apply / put / delete / swap / make / give / take off / get rid of / turn off / bump / zero out / clear / adjust

Natural language edit patterns (NO standard keyword needed — classify as edit anyway):
  - "no more gst" → edit (remove GST)
  - "no more tax" → edit (remove tax)
  - "get rid of gst" → edit
  - "take off the gst" → edit
  - "turn off gst" → edit
  - "zero gst please" → edit
  - "make it no gst" → edit
  - "make payment terms 30 days" → edit
  - "give 10 percent off" → edit (apply discount)
  - "bump up the gst to 18%" → edit
  - "kill the gst" → edit
  - "can you remove X" → edit
  - "please remove X" → edit
  - "kindly delete X" → edit
  - "how about 30 day terms" → edit (context: existing invoice)

CRITICAL RULE FOR EDIT: If the session has existing invoices AND the prompt is about modifying tax / GST / VAT / discount / payment terms / a line item — it is ALWAYS "edit", even without standard keywords.

Examples:
  - "add hosting fees to last invoice" → edit
  - "add GST to INV-2026-001" → edit
  - "remove logo design from Rahul's invoice" → edit, targetRef="Rahul"
  - "add brand strategy ₹10,000 to Rahul's invoice" → edit, targetRef="Rahul"
  - "change payment terms to 30 days in last invoice" → edit
  - "no more gst" → edit (remove GST from last invoice)
  - "no more tax" → edit (remove tax from last invoice)
  - "get rid of gst" → edit
  - "take off the gst" → edit
  - "give 10 percent off" → edit (apply 10% discount)
  - "make payment terms 45 days" → edit
  - "turn off gst" → edit
  - "can you remove the brand strategy" → edit
  - "please remove hosting" → edit
  - "[client]'s invoice" possessive = ALWAYS edit if there's any modification intent
  - "in last invoice" + any modification = ALWAYS edit
  - "in INV-XXX" + any modification = ALWAYS edit
  IMPORTANT: "Invoice Priya ₹50,000" has no modification intent → "new"
  IMPORTANT: "Credit note for Priya ₹5,000 due to revision in last invoice" → "new"
  IMPORTANT: Any prompt starting with "credit note" → ALWAYS "new"
  IMPORTANT: "Invoice Priya again for ₹50,000" → "new"
  IMPORTANT: "Bill Rahul for logo design" → "new"
  KEY RULE: if prompt has modification intent + existing invoice reference (explicit OR implied by session) → ALWAYS "edit"

"copy" = duplicate existing invoice for a DIFFERENT client OR different month. Use when:
  - "same invoice as [client]'s" → copy, targetRef = that client
  - "same as [client]'s invoice" → copy, targetRef = that client
  - "create same invoice as [client]'s but for [other]" → copy, targetRef = first client
  - "copy [client]'s invoice for [other client]" → copy, targetRef = first client
  - "same as last one but for [client]" → copy, targetRef = "last"
  - "same invoice but for June" → copy, targetRef = most recent client in session
  - "same as last month for [client] but for June" → copy, targetRef = that client
  - "same invoice as last month for Priya but for June" → copy, targetRef = "Priya"
  - "same work for [client] but this month" → copy, targetRef = that client
  - "same invoice for next month" → copy, targetRef = "last"
  - "repeat last invoice for June" → copy, targetRef = "last"
  - "usi tarah ka invoice [client] ke liye" → copy (Hinglish: same type invoice for client)
  - "same wala for [client]" → copy (Hinglish)
  - "pichle mahine wala [client] ke liye" → copy (Hinglish: last month's for client)
  - targetRef = SOURCE client name or invoice number (the one being copied FROM)
  CRITICAL: "Create same invoice as X's but for Y" starts with "Create" but is ALWAYS "copy" NOT "new"
  CRITICAL: Any phrase containing "same invoice as [client]" or "same as [client]'s" = ALWAYS "copy"
  CRITICAL: "same invoice" + client name = copy, regardless of what verb starts the sentence
  CRITICAL: "same invoice but for [month]" = copy, targetRef = last invoice's client in session
  CRITICAL: "same as last month" / "last month wala" / "pichle mahine jaisa" = copy
  CRITICAL: When prompt has "same" + (month/client change) → ALWAYS copy
  CRITICAL: Poor grammar / broken English — if intent is clearly "same invoice, different client/month" → copy

"multi" = multiple SEPARATE invoices for different months/periods. Use when:
  - "for Jan, Feb, March" (specific months listed)
  - "for 6 months" / "monthly for N months" / "for next N months"
  - "3 invoices for Rahul" (3 separate invoices)
  - "monthly retainer for 4 months" → multi (4 separate monthly invoices)
  - "retainer for next 3 months" → multi
  - estimatedCount = number of invoices
  CRITICAL: "monthly invoice for N months" → ALWAYS multi, estimatedCount=N
  CRITICAL: "for N months" at the end of any prompt → ALWAYS multi, estimatedCount=N
  CRITICAL: "monthly" + "N months" in the same prompt → ALWAYS multi
  CRITICAL: "Invoice [client] ₹X for [month], [month], [month]" → ALWAYS multi, one invoice per month listed
  CRITICAL: Multiple month names in a single prompt → ALWAYS multi, estimatedCount = number of months
  CRITICAL: "for Jan, Feb, March" / "for January, February, March" → ALWAYS multi even if prompt starts with "Invoice"
  CRITICAL: "Invoice [client1] ₹X and [client2] ₹Y" → ALWAYS multi, estimatedCount=2
  CRITICAL: Multiple client names with separate amounts in one prompt → ALWAYS multi
  CRITICAL: "[name] ₹X and [name] ₹Y" pattern → multi, never new
  NEVER use "multi" for: percentage splits, multiple line items in one invoice

"split" = divide ONE invoice total into N equal parts. Use when:
  - "split [client]'s invoice into N parts"
  - "divide into N equal invoices"
  - NOT for percentage splits like "40% design, 60% development" (that's "new")

DISAMBIGUATION EXAMPLES:
"Invoice Priya ₹50,000 no GST" → new
"Invoice Rahul ₹1,00,000 — 40% design, 60% development" → new (single invoice, 2 line items)
"Add hosting fees in last invoice" → edit, targetRef = last invoice client/number
"No more gst" → edit (remove GST from last invoice in session)
"No more tax" → edit (remove tax from last invoice)
"Get rid of gst" → edit
"Take off the gst" → edit
"Turn off gst" → edit
"Zero gst please" → edit
"Give 10 percent off" → edit (apply discount)
"Make payment terms 45 days" → edit
"Bump up gst to 18%" → edit
"Can you remove the brand strategy" → edit
"Please remove hosting" → edit
"Kindly delete the last line item" → edit
"Split Ankit's invoice into 2 parts" → split
"Create 3 invoices for Jan, Feb, March" → multi, estimatedCount=3
"Same invoice as last one but for Ankit" → copy, targetRef="last"
"Copy Rahul's invoice for Priya" → copy, targetRef="Rahul"
"Invoice Priya again for ₹50,000 no GST" → new
"Create same invoice as Priya's but for Kartik with no GST" → copy, targetRef="Priya"
"Make same invoice as Rahul's for Meera" → copy, targetRef="Rahul"
"Same as Priya's invoice but for Kartik" → copy, targetRef="Priya"
"Same invoice but for Ankit" → copy, targetRef = most recent client in session
"Same invoice but for June" → copy, targetRef = most recent client in session
"Same invoice as last month for Priya but for June" → copy, targetRef="Priya"
"Same wala invoice for Ankit" → copy, targetRef = most recent client in session
"Priya ka same invoice June ke liye" → copy, targetRef="Priya"
"Pichle mahine jaisa Ankit ke liye" → copy, targetRef = most recent or Ankit's last invoice
"Same as last month for Priya" → copy, targetRef="Priya"
"Repeat Priya's last invoice for this month" → copy, targetRef="Priya"
"Same work for Ankit but June" → copy, targetRef="Ankit"
"Create monthly invoice for Priya for web maintenance ₹15,000/month for 6 months" → multi, estimatedCount=6
"Monthly retainer for Rahul ₹20,000 for 3 months" → multi, estimatedCount=3
"Invoice Kartik ₹10,000/month for 4 months" → multi, estimatedCount=4
"Web maintenance ₹15,000 for next 6 months" → multi, estimatedCount=6
"Invoice Rahul ₹45,000 for Jan, Feb, March with 18% GST" → multi, estimatedCount=3
"Bill Priya ₹20,000 for April and June" → multi, estimatedCount=2
"Invoice Kartik ₹30,000 for Q1 2026" → multi, estimatedCount=3
"Invoice Rahul ₹50,000 and Priya ₹30,000 for development" → multi, estimatedCount=2
"Bill Rahul ₹20,000 and Ankit ₹15,000" → multi, estimatedCount=2
"Show me all overdue invoices" → query
"Which invoices are due this week?" → query
"What's the total I've billed Rahul in 2026?" → query
"Show all draft invoices" → query
"Mark INV-2026-001 as paid" → query
"Ankit paid today" → query
"Show me all invoices for Priya this year" → query
"Find all invoices above ₹1,00,000" → query
"Show clients with outstanding payments" → query

Also output:
- clientName: the DESTINATION client name (e.g. for "copy Rahul's for Priya" → clientName="Priya")
- targetRef: for copy, the SOURCE client (e.g. for "copy Rahul's for Priya" → targetRef="Rahul")
  for edit, the invoice being edited (client name or INV number)
- For "same invoice but for June" with no explicit source client → targetRef="" (copier will use last session invoice)`
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
