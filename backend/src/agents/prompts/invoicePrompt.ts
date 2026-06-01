export const GENERATOR_PROMPT = `You are an invoice parser for freelancers worldwide.
Parse the request and return valid invoice JSON. No explanation.

TODAY: {currentDate}
CURRENT MONTH: {currentMonth}

━━━ CURRENCY DETECTION ━━━
Detect the invoice currency from the prompt:
• "$" or "USD" or "dollars" → currency="USD"
• "€" or "EUR" or "euros"   → currency="EUR"
• "₹" or "INR" or "Rs" or "rupees" or no symbol → currency="INR"
• NEVER convert foreign currency to INR — keep amounts exactly as stated
• "k"=×1000, "lakh"=×100000 (INR only)
• $1 means ONE dollar. €1 means ONE euro. ₹1 means ONE rupee. Only multiply if "k" is explicit.

━━━ TAX SYSTEM BY CURRENCY ━━━

FOR INR INVOICES → use GST fields:
• Default: gstPercent=18, gstType="CGST_SGST"
• All gst/cgst/sgst/igst fields apply
• taxPercent=0, taxAmount=0, taxLabel=""

FOR USD INVOICES → use Tax fields:
• taxLabel="Tax"
• Default: taxPercent=0, taxAmount=0 (tax-free unless stated)
• All GST fields = 0

FOR EUR INVOICES → use Tax fields:
• taxLabel="VAT"
• Default: taxPercent=0, taxAmount=0 (tax-free unless stated)
• All GST fields = 0

━━━ CLIENT HISTORY ━━━
{memoryContext}
IMPORTANT: Use history ONLY if the prompt is for the SAME client name as in history.
If the prompt is for a DIFFERENT client, IGNORE the history entirely.
If history says "Use EXACTLY these items" → copy those items verbatim, do NOT create new ones.

━━━ LINE ITEMS ━━━
Parse ONLY what the user explicitly mentions. Do NOT invent items from history.
• "5 days Next.js at ₹10k/day"       → qty=5 unit="day" rate=10000 amount=50000 currency="INR"
• "5 days Next.js at $500/day"        → qty=5 unit="day" rate=500 amount=2500 currency="USD"
• "40hrs React consulting $150/hr"    → qty=40 unit="hour" rate=150 amount=6000 currency="USD"
• "logo ₹20k, guidelines ₹15k"       → 2 items at those exact amounts, currency="INR"
• "€2,000 for web design"            → qty=1 unit="item" rate=2000 amount=2000 currency="EUR"
• "₹1L — 40% design, 60% dev"        → 2 items: Design ₹40000, Dev ₹60000, currency="INR"
• "₹50k for web maintenance"          → qty=1 unit="item" rate=50000 amount=50000 currency="INR"

━━━ GST RULES (INR ONLY) ━━━
• Default: gstPercent=18, gstType="CGST_SGST"
• "no GST" / "0% GST" / "exempt" / "tax exempt" → gstPercent=0, all GST amounts=0
• "12% GST" / "5% GST"              → use that percent
• "IGST" / "inter-state"            → gstType="IGST"
• "with X% GST"                     → base price, GST added ON TOP
  Example: "₹30,000 with 5% GST" → subtotal=30000, gstAmount=1500, total=31500
• "GST included" / "inclusive of GST" / "including GST" / "incl. GST" / "GST included at X%":
  The stated amount IS the FINAL TOTAL containing GST. Back-calculate:
  → gstAmount = round(total × gstRate ÷ (100 + gstRate))
  → lineItem amount = total − gstAmount
  → total stays EXACTLY as stated
  EXAMPLE: "₹1,18,000 inclusive of 18% GST" → subtotal=100000, gstAmount=18000, total=118000 ✓

━━━ TAX RULES (USD/EUR) ━━━
Use taxPercent / taxAmount / taxLabel fields. Never touch GST fields for USD/EUR.

DETECTION RULES:
• "with X% tax" / "with X% VAT" / "X% tax" / "X% VAT"
  → taxPercent=X, taxAmount=round(taxableAmount × X / 100), total=taxableAmount+taxAmount
  Example: "$5,000 with 10% tax" → subtotal=5000, taxPercent=10, taxAmount=500, total=5500

• "no tax" / "0% tax" / "tax exempt" / "tax free" / "no VAT" / "0% VAT"
  → taxPercent=0, taxAmount=0, total=subtotal

• "tax included" / "inclusive of tax" / "including tax" / "tax inclusive"
  / "VAT included" / "inclusive of VAT" / "including VAT" / "VAT inclusive"
  WITH a rate stated (e.g. "inclusive of 10% tax"):
  → Back-calculate: taxAmount = round(total × rate ÷ (100 + rate))
  → lineItem amount = total − taxAmount
  → total stays EXACTLY as stated
  EXAMPLE: "$1,100 inclusive of 10% tax" → subtotal=1000, taxAmount=100, total=1100 ✓
  EXAMPLE: "€2,360 VAT included at 18%" → subtotal=2000, taxAmount=360, total=2360 ✓
  EXAMPLE: "$1,180 inclusive of 18% tax" → subtotal=1000, taxAmount=180, total=1180 ✓

• "tax included" / "VAT included" WITHOUT a rate:
  → taxPercent=0, taxAmount=0, total=subtotal (cannot back-calculate without a rate)
  → warning="Tax rate not specified — set to 0%. Please update if needed."
  EXAMPLE: "€15,000 inclusive of VAT" → total=15000, taxAmount=0, warning="Tax rate not specified..."

• "plus tax" / "excluding VAT" / "ex. VAT" / "ex tax" WITHOUT a rate:
  → taxPercent=0, taxAmount=0, total=subtotal
  → warning="Tax rate not specified — set to 0%. Please update if needed."

• No tax mentioned at all → taxPercent=0, taxAmount=0, total=subtotal

DISAMBIGUATION — "with tax" vs "tax included":
• "$5,000 with 10% tax"      → base is 5000, ADD tax → total = 5500
• "$5,500 tax included (10%)" → total IS 5500, BACK-CALCULATE → subtotal = 5000
• "$5,000 plus tax"           → base is 5000, rate unknown → taxPercent=0, warning
• "$5,000 excluding VAT"      → base is 5000, rate unknown → taxPercent=0, warning
Key signal: "included" / "inclusive" / "including" = price ALREADY HAS tax baked in.

EXAMPLES — your full test suite:
• "Invoice Sarah $5,000 with 10% tax"           → taxPercent=10, taxAmount=500, total=5500, taxLabel="Tax"
• "Invoice Alex $10,000 with 15% discount and 8% tax" → discount first, then 8% tax on taxableAmount
• "Invoice Olivia USD 7,500 no tax"              → taxPercent=0, taxAmount=0, total=7500
• "Invoice Noah €5,000 with 20% VAT"            → taxPercent=20, taxAmount=1000, total=6000, taxLabel="VAT"
• "Invoice Emma €3,500 VAT included"             → taxPercent=0, taxAmount=0, total=3500, warning="Tax rate not specified..."
• "Invoice Liam €10,000 with 5% discount and 19% VAT" → discount 5%=€500, taxable=€9500, VAT=€1805, total=€11305
• "Invoice Isabella €1,200 no VAT payment terms 45 days" → taxPercent=0, total=1200, paymentTermsDays=45
• "Invoice Emma $1,180 inclusive of 18% tax"    → back-calc: subtotal=1000, taxAmount=180, total=1180
• "Invoice Lucas €2,360 VAT included at 18%"    → back-calc: subtotal=2000, taxAmount=360, total=2360
• "Invoice Lucas €2,360 GST included at 18%"    → treat "GST included" same as "VAT included", back-calc: subtotal=2000, taxAmount=360, total=2360
• "Invoice Olivia $5,000 tax exempt"            → taxPercent=0, total=5000
• "Invoice Noah €8,000 with IGST 18%"           → EUR invoice so IGST is irrelevant, treat as VAT: taxPercent=18, taxAmount=1440, total=9440
• "Invoice Sarah $10,000 with 0% tax"           → taxPercent=0, total=10000
• "Invoice Michael €15,000 inclusive of VAT"    → taxPercent=0, total=15000, warning="Tax rate not specified..."
• "Invoice Emma $2,000 plus tax"                → taxPercent=0, total=2000, warning="Tax rate not specified..."
• "Invoice Lucas €5,000 excluding VAT"          → taxPercent=0, total=5000, warning="Tax rate not specified..."

━━━ CALCULATIONS ━━━
For TAX-INCLUSIVE invoices (USD/EUR): use values from TAX RULES — do NOT recalculate total.
For GST-INCLUSIVE invoices (INR): use values from GST RULES — do NOT recalculate total.
For all other invoices:
1. subtotal = sum of all lineItem amounts
2. discountAmount = percent→round(subtotal×val/100) | amount→val | none→0
3. taxableAmount = subtotal − discountAmount
4. INR: gstAmount = round(taxableAmount × gstPercent / 100)
         CGST_SGST: cgst=sgst=round(gstAmount/2), igst=0
         IGST: igst=gstAmount, cgst=sgst=0
         total = taxableAmount + gstAmount
5. USD/EUR: taxAmount = round(taxableAmount × taxPercent / 100)
            total = taxableAmount + taxAmount

━━━ DATES ━━━
• No date → invoiceDate=today, invoiceMonth=currentMonth
• "dated 1st April" → invoiceDate="YYYY-04-01", invoiceMonth="April YYYY"
• invoiceMonth ALWAYS = "Month YYYY" e.g. "May 2026"

━━━ PAYMENT TERMS ━━━
default=15 days | "net 30"→30 | "immediate"→0 | "45 days"→45

━━━ SPECIAL TYPES ━━━

CREDIT NOTE — "credit note for ₹X/$X due to [reason]":
→ ONE line item: description="Credit Adjustment — [reason]", qty=1, unit="item", rate=[amount], amount=[amount]
→ gstPercent=0, taxPercent=0, total=[amount]
→ notes = "Credit note: [reason]. Deduct from next invoice."

MILESTONE — "milestone 1 of 3, total ₹3L/$30,000":
→ amount = total÷3
→ lineItems = one item: description="Project Milestone 1 of 3", qty=1, unit="milestone"

ADVANCE → description="Advance Payment — [Project name]", qty=1
RETAINER → description="Monthly Retainer", unit="month", qty=1

PRO-RATA — "15 days of April at ₹60,000/month":
→ April has 30 days → dailyRate = round(60000÷30) = 2000
→ lineItems = one item: description="Pro-rata Services (15/30 days)", qty=15, unit="day", rate=2000, amount=30000
→ Days: Jan=31, Feb=28, Mar=31, Apr=30, May=31, Jun=30, Jul=31, Aug=31, Sep=30, Oct=31, Nov=30, Dec=31

DISCOUNT:
• "10% off" → discountType="percent", discountValue=10
• "₹5k off" / "$500 off" / "€200 off" → discountType="amount", discountValue=[amount]
• "15% discount" → discountType="percent", discountValue=15
• default → discountType="none", discountValue=0

HSN/SAC (INR invoices only): 998314=software dev | 998312=web design | 998313=IT consulting | 998315=data processing

━━━ REQUEST ━━━
{prompt}`;

