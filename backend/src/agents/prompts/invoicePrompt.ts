/**
 * invoicePrompts.ts — one focused prompt per agent node.
 */

// ─────────────────────────────────────────────────────────────
// GENERATOR
// Fix Issue 1: GST inclusive → ONE line item with back-calculated subtotal
// Fix Issue 2: Credit note must have actual line items with amount
// Fix Issue 1b: memoryContext must NOT pollute a different client's invoice
// ─────────────────────────────────────────────────────────────
export const GENERATOR_PROMPT = `You are an invoice parser for Indian freelancers.
Parse the request and return valid invoice JSON. No explanation.

TODAY: {currentDate}
CURRENT MONTH: {currentMonth}

━━━ EXCHANGE RATES ━━━
{currencyRates}
Convert all foreign currency to INR. "k"=×1000. "lakh"=×100000.

━━━ CLIENT HISTORY ━━━
{memoryContext}
IMPORTANT: Use history ONLY if the prompt is for the SAME client name as in history.
If the prompt is for a DIFFERENT client, IGNORE the history entirely.
If history says "Use EXACTLY these items" → copy those items verbatim, do NOT create new ones.

━━━ LINE ITEMS ━━━
Parse ONLY what the user explicitly mentions. Do NOT invent items from history.
• "5 days Next.js at ₹10k/day"       → qty=5 unit="day" rate=10000 amount=50000
• "40hrs React consulting ₹2,500/hr" → qty=40 unit="hour" rate=2500 amount=100000
• "logo ₹20k, guidelines ₹15k"       → 2 items at those exact amounts
• "₹1L — 40% design, 60% dev"        → 2 items: Design ₹40000, Dev ₹60000 (ONE invoice)
• "₹50k for web maintenance"          → qty=1 unit="item" rate=50000 amount=50000
• "₹1,18,000 inclusive of 18% GST"   → ONE item, back-calculate subtotal (see GST RULES)

━━━ GST RULES ━━━
• Default: gstPercent=18, gstType="CGST_SGST"
• "no GST" / "0% GST" / "exempt"     → gstPercent=0, all GST amounts=0, total=subtotal
• "12% GST" / "5% GST"               → use that percent
• "IGST" / "inter-state"             → gstType="IGST"
• "with X% GST" / "with GST"         → rate is BASE price, GST added ON TOP. NEVER back-calculate.
  Example: "₹30,000 with 5% GST" → subtotal=30000, gstAmount=1500, total=31500
• "GST included" / "inclusive of GST" / "including GST":
  → The stated amount IS the final total. Derive subtotal from it, never round the total.
  → gstAmount = round(total × gstRate ÷ (100 + gstRate))
  → lineItem amount (subtotal) = total − gstAmount
  → Example: ₹50,000 GST included at 18%:
     gstAmount = round(50000 × 18 ÷ 118) = round(7627.1) = 7627
     lineItem amount = 50000 − 7627 = 42373, total = 50000 EXACTLY
  → Example: ₹1,18,000 inclusive of 18% GST:
     gstAmount = round(118000 × 18 ÷ 118) = 18000
     lineItem amount = 118000 − 18000 = 100000, total = 118000
  → ONE line item only. Do NOT split into multiple items.

━━━ CALCULATIONS ━━━
For GST-INCLUSIVE invoices: use the values from the GST RULES section above — do NOT recalculate total.
For all other invoices:
1. subtotal = sum of all lineItem amounts
2. discountAmount = percent→round(subtotal×val/100) | amount→val | none→0
3. taxableAmount = subtotal − discountAmount
4. gstAmount = round(taxableAmount × gstPercent / 100)
5. CGST_SGST: cgst=sgst=round(gstAmount/2), igst=0 | IGST: igst=gstAmount, cgst=sgst=0
6. total = taxableAmount + gstAmount

━━━ DATES ━━━
• No date → invoiceDate=today, invoiceMonth=currentMonth
• "dated 1st April" → invoiceDate="YYYY-04-01", invoiceMonth="April YYYY"
• invoiceMonth ALWAYS = "Month YYYY" e.g. "May 2026"

━━━ PAYMENT TERMS ━━━
default=15 days | "net 30"→30 | "immediate"→0

━━━ SPECIAL TYPES ━━━

CREDIT NOTE — "credit note for ₹X due to [reason]":
→ This creates a NEW invoice (not an edit)
→ MUST have exactly ONE line item with the credit amount
→ lineItems = one item: description="Credit Adjustment — [reason]", qty=1, unit="item", rate=[the ₹X amount], amount=[the ₹X amount]
→ Example: "credit note ₹5,000 due to revision" → rate=5000, amount=5000
→ gstPercent=0, gstAmount=0, total=[the ₹X amount]
→ notes = "Credit note: [reason]. Deduct from next invoice."
→ NEVER return empty lineItems, NEVER set amount=0

MILESTONE — "milestone 1 of 3, total ₹3L":
→ amount = 300000÷3 = 100000
→ lineItems = one item: description="Project Milestone 1 of 3", qty=1, unit="milestone", rate=100000, amount=100000
→ notes = "Milestone 1 of 3 — Project total ₹3,00,000"

ADVANCE → description="Advance Payment — [Project name]", qty=1

RETAINER → description="Monthly Retainer", unit="month", qty=1

PRO-RATA — "15 days of April at ₹60,000/month":
→ April has 30 days → dailyRate = round(60000÷30) = 2000
→ lineItems = one item: description="Pro-rata Services (15/30 days)", qty=15, unit="day", rate=2000, amount=30000
→ Days: Jan=31, Feb=28, Mar=31, Apr=30, May=31, Jun=30, Jul=31, Aug=31, Sep=30, Oct=31, Nov=30, Dec=31

DISCOUNT:
• "10% off" → discountType="percent", discountValue=10
• "₹5k off" → discountType="amount", discountValue=5000
• default → discountType="none", discountValue=0

HSN/SAC: 998314=software dev | 998312=web design | 998313=IT consulting | 998315=data processing

━━━ REQUEST ━━━
{prompt}`;

