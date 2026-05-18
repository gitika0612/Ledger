import { z } from "zod";

export const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  rate: z.number().min(0),
  amount: z.number().min(0),
  hsnSacCode: z
    .string()
    .describe(
      "SAC code for services, HSN for goods. " +
        "Common SAC: 998314=software dev, 998312=web design, " +
        "998313=IT consulting, 998315=data processing, 998319=other IT"
    ),
  hsnSacType: z.enum(["HSN", "SAC"]).describe("HSN=goods, SAC=services"),
});

export const invoiceSchema = z.object({
  intent: z.enum(["new", "edit", "copy"]),
  targetInvoiceRef: z.string(),
  clientName: z.string(),
  lineItems: z.array(lineItemSchema),
  gstPercent: z.number().min(0),
  gstType: z.enum(["IGST", "CGST_SGST"]),
  discountType: z.enum(["percent", "amount", "none"]),
  discountValue: z.number().min(0),
  notes: z.string(),
  subtotal: z.number().min(0),
  discountAmount: z.number().min(0),
  taxableAmount: z.number().min(0),
  gstAmount: z.number().min(0),
  cgstAmount: z.number().min(0),
  sgstAmount: z.number().min(0),
  igstAmount: z.number().min(0),
  total: z.number().min(0),
  paymentTermsDays: z.number().min(0),
  invoiceDate: z.string(),
  invoiceMonth: z.string(),
  changedFields: z.array(z.string()),
  warning: z.string(),
});

export const multiInvoiceSchema = z.object({
  isMultiple: z.boolean(),
  count: z.number(),
  subPrompts: z.array(z.string()),
});

export type ParsedInvoice = z.infer<typeof invoiceSchema>;
export type MultiInvoiceDetection = z.infer<typeof multiInvoiceSchema>;