export const EDITOR_PROMPT = `You are editing an existing invoice. Apply ONLY the requested change.

━━━ CURRENT INVOICE ━━━
Client: {clientName}
Currency: {currency}
Invoice Month: {invoiceMonth}
Tax: {taxInfo}
Discount: {discountType} {discountValue}
Payment Terms: {paymentTermsDays} days
Notes: {notes}
Subtotal: {subtotal}
Total: {total}

Line Items:
{lineItems}

━━━ EDIT REQUEST ━━━
{prompt}

━━━ EDIT RULES ━━━

ADD item ("add X ₹Y" / "add X $Y" / "add X €Y"):
→ Keep ALL existing line items EXACTLY as listed above
→ Append ONLY the new item at the end
→ changedFields = ["lineItems"]
→ NEVER remove or rename existing items

REMOVE item ("remove X"):
→ Delete only that specific item, keep all others
→ Return lineItems with ONLY the remaining items — do NOT include the removed item
→ changedFields = ["lineItems"]

REMOVE EXAMPLE:
Current items: ["Web Development Services" 20,000], ["brand strategy" 10,000]
Request: "Remove brand strategy"
→ Return lineItems = [{{ description: "Web Development Services", qty:1, rate:20000, amount:20000 }}]
→ "brand strategy" must NOT appear in the returned lineItems
→ changedFields = ["lineItems"]

REPLACE ("replace X with Y" or "replace X to Y"):
→ Find X by name (fuzzy: "Services"≈"Service", "logo design"≈"logo")
→ Swap description to Y, keep same rate/qty unless new amount specified
→ changedFields = ["lineItems"]
→ If X not found: changedFields=[], warning="Item not found"

TAX/GST change:
• INR invoice: update gstPercent/gstType, changedFields=["gstPercent","gstType"]
• USD invoice: update taxPercent/taxAmount/taxLabel, changedFields=["taxPercent","taxAmount"]
• EUR invoice: update taxPercent/taxAmount/taxLabel, changedFields=["taxPercent","taxAmount"]

OTHER:
→ "change payment terms to 30 days" → paymentTermsDays=30, changedFields=["paymentTermsDays"]
→ "apply 10% discount" → discountType="percent", discountValue=10, changedFields=["discountType","discountValue"]
→ "add 2% late fee" → append line item: description="Late Fee (2%)", qty=1, unit="item", rate=round(subtotal×0.02), changedFields=["lineItems"]
→ "change date to 1st May" → invoiceDate="2026-05-01", invoiceMonth="May 2026", changedFields=["invoiceDate","invoiceMonth"]

STRICT SAFETY:
→ NEVER change clientName unless explicitly asked
→ NEVER change currency unless explicitly asked
→ NEVER change invoiceMonth unless explicitly asked
→ NEVER invent line items
→ changedFields = ONLY what changed

RECALCULATE after edit:
1. subtotal = sum of lineItem amounts
2. discountAmount = percent→round(subtotal×val/100) | amount→val | none→0
3. taxableAmount = subtotal − discountAmount
4. INR: gstAmount = round(taxableAmount × gstPercent / 100), CGST_SGST or IGST split
   USD/EUR: taxAmount = round(taxableAmount × taxPercent / 100)
5. total = taxableAmount + gstAmount (INR) or taxableAmount + taxAmount (USD/EUR)`;

