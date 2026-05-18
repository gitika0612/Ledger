# Ledger — AI-Native Invoicing for Indian Freelancers

> Create professional GST-compliant invoices in seconds. Just describe the work — Ledger handles the rest.

**Live demo →** [invoice-os-sigma.vercel.app](https://invoice-os-sigma.vercel.app)

---

## What is Ledger?

Ledger is a conversational invoicing platform built for India's freelancers and small businesses. Instead of filling forms, you describe your invoice in plain language and the AI creates it instantly — with correct GST splits, client details, line items, and totals.

```
"Invoice Priya for 5 days of Next.js work at ₹10k/day with 18% GST"
```

That's all it takes. Ledger parses the prompt, calculates CGST + SGST, saves Priya's details, and puts a ready-to-confirm invoice in the panel.

---

## Features

### AI invoice creation
- Natural language prompts → structured invoices in ~4 seconds
- Supports: simple invoices, multiple line items, GST variations (0%, 5%, 12%, 18%, 28%), CGST/SGST/IGST, discounts (% or fixed), milestones, advances, retainers, pro-rata billing, credit notes
- Multi-invoice batch creation ("Invoice Rahul for Jan, Feb, March")
- Split invoices ("Split Ankit's ₹1L invoice into 2 parts")
- Copy invoices for new clients ("Same as last one but for Kartik")
- Edit via chat ("Add 18% GST to last invoice")
- Live currency conversion (USD, GBP, EUR, AED, SGD → INR)

### GST-compliant by default
- Automatic CGST + SGST or IGST based on transaction type
- GST-inclusive back-calculation ("₹1,18,000 inclusive of 18% GST")
- HSN/SAC codes per line item
- All amounts calculated deterministically on the backend — the AI interprets, the math is always correct

### Client memory
- Client details (email, address, city, state, pincode, GSTIN) saved on first invoice
- Auto-populated on all future invoices for the same client
- Fuzzy matching — "Rahul" matches existing "Rahul Sharma" record

### Invoice lifecycle
`Draft → Confirmed → Sent → Paid`
- In-chat editing via the right panel
- Download PDF at any stage
- Send via email directly from the app
- All invoices searchable, filterable, sortable

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Auth | Clerk |
| AI agent | LangGraph (LangChain), GPT-4o-mini |
| Backend | Node.js, Express |
| Database | MongoDB (Mongoose) |
| Vector search | MongoDB Atlas embeddings (invoice RAG) |
| Deployment | Vercel (frontend), Railway (backend) |

---

## Architecture

```
User prompt
    │
    ▼
Router node          — classifies intent: new / edit / copy / multi / split
    │
    ├── RAG node     — fetches past invoices for this client (vector search)
    │
    ├── Generator    — creates new invoice from prompt + memory context
    ├── Editor       — applies targeted changes to existing invoice
    ├── Copier       — duplicates invoice for a new client
    └── Multi        — batch-creates invoices across months
    │
    ▼
Structured output    — Zod-validated invoice JSON
    │
    ▼
Frontend             — renders in chat panel, saves draft to MongoDB
```

---

## Project structure

```
InvoiceOS/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── invoiceAgent.ts       # LangGraph graph definition
│   │   │   ├── nodes/
│   │   │   │   ├── routerNode.ts
│   │   │   │   ├── ragNode.ts
│   │   │   │   ├── generatorNode.ts
│   │   │   │   ├── editorNode.ts
│   │   │   │   ├── copierNode.ts
│   │   │   │   └── multiInvoiceNode.ts
│   │   │   ├── prompts/
│   │   │   │   └── invoicePrompt.ts
│   │   │   ├── schemas/
│   │   │   │   └── invoiceSchema.ts
│   │   │   └── utils/
│   │   │       ├── invoiceUtils.ts
│   │   │       └── currencyService.ts
│   │   ├── controllers/
│   │   │   ├── invoiceController.ts
│   │   │   ├── clientController.ts
│   │   │   ├── chatController.ts
│   │   │   └── userController.ts
│   │   ├── models/
│   │   │   ├── Invoice.ts
│   │   │   ├── Client.ts
│   │   │   ├── ChatSession.ts
│   │   │   ├── ChatMessage.ts
│   │   │   └── User.ts
│   │   └── lib/
│   │       ├── embeddingService.ts   # Vector search for invoice RAG
│   │       ├── clientMatcher.ts
│   │       └── emailService.ts
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   └── invoice/
    │   │       ├── InvoicePanel.tsx          # Session invoice sidebar
    │   │       ├── InvoicePreviewCard.tsx    # Live invoice preview + edit
    │   │       └── modals/
    │   │           ├── EditInvoiceModal.tsx
    │   │           └── SendInvoiceModal.tsx
    │   ├── hooks/
    │   │   └── useInvoiceChat.ts     # Main orchestrator — all chat logic
    │   ├── lib/
    │   │   ├── api/
    │   │   │   ├── invoiceApi.ts
    │   │   │   ├── clientApi.ts
    │   │   │   └── chatApi.ts
    │   │   └── invoice-chat/
    │   │       ├── sessionHelpers.ts
    │   │       ├── invoiceHelpers.ts
    │   │       └── messageHelpers.ts
    │   └── pages/
    │       ├── Dashboard.tsx
    │       ├── CreateInvoice.tsx
    │       ├── AllInvoices.tsx
    │       └── InvoiceViewPage.tsx
    └── package.json
```

---

## Getting started

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (with Vector Search enabled)
- OpenAI API key
- Clerk account

### Clone and install

```bash
git clone https://github.com/gitika0612/InvoiceOS.git
cd InvoiceOS

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### Environment variables

**Backend** (`backend/.env`):
```env
MONGODB_URI=your_mongodb_connection_string
OPENAI_API_KEY=your_openai_api_key
CLERK_WEBHOOK_SECRET=your_clerk_webhook_secret
PORT=4000
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:4000/api
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

### Run locally

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:4000`.

---

## Prompt examples

```
# Simple invoice
"Invoice Priya for 5 days of Next.js at ₹10k/day with 18% GST"

# No GST
"Bill Rahul ₹25,000 for logo design, no GST"

# Milestone billing
"Milestone 1 of 3 for Ankit, total project ₹3 lakh"

# Multi-invoice batch
"Invoice Kartik ₹45,000 for Jan, Feb, March with 18% GST"

# Edit via chat
"Add brand strategy ₹10,000 to Rahul's invoice"

# Copy for new client
"Same invoice as Priya's but for Meera"

# Split invoice
"Split Ankit's ₹1,00,000 invoice into 2 equal parts"

# GST-inclusive
"₹1,18,000 inclusive of 18% GST for Siddharth"

# Currency conversion
"Invoice John $2,000 for consulting"
```

---

## Roadmap

- [x] AI invoice creation via chat
- [x] GST-compliant calculations (CGST/SGST/IGST)
- [x] Client memory and auto-fill
- [x] Multi-invoice batch creation
- [x] PDF download
- [x] Email sending
- [ ] UPI payment link generation
- [ ] Automatic payment reminders
- [ ] Monthly income summary and revenue insights
- [ ] GST return preparation assistance
- [ ] Multi-user support (agencies and studios)

---

Built with the belief that invoicing should feel as natural as describing your work.
