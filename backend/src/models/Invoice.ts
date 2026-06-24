import mongoose, { Document, Schema } from "mongoose";

export interface ILineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  hsnSacCode?: string;
  hsnSacType?: "HSN" | "SAC";
}

export interface IInvoiceDocument extends Document {
  userId: string;
  invoiceNumber: string;
  clientId?: string;
  clientName: string;
  lineItems: ILineItem[];
  paymentTermsDays: number;
  gstPercent: number;
  gstType: "IGST" | "CGST_SGST";
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  gstAmount: number;
  taxPercent?: number;
  taxAmount?: number;
  taxLabel?: string;
  discountType: "percent" | "amount" | "none";
  discountValue: number;
  discountAmount: number;
  notes: string;
  subtotal: number;
  taxableAmount: number;
  total: number;
  isTaxInclusive?: boolean;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  createdVia: "chat" | "template" | "memory";
  originalPrompt?: string;
  invoiceDate: Date;
  invoiceMonth: string;
  dueDate: Date;
  currency?: "INR" | "USD" | "EUR";
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new Schema<ILineItem>({
  description: { type: String, default: "" },
  quantity: { type: Number, default: 1 },
  unit: { type: String, default: "items" },
  rate: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  hsnSacCode: { type: String, default: "" },
  hsnSacType: { type: String, enum: ["HSN", "SAC"], default: "SAC" },
});

const invoiceSchema = new Schema<IInvoiceDocument>(
  {
    userId: { type: String, required: true, index: true },
    invoiceNumber: { type: String, required: true, unique: true },
    clientId: { type: String, default: "" },
    clientName: { type: String, required: true, trim: true },
    lineItems: { type: [lineItemSchema], default: [] },
    paymentTermsDays: { type: Number, default: 15 },
    // ── INR GST fields ──
    gstPercent: { type: Number, default: 0 },
    gstType: {
      type: String,
      enum: ["IGST", "CGST_SGST"],
      default: "CGST_SGST",
    },
    cgstPercent: { type: Number, default: 0 },
    sgstPercent: { type: Number, default: 0 },
    igstPercent: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    // ── USD/EUR Tax fields ──
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    taxLabel: { type: String, default: "" },
    // ── Common ──
    discountType: {
      type: String,
      enum: ["percent", "amount", "none"],
      default: "none",
    },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    subtotal: { type: Number, required: true },
    taxableAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    // ── Tax-inclusive flag ──
    isTaxInclusive: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["draft", "confirmed", "sent", "paid", "overdue"],
      default: "draft",
    },
    createdVia: {
      type: String,
      enum: ["chat", "template", "memory"],
      default: "chat",
    },
    originalPrompt: { type: String, default: "" },
    invoiceDate: { type: Date, default: () => new Date() },
    invoiceMonth: { type: String, default: "" },
    dueDate: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
    currency: {
      type: String,
      enum: ["INR", "USD", "EUR"],
      default: "INR",
    },
    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
  },
  { timestamps: true }
);

// ── Indexes ──
invoiceSchema.index({ userId: 1, clientName: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, clientId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, invoiceMonth: 1 });

export const Invoice = mongoose.model<IInvoiceDocument>(
  "Invoice",
  invoiceSchema
);