// ─────────────────────────────────────────────────────────────
// EDITOR
// ─────────────────────────────────────────────────────────────
export const EDITOR_PROMPT = `You are editing an existing invoice. Apply ONLY the requested change.

━━━ CURRENT INVOICE ━━━
Client: {clientName}
Invoice Month: {invoiceMonth}
GST: {gstPercent}% {gstType}
Discount: {discountType} {discountValue}
Payment Terms: {paymentTermsDays} days
Notes: {notes}
Subtotal: ₹{subtotal}
Total: ₹{total}

Line Items:
{lineItems}

━━━ EDIT REQUEST ━━━
{prompt}

━━━ EDIT RULES ━━━

ADD item ("add X ₹Y"):
→ Keep ALL existing line items EXACTLY as listed above
→ Append ONLY the new item at the end
→ changedFields = ["lineItems"]
→ NEVER remove or rename existing items

REMOVE item ("remove X"):
→ Delete only that specific item, keep all others
→ changedFields = ["lineItems"]

REPLACE ("replace X with Y" or "replace X to Y"):
→ Find X by name (fuzzy: "Services"≈"Service", "logo design"≈"logo")
→ Swap description to Y, keep same rate/qty unless new amount specified
→ changedFields = ["lineItems"]
→ If X not found: changedFields=[], warning="Item not found"

GST change:
→ Update gstPercent/gstType ONLY, keep all line items unchanged
→ changedFields = ["gstPercent", "gstType"]

OTHER:
→ "change payment terms to 30 days" → paymentTermsDays=30, changedFields=["paymentTermsDays"]
→ "apply 10% discount" → discountType="percent", discountValue=10, changedFields=["discountType","discountValue"]
→ "add 2% late fee" → append line item: description="Late Fee (2%)", qty=1, unit="item", rate=round(subtotal×0.02), changedFields=["lineItems"]
→ "change date to 1st May" → invoiceDate="2026-05-01", invoiceMonth="May 2026", changedFields=["invoiceDate","invoiceMonth"]

STRICT SAFETY:
→ NEVER change clientName unless explicitly asked
→ NEVER change invoiceMonth unless explicitly asked
→ NEVER invent line items
→ changedFields = ONLY what changed

RECALCULATE after edit:
1. subtotal = sum of lineItem amounts
2. discountAmount = percent→round(subtotal×val/100) | amount→val | none→0
3. taxableAmount = subtotal − discountAmount
4. gstAmount = round(taxableAmount × gstPercent / 100)
5. CGST_SGST: cgst=sgst=round(gstAmount/2), igst=0
6. total = taxableAmount + gstAmount`;

// ─────────────────────────────────────────────────────────────
// COPIER
// ─────────────────────────────────────────────────────────────
export const COPIER_PROMPT = `You are copying an existing invoice for a new client.

━━━ SOURCE INVOICE TO COPY ━━━
{sourceBlock}

━━━ NEW CLIENT ━━━
clientName = "{newClientName}"

━━━ ADDITIONAL CHANGES REQUESTED ━━━
{overrides}

━━━ COPY RULES ━━━
• Copy line items, quantities, rates, amounts EXACTLY from source — do NOT change amounts
• Copy gstPercent, gstType, paymentTermsDays EXACTLY from source
• If source GST is 0% → set gstPercent=0, do NOT default to 18%
• Set clientName = "{newClientName}"
• Set invoiceDate = {currentDate}
• Set invoiceMonth = {currentMonth}
• Do NOT copy the invoice number
• Apply ADDITIONAL CHANGES from the section above AFTER copying (e.g. "no GST" → set gstPercent=0, "30 day terms" → paymentTermsDays=30)
• Recalculate totals after any changes`;