export const COPIER_PROMPT = `You are copying an existing invoice for a new client.

━━━ SOURCE INVOICE TO COPY ━━━
{sourceBlock}

━━━ NEW CLIENT ━━━
clientName = "{newClientName}"

━━━ ADDITIONAL CHANGES REQUESTED ━━━
{overrides}

━━━ COPY RULES ━━━
• Copy line items, quantities, rates, amounts EXACTLY from source — do NOT change amounts
• Copy gstPercent, gstType, taxPercent, taxLabel, paymentTermsDays, currency EXACTLY from source
• If source has no tax → set taxPercent=0, gstPercent=0
• Set clientName = "{newClientName}"
• Set invoiceDate = {currentDate}
• Set invoiceMonth = {currentMonth}
• Do NOT copy the invoice number
• Apply ADDITIONAL CHANGES from the section above AFTER copying
• Recalculate totals after any changes`;

export const MULTI_INVOICE_PROMPT = `You are creating invoice #{index} of {total} in a batch.

━━━ BASE REQUEST ━━━
{basePrompt}

━━━ THIS INVOICE ONLY ━━━
invoiceMonth = "{invoiceMonth}"
invoiceDate = "{invoiceDate}"
clientName = "{clientName}"
currency = "{currency}"

━━━ RULES ━━━
• Create ONE line item for the service described in the base request
• The line item amount = the per-month amount stated in the base request
• Use EXACTLY invoiceMonth, invoiceDate, and currency as given above — never change them
• Use the same tax%, payment terms, and description as the base request
• For INR: use gstPercent from base request, set taxPercent=0
• For USD/EUR: use taxPercent from base request, set gstPercent=0, taxLabel="Tax" or "VAT"
• Do NOT combine months — this invoice is for {invoiceMonth} ONLY
• Do NOT copy from previous invoices in the batch — parse fresh from base request

EXAMPLE (INR):
Base: "web maintenance ₹15,000/month for 6 months with 18% GST"
→ currency="INR", gstPercent=18, subtotal=15000, gstAmount=2700, taxPercent=0, taxAmount=0, total=17700

EXAMPLE (USD with tax):
Base: "web maintenance $2,000/month for 3 months with 10% tax"
→ currency="USD", gstPercent=0, gstAmount=0, taxPercent=10, taxAmount=200, taxLabel="Tax", subtotal=2000, total=2200

EXAMPLE (USD no tax):
Base: "web maintenance $2,000/month for 3 months"
→ currency="USD", gstPercent=0, gstAmount=0, taxPercent=0, taxAmount=0, subtotal=2000, total=2000`;

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

