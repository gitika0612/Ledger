import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { InvoiceAgentState, AgentIntent } from "../state";

const routerSchema = z.object({
  intent: z.enum([
    "new",
    "edit",
    "copy",
    "multi",
    "split",
    "query",
    "chat",
    "unclear",
  ]),
  isMultiple: z.boolean(),
  targetRef: z.string(),
  clientName: z.string(),
  estimatedCount: z.number(),
  notes: z.string(),
});

export async function routerNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  // ── Pre-check 0: Obvious greetings, thanks, and help requests ──
  // Short, conversational messages with no invoice-related content.
  // "Invoice Priya thanks" or similar would NOT match (too long / has invoice content).
  const trimmedPrompt = state.prompt.trim();
  const isGreetingOrThanks =
    /^(hi|hello|hey|hiya|yo|sup|good morning|good afternoon|good evening)[\s!.,]*$/i.test(
      trimmedPrompt
    ) ||
    /^(thanks?|thank you|thx|ty|cheers|appreciate it|great|awesome|cool|nice|perfect|got it|ok|okay|sounds good)[\s!.,]*$/i.test(
      trimmedPrompt
    ) ||
    /^(what can you do|what do you do|help|how does this work|how do (i|you)|what is|what's the difference)/i.test(
      trimmedPrompt
    );

  // ── "Create an invoice" / "I need to bill someone" — bare invoice-creation intent
  // with NO client name and NO amount anywhere. These should never reach generatorNode
  // (which would hallucinate numbers from its own prompt examples on empty input).
  const isBareInvoiceCreationPattern =
    /^(create|make|generate|let'?s create)\b.*\b(invoice|bill)\b/i.test(
      trimmedPrompt
    ) ||
    /^i (?:want|need) to (?:create|make|generate)\b.*\b(invoice|bill)\b/i.test(
      trimmedPrompt
    ) ||
    /^i (?:want|need) to bill\b/i.test(trimmedPrompt);
  const hasAnyAmount = /[₹$€]|\d/.test(trimmedPrompt);
  const hasAnyCapitalizedName = /[A-Z][a-zA-Z]+/.test(
    trimmedPrompt.replace(/^\w+/, "")
  ); // exclude first word
  const isBareInvoiceCreation =
    isBareInvoiceCreationPattern && !hasAnyAmount && !hasAnyCapitalizedName;

  const isQuestionAboutLedger =
    /^(how (can|do|does|would|should) (i|you|we|ledger)|can (i|you|we)|could (i|you|we)|is it possible to|does ledger|will (you|ledger|it)|what if (i|we))\b/i.test(
      trimmedPrompt
    ) || /\?\s*$/.test(trimmedPrompt); // ends with "?" — almost always a genuine question, not a command

  if (isGreetingOrThanks || isBareInvoiceCreation || isQuestionAboutLedger) {
    console.log(
      "🔀 Router pre-check: ALWAYS chat →",
      trimmedPrompt.slice(0, 60)
    );
    return {
      intent: "chat",
      isMultiple: false,
      isSplit: false,
      splitCount: 1,
      targetRef: "",
      routerNotes: "deterministic: greeting/thanks/help pattern",
    };
  }

  // ── Pre-check 1: "Invoice/Bill [Name] ..." is ALWAYS new ──
  // Prevents LLM from misclassifying new invoices as edits when client exists in session.
  const startsWithInvoice = /^(invoice|bill)\s+[a-z]/i.test(
    state.prompt.trim()
  );

  // ── Does the prompt actually contain invoiceable content? ──
  // A client name (capitalized word right after Invoice/Bill) OR a currency amount.
  // "Invoice for the website thing" has neither — it's not a real invoice command,
  // so it should fall through to the LLM router (→ chat) instead of forcing "new".
  const verbAndNextWord = state.prompt.trim().match(/^(invoice|bill)\s+(\S+)/i);
  const hasClientNameAfterVerb = verbAndNextWord
    ? /^[A-Z][a-zA-Z]*$/.test(verbAndNextWord[2])
    : false;
  const hasAmount = /[₹$€]|\d/.test(state.prompt);
  const hasInvoiceableContent = hasClientNameAfterVerb || hasAmount;

  const hasCopySignal =
    /\b(same|copy|again|repeat|duplicate|last month|next month)\b/i.test(
      state.prompt
    );
  const hasEditSignal =
    /\b(add|remove|replace|change|update|set|apply|delete|swap|edit|modify|increase|decrease)\b/i.test(
      state.prompt
    );
  const hasMultiSignal =
    /\bfor\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)/i.test(
      state.prompt
    ) ||
    /\bfor\s+\d+\s+months?\b/i.test(state.prompt) ||
    /\bmonthly\s+for\b/i.test(state.prompt) ||
    /\b(q1|q2|q3|q4)\b/i.test(state.prompt) ||
    /[₹$€][\d,]+.*\band\b.*[₹$€][\d,]+/i.test(state.prompt);

  if (
    startsWithInvoice &&
    hasInvoiceableContent &&
    !hasCopySignal &&
    !hasEditSignal &&
    !hasMultiSignal
  ) {
    console.log("🔀 Router pre-check: ALWAYS new →", state.prompt.slice(0, 60));
    return {
      intent: "new",
      isMultiple: false,
      isSplit: false,
      splitCount: 1,
      targetRef: "",
      routerNotes: "deterministic: starts with Invoice/Bill pattern",
    };
  }

  // ── Pre-check 2: "Invoice Priya again" — smart recency copy ──
  // "Invoice [Name] again" with NO amount = copy that client's last invoice
  // "Invoice Priya again for June" = copy Priya's last invoice, change month to June
  // "Invoice Priya ₹50,000 again" has an amount → NOT this path (falls through to new)
  const againMatch = state.prompt.match(
    /^(?:invoice|bill)\s+([A-Za-z]+)\s+again\b/i
  );
  const againHasAmount = /[₹$€][\d,]|\d+k\b|\d+\s*lakh/i.test(state.prompt);
  if (againMatch && !againHasAmount) {
    const againClient = againMatch[1];
    console.log(
      "🔀 Router pre-check: ALWAYS copy (again) →",
      state.prompt.slice(0, 60),
      "targetRef:",
      againClient
    );
    return {
      intent: "copy",
      isMultiple: false,
      isSplit: false,
      splitCount: 1,
      targetRef: againClient,
      routerNotes: `again:${againClient}`,
    };
  }

  // ── Pre-check 3: Copy signals ──
  // "Copy ...", "Same invoice as ...", "Same as last ...", "Repeat last ..."
  // Also strip leading punctuation typos (e.g. ":Same invoice" → "Same invoice")
  const cleanPrompt = state.prompt.replace(/^[^a-zA-Z0-9₹$€]+/, "").trim();
  const isCopySignal =
    /^copy\s/i.test(cleanPrompt) ||
    /\bsame\s+(invoice|as)\b/i.test(cleanPrompt) ||
    /\brepeat\s+(last|previous)\b/i.test(cleanPrompt) ||
    /\bsame\s+wala\b/i.test(cleanPrompt) ||
    /\bpichle\s+mahine\b/i.test(cleanPrompt);

  if (isCopySignal) {
    const sourceMatch =
      cleanPrompt.match(/copy\s+(?:last\s+invoice|(\w+)'s\s+invoice)/i) ||
      cleanPrompt.match(/same\s+(?:invoice\s+)?as\s+(\w+)/i) ||
      cleanPrompt.match(/same\s+as\s+(\w+)'s/i) ||
      cleanPrompt.match(/repeat\s+(\w+)'s/i);

    const STOP_WORDS = new Set([
      "last",
      "the",
      "a",
      "an",
      "my",
      "this",
      "that",
      "invoice",
      "same",
      "as",
      "wala",
      "pichle",
      "mahine",
    ]);
    const rawRef = sourceMatch?.[1]?.trim() ?? "";
    const targetRef =
      rawRef && !STOP_WORDS.has(rawRef.toLowerCase()) ? rawRef : "last";

    const destMatch = cleanPrompt.match(
      /copy\s+(?:last\s+)?(?:\w+'s\s+)?invoice\s+for\s+([A-Za-z]+)/i
    );
    const destClient = destMatch?.[1] ?? "";

    console.log(
      "🔀 Router pre-check: ALWAYS copy →",
      state.prompt.slice(0, 60),
      "targetRef:",
      targetRef
    );
    return {
      intent: "copy",
      isMultiple: false,
      isSplit: false,
      splitCount: 1,
      targetRef,
      routerNotes: destClient
        ? `dest:${destClient}`
        : "deterministic: copy signal detected",
    };
  }

  // ── LLM routing for everything else ──
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

"chat" = casual conversation, greetings, thanks, or questions ABOUT Ledger/invoicing concepts
  (NOT about the user's own invoice data — that's "query"). Use when:
  - "what can you do?" / "what do you do" / "help" → chat
  - "how do I invoice in USD?" / "how does GST work?" → chat
  - "what's the difference between CGST and IGST?" → chat
  - "thanks!" / "thank you" / "cool" / "got it" / "nice" → chat
  - "hi" / "hello" / "good morning" → chat
  - Any message that is NOT a command to create/edit/copy/split an invoice,
    and NOT a question about the user's own invoice data → chat
  CRITICAL: "what can you do" is chat (about Ledger), but "what's my total billed to Rahul" is query (about user's data)
  CRITICAL: If the prompt has no client name, no amount, and no invoice-action keyword, and doesn't fit query → chat

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
  - CRITICAL: "Invoice [Name] [amount] net X" / "Invoice [Name] [amount] net 30" → ALWAYS "new" — the "net X" is the payment terms FOR THE NEW INVOICE, not an edit instruction. A prompt that starts with "Invoice [Name] [amount]" is ALWAYS "new" regardless of what follows.
  - CRITICAL: Any prompt matching "Invoice/Bill [ClientName] [currency amount]" pattern = ALWAYS "new", even if it also mentions GST%, payment terms, or discount.
  - CRITICAL: "Create an invoice" / "make an invoice" / "I want to create an invoice" / "generate invoice" with NO client name AND NO amount/currency anywhere in the prompt → NEVER "new". This is "chat" — ask the user for the missing details. A bare invoice-creation verb with zero specifics is NOT enough to be "new".

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

DISCOUNT RULE (very important): Any prompt containing "percent off", "% off", "discount", "% discount" with NO client name and NO new amount being invoiced → ALWAYS "edit". These are NEVER new invoices.
  - "give 10 percent off" → edit ← NO client name, NO invoice amount → ALWAYS edit
  - "10 percent off" → edit
  - "give me 15% off" → edit
  - "apply 5 percent discount" → edit
  - "10% off please" → edit
  EXCEPTION: questions phrased as "how can I...", "can I...", "is it possible to..." are asking HOW Ledger works, not issuing a command → these are "chat", never "edit":
  - "How can I apply a discount?" → chat
  - "Can I apply discount" → chat
  - "Is it possible to give a discount?" → chat

PAYMENT TERMS RULE: Any prompt that ONLY changes payment terms with no client/amount → ALWAYS "edit":
  - "make payment terms 30 days" → edit
  - "change to net 45" → edit
  - "net 30 please" → edit

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
  - "give 10 percent off" → edit (NEVER new — no client, no amount)
  - "10 percent off" → edit
  - "give me 15% discount" → edit
  - "make payment terms 45 days" → edit
  - "turn off gst" → edit
  - "can you remove the brand strategy" → edit
  - "please remove hosting" → edit
  - "[client]'s invoice" possessive = ALWAYS edit if there's any modification intent
  - "in last invoice" + any modification = ALWAYS edit
  - "in INV-XXX" + any modification = ALWAYS edit

  CRITICAL targetRef RULE for possessive edits: whenever the prompt names a client via possessive ("[Name]'s invoice"), targetRef MUST be that exact name from the PROMPT TEXT — never substitute a different client name from the session context, even if that other client's invoice is the most recent one in the session. The possessive name in the prompt always wins.
  - "Add consulting €2,000 to Emma's invoice" → edit, targetRef="Emma" (even if the most recent invoice in session belongs to Rahul — the prompt explicitly names Emma, so targetRef MUST be "Emma", never "Rahul")
  - "Add hosting fees to Priya's invoice" → edit, targetRef="Priya" (regardless of which client's invoice is currently active/most-recent in session)
  - Only fall back to the most-recent or only-draft invoice in session when the prompt has NO possessive client name at all (e.g. "add hosting fees to last invoice", "remove the discount")

  IMPORTANT: "Invoice Priya ₹50,000" has no modification intent → "new"
  IMPORTANT: "Credit note for Priya ₹5,000 due to revision in last invoice" → "new"
  IMPORTANT: Any prompt starting with "credit note" → ALWAYS "new"
  IMPORTANT: "Invoice Priya again for ₹50,000" → "new"
  IMPORTANT: "Bill Rahul for logo design" → "new"
  IMPORTANT: "Invoice [Name] [amount] net X" → ALWAYS "new" — never "edit"
  IMPORTANT: "Invoice Ankit ₹45,000 net 30" → "new" (net 30 is payment terms for the new invoice)
  KEY RULE: if prompt has modification intent + existing invoice reference (explicit OR implied by session) → ALWAYS "edit"
  KEY RULE: if prompt has ONLY a discount/tax/terms change and NO client name + amount → ALWAYS "edit"

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
"Give 10 percent off" → edit (apply discount — NEVER new, no client or amount)
"10 percent off" → edit
"Give me 15% discount" → edit
"Give 20% off" → edit
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
"Invoice Ankit ₹45,000 net 30" → new (net 30 = payment terms for new invoice, NOT edit)
"Invoice Rahul ₹30,000 net 45 no GST" → new
"Invoice Meera $5,000 net 15" → new
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
"What can you do?" → chat
"How do I invoice in USD?" → chat
"What's the difference between CGST and IGST?" → chat
"Thanks!" → chat
"Hi there" → chat
"Invoice for the website thing" → chat (no client name, no amount — ask for details)
"I need to bill someone" → chat (no client name, no amount — ask for details)
"Create an invoice" → chat (no client name, no amount — ask for details, NEVER "new")
"Make an invoice for me" → chat (no client name, no amount)
"I want to bill a client" → chat (no client name, no amount)

Also output:
- clientName: the DESTINATION client name (e.g. for "copy Rahul's for Priya" → clientName="Priya")
- targetRef: for copy, the SOURCE client (e.g. for "copy Rahul's for Priya" → targetRef="Rahul")
  for edit, the invoice being edited (client name or INV number)
- For "same invoice but for June" with no explicit source client → targetRef="" (copier will use last session invoice)`
  );

  let intent = result.intent as AgentIntent;
  const isSplit = intent === "split";
  if (isSplit) intent = "new";

  let correctedTargetRef = result.targetRef || "";
  if (intent === "edit") {
    const possessiveMatch = state.prompt.match(
      /\b([A-Z][a-zA-Z]*)'s\s+invoice\b/
    );
    if (possessiveMatch && possessiveMatch[1]) {
      const promptClient = possessiveMatch[1];
      if (
        correctedTargetRef &&
        correctedTargetRef.toLowerCase() !== promptClient.toLowerCase()
      ) {
        console.log(
          "🔧 targetRef correction:",
          correctedTargetRef,
          "→",
          promptClient,
          "(possessive name in prompt overrides LLM extraction)"
        );
      }
      correctedTargetRef = promptClient;
    }
  }

  console.log(
    "🔀 Router result:",
    JSON.stringify({
      intent: result.intent,
      targetRef: correctedTargetRef,
      clientName: result.clientName,
    })
  );

  return {
    intent,
    isMultiple: result.isMultiple || (result.estimatedCount > 1 && !isSplit),
    isSplit,
    splitCount: isSplit ? result.estimatedCount : 1,
    targetRef: correctedTargetRef,
    routerNotes: result.notes,
  };
}