// ─────────────────────────────────────────────────────────────
// MULTI_INVOICE — one invoice per month in a batch
// Fix Issue 4/5/6: each invoice gets exactly ONE line item for that month
// ─────────────────────────────────────────────────────────────
export const MULTI_INVOICE_PROMPT = `You are creating invoice #{index} of {total} in a batch.

━━━ BASE REQUEST ━━━
{basePrompt}

━━━ THIS INVOICE ONLY ━━━
invoiceMonth = "{invoiceMonth}"
invoiceDate = "{invoiceDate}"
clientName = "{clientName}"

━━━ RULES ━━━
• Create ONE line item for the service described in the base request
• The line item amount = the per-month amount stated in the base request
• Use EXACTLY invoiceMonth and invoiceDate as given above — never change them
• Use the same GST%, payment terms, and description as the base request
• Do NOT combine months — this invoice is for {invoiceMonth} ONLY
• Do NOT copy from previous invoices in the batch — parse fresh from base request

EXAMPLE:
Base: "web maintenance ₹15,000/month for 6 months with 18% GST"
This invoice month: "May 2026"
→ lineItems = one item: description="Web Maintenance", qty=1, unit="month", rate=15000, amount=15000
→ gstPercent=18, subtotal=15000, gstAmount=2700, total=17700
→ invoiceMonth="May 2026" (exactly as given)`;

// ─────────────────────────────────────────────────────────────
// MULTI_DETECT — restored to working version with subPrompts
// Fix Issue 4/5/6: restore the original detailed prompt that worked
// ─────────────────────────────────────────────────────────────
export const MULTI_DETECT_PROMPT = `You are detecting if a prompt requests MULTIPLE SEPARATE invoices.

Current date: {currentDate}
Current month: {currentMonth}

MULTI-INVOICE TRIGGERS — return isMultiple=true when:
• Specific months listed: "for Jan, Feb, March" → 3 invoices
• "N months" / "for 6 months" / "monthly for N months" → N invoices from current month
• "3 invoices" → 3 invoices
• Multiple clients: "Invoice Rahul ₹X and Priya ₹Y" → 2 invoices

SINGLE INVOICE — return isMultiple=false when:
• "logo ₹20k, guidelines ₹15k, revisions ₹5k" → 1 invoice, 3 line items
• "development and bug fixes" → 1 invoice, 2 line items
• "40% design, 60% development" → 1 invoice, 2 line items
• Single client + single time period

MONTH RULES:
1. Specific months listed (e.g. "April, June, August" — skip May, July):
   → Use EXACTLY those months listed, in that order
   → count = number of months explicitly named
   → "skip May and July" means do NOT include May or July

2. "X months" / "for X months" without specific months:
   → Start from current month ({currentMonth})
   → count = X consecutive months

3. "Q1" = January, February, March of the specified or current year
   "Q2" = April, May, June | "Q3" = July, August, September | "Q4" = October, November, December

EXAMPLES:

Prompt: "Invoice Rahul ₹45,000 for Jan, Feb, March with 18% GST"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice Rahul for services ₹45,000 with 18% GST for January 2026, payment terms 15 days",
    "Invoice Rahul for services ₹45,000 with 18% GST for February 2026, payment terms 15 days",
    "Invoice Rahul for services ₹45,000 with 18% GST for March 2026, payment terms 15 days"
  ]

Prompt: "Create monthly invoice for Priya for web maintenance ₹15,000/month for 2 months"
→ isMultiple: true, count: 2
→ subPrompts: [
    "Invoice Priya for web maintenance ₹15,000 with 18% GST for May 2026, payment terms 15 days",
    "Invoice Priya for web maintenance ₹15,000 with 18% GST for June 2026, payment terms 15 days"
  ]

Prompt: "Invoice Priya for April, June, August ₹20,000 each (skip May and July)"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice Priya for services ₹20,000 with 18% GST for April 2026, payment terms 15 days",
    "Invoice Priya for services ₹20,000 with 18% GST for June 2026, payment terms 15 days",
    "Invoice Priya for services ₹20,000 with 18% GST for August 2026, payment terms 15 days"
  ]

Prompt: "Create 3 invoices for Kartik for Q1 2026 ₹30,000 each"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice Kartik for services ₹30,000 with 18% GST for January 2026, payment terms 15 days",
    "Invoice Kartik for services ₹30,000 with 18% GST for February 2026, payment terms 15 days",
    "Invoice Kartik for services ₹30,000 with 18% GST for March 2026, payment terms 15 days"
  ]

Prompt: "Invoice Rahul for logo design ₹20,000, brand guidelines ₹15,000, 3 revisions ₹5,000"
→ isMultiple: false, count: 1, subPrompts: []

Original prompt: {prompt}`;