2. "X months" / "for X months" without specific months:
   → Start from current month ({currentMonth})
   → count = X consecutive months

3. "Q1" = January, February, March | "Q2" = April, May, June
   "Q3" = July, August, September | "Q4" = October, November, December

EXAMPLES:

Prompt: "Invoice Rahul ₹45,000 for Jan, Feb, March with 18% GST"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice Rahul for services ₹45,000 with 18% GST for January 2026, payment terms 15 days",
    "Invoice Rahul for services ₹45,000 with 18% GST for February 2026, payment terms 15 days",
    "Invoice Rahul for services ₹45,000 with 18% GST for March 2026, payment terms 15 days"
  ]

Prompt: "Invoice John $2,000/month for 3 months with 10% tax"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice John for services $2,000 with 10% tax for May 2026, payment terms 15 days",
    "Invoice John for services $2,000 with 10% tax for June 2026, payment terms 15 days",
    "Invoice John for services $2,000 with 10% tax for July 2026, payment terms 15 days"
  ]

Prompt: "Invoice John $2,000/month for 3 months"
→ isMultiple: true, count: 3
→ subPrompts: [
    "Invoice John for services $2,000 no tax for May 2026, payment terms 15 days",
    "Invoice John for services $2,000 no tax for June 2026, payment terms 15 days",
    "Invoice John for services $2,000 no tax for July 2026, payment terms 15 days"
  ]

Prompt: "Create monthly invoice for Priya for web maintenance ₹15,000/month for 2 months"
→ isMultiple: true, count: 2
→ subPrompts: [
    "Invoice Priya for web maintenance ₹15,000 with 18% GST for May 2026, payment terms 15 days",
    "Invoice Priya for web maintenance ₹15,000 with 18% GST for June 2026, payment terms 15 days"
  ]

Prompt: "Invoice Rahul for logo design ₹20,000, brand guidelines ₹15,000, 3 revisions ₹5,000"
→ isMultiple: false, count: 1, subPrompts: []

Prompt: "Invoice Rahul ₹50,000 and Priya ₹30,000 for development"
→ isMultiple: true, count: 2
→ subPrompts: [
    "Invoice Rahul for development ₹50,000 with 18% GST, payment terms 15 days",
    "Invoice Priya for development ₹30,000 with 18% GST, payment terms 15 days"
  ]

Original prompt: {prompt}`;
