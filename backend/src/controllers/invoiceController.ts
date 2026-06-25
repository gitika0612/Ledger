/// <reference types="node" />
import { Request, Response } from "express";
import { Invoice } from "../models/Invoice";
import { generateInvoiceNumber } from "../lib/invoiceHelper";
import { runInvoiceAgent } from "../agents/invoiceAgent";
import { runScheduledReminders } from "../lib/reminderService";

// ── Parse invoice (main AI endpoint) ──
export async function parseInvoice(req: Request, res: Response): Promise<void> {
  const {
    prompt,
    userId,
    sessionContext,
    memoryContext,
    currentInvoice,
    pendingState,
  } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
    res
      .status(400)
      .json({ error: "Please provide a valid invoice description" });
    return;
  }

  try {
    console.log(`🤖 Agent: "${prompt.slice(0, 80)}"`);

    const result = await runInvoiceAgent({
      prompt,
      userId: userId || "",
      sessionId: "",
      sessionContext: sessionContext || "No existing invoices in this session.",
      parsedInvoice: currentInvoice || null,
      pendingState: pendingState || null,
    });

    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }

    const agentResult = result.agentResult;
    if (!agentResult) {
      res.status(500).json({ error: "Agent returned no result" });
      return;
    }

    console.log(
      `✅ Agent action: ${agentResult.action} | ${
        agentResult.invoice?.clientName ||
        agentResult.invoices?.length + " invoices" ||
        ""
      }`
    );

    res.status(200).json({ success: true, ...agentResult });
  } catch (err) {
    console.error("❌ Agent failed:", err);
    res
      .status(500)
      .json({ error: "Failed to parse invoice. Please try again." });
  }
}

// ── Save draft invoice ──
export async function saveDraftInvoice(
  req: Request,
  res: Response
): Promise<void> {
  const {
    userId,
    clientName,
    clientId,
    currency,
    lineItems,
    paymentTermsDays,
    // INR GST fields
    gstPercent,
    gstType,
    cgstPercent,
    sgstPercent,
    igstPercent,
    cgstAmount,
    sgstAmount,
    igstAmount,
    gstAmount,
    // USD/EUR Tax fields
    taxPercent,
    taxAmount,
    taxLabel,
    // Common
    discountType,
    discountValue,
    discountAmount,
    notes,
    subtotal,
    taxableAmount,
    total,
    isTaxInclusive,
    originalPrompt,
    invoiceDate,
    invoiceMonth,
    idempotencyKey,
  } = req.body;

  if (!userId || !clientName || !total) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    if (idempotencyKey) {
      const existing = await Invoice.findOne({ userId, idempotencyKey });
      if (existing) {
        console.log(
          `⚠️ Idempotent — returning existing: ${existing.invoiceNumber}`
        );
        res
          .status(200)
          .json({ success: true, invoice: existing, isDuplicate: true });
        return;
      }
    }

    const invoiceNumber = await generateInvoiceNumber();
    const terms = paymentTermsDays || 15;
    const resolvedInvoiceDate =
      invoiceDate && invoiceDate !== "" ? new Date(invoiceDate) : new Date();
    const resolvedDueDate = new Date(
      resolvedInvoiceDate.getTime() + terms * 24 * 60 * 60 * 1000
    );
    const monthYearRegex = /^[A-Za-z]+ \d{4}$/;
    const resolvedInvoiceMonth =
      invoiceMonth && monthYearRegex.test(invoiceMonth.trim())
        ? invoiceMonth.trim()
        : resolvedInvoiceDate.toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          });

    const similar = await Invoice.findOne({
      userId,
      clientName,
      invoiceMonth: resolvedInvoiceMonth,
      $or: [{ status: "confirmed" }, { isConfirmed: true }],
    });

    const resolvedCurrency = currency || "INR";
    const isINR = resolvedCurrency === "INR";

    const invoice = await Invoice.create({
      userId,
      invoiceNumber,
      clientName,
      clientId: clientId || "",
      currency: resolvedCurrency,
      lineItems: lineItems || [],
      paymentTermsDays: terms,
      // INR GST fields — only meaningful when currency=INR
      gstPercent: isINR
        ? gstPercent !== undefined && gstPercent !== null
          ? Number(gstPercent)
          : 0
        : 0,
      gstType: gstType || "CGST_SGST",
      cgstPercent: isINR
        ? cgstPercent !== undefined && cgstPercent !== null
          ? Number(cgstPercent)
          : 0
        : 0,
      sgstPercent: isINR
        ? sgstPercent !== undefined && sgstPercent !== null
          ? Number(sgstPercent)
          : 0
        : 0,
      igstPercent: isINR ? igstPercent || 0 : 0,
      cgstAmount: isINR ? cgstAmount || 0 : 0,
      sgstAmount: isINR ? sgstAmount || 0 : 0,
      igstAmount: isINR ? igstAmount || 0 : 0,
      gstAmount: isINR ? gstAmount || 0 : 0,
      // USD/EUR Tax fields — only meaningful when currency=USD/EUR
      taxPercent: !isINR ? taxPercent || 0 : 0,
      taxAmount: !isINR ? taxAmount || 0 : 0,
      taxLabel: !isINR
        ? taxLabel || (resolvedCurrency === "EUR" ? "VAT" : "Tax")
        : "",
      // Common
      discountType: discountType || "none",
      discountValue: discountValue || 0,
      discountAmount: discountAmount || 0,
      notes: notes || "",
      subtotal,
      taxableAmount: taxableAmount || subtotal,
      total,
      isTaxInclusive: isTaxInclusive || false,
      status: "draft",
      createdVia: "chat",
      originalPrompt: originalPrompt || "",
      invoiceDate: resolvedInvoiceDate,
      invoiceMonth: resolvedInvoiceMonth,
      dueDate: resolvedDueDate,
      idempotencyKey: idempotencyKey || null,
    });

    console.log(`✅ Draft saved: ${invoiceNumber} for ${clientName}`);

    res.status(201).json({
      success: true,
      invoice,
      hasSimilar: !!similar,
      similarInvoice: similar
        ? {
            invoiceNumber: similar.invoiceNumber,
            total: similar.total,
            invoiceMonth: similar.invoiceMonth,
          }
        : null,
    });
  } catch (err) {
    console.error("❌ Save draft error:", err);
    res.status(500).json({ error: "Failed to save draft invoice" });
  }
}

// ── Confirm invoice ──
export async function confirmInvoice(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  try {
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    const updated = await Invoice.findByIdAndUpdate(
      id,
      { status: "confirmed" },
      { new: true }
    );
    console.log(`✅ Confirmed: ${updated?.invoiceNumber}`);
    res.status(200).json({ success: true, invoice: updated });
  } catch (err) {
    console.error("❌ Confirm error:", err);
    res.status(500).json({ error: "Failed to confirm invoice" });
  }
}

// ── Get all invoices ──
export async function getUserInvoices(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.headers["x-clerk-id"] as string;
  if (!userId) {
    res.status(400).json({ error: "Missing user ID" });
    return;
  }
  try {
    const invoices = await Invoice.find({ userId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, invoices });
  } catch (err) {
    console.error("❌ Get invoices error:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
}

// ── Update invoice ──
export async function updateInvoice(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  try {
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid") {
      res.status(403).json({ error: "Paid invoices cannot be edited" });
      return;
    }

    if (invoice.status === "sent" || invoice.status === "overdue") {
      const updated = await Invoice.findByIdAndUpdate(
        id,
        {
          ...(req.body.dueDate && { dueDate: req.body.dueDate }),
          ...(req.body.status && { status: req.body.status }),
        },
        { new: true }
      );
      res.status(200).json({ success: true, invoice: updated });
      return;
    }

    const updated = await Invoice.findByIdAndUpdate(
      id,
      {
        clientName: req.body.clientName,
        currency: req.body.currency,
        lineItems: req.body.lineItems,
        paymentTermsDays: req.body.paymentTermsDays,
        // INR GST fields
        gstPercent: req.body.gstPercent,
        gstType: req.body.gstType,
        cgstPercent: req.body.cgstPercent,
        sgstPercent: req.body.sgstPercent,
        igstPercent: req.body.igstPercent,
        cgstAmount: req.body.cgstAmount,
        sgstAmount: req.body.sgstAmount,
        igstAmount: req.body.igstAmount,
        gstAmount: req.body.gstAmount,
        // USD/EUR Tax fields
        taxPercent: req.body.taxPercent,
        taxAmount: req.body.taxAmount,
        taxLabel: req.body.taxLabel,
        // Common
        discountType: req.body.discountType,
        discountValue: req.body.discountValue,
        discountAmount: req.body.discountAmount,
        notes: req.body.notes,
        subtotal: req.body.subtotal,
        taxableAmount: req.body.taxableAmount,
        total: req.body.total,
        invoiceDate: req.body.invoiceDate,
        invoiceMonth: req.body.invoiceMonth,
        dueDate: req.body.dueDate,
        status: req.body.status,
      },
      { new: true }
    );
    console.log(`✅ Updated: ${updated?.invoiceNumber}`);
    res.status(200).json({ success: true, invoice: updated });
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).json({ error: "Failed to update invoice" });
  }
}

// ── Get client invoice history ──
export async function getClientHistory(
  req: Request,
  res: Response
): Promise<void> {
  const { clientName } = req.params;
  const userId = req.headers["x-clerk-id"] as string;
  if (!userId || !clientName) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  try {
    let invoices = await Invoice.find({
      userId,
      clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
      status: "confirmed",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    if (invoices.length === 0) {
      invoices = await Invoice.find({
        userId,
        clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    }
    res.status(200).json({ success: true, invoices });
  } catch (err) {
    console.error("❌ Client history error:", err);
    res.status(500).json({ error: "Failed to fetch client history" });
  }
}

// ── Dashboard stats ──
export async function getDashboardStats(
  req: Request,
  res: Response
): Promise<void> {
  const clerkId = req.headers["x-clerk-id"] as string;
  if (!clerkId) {
    res.status(400).json({ error: "Missing clerk ID" });
    return;
  }
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [
      totalInvoices,
      pendingAmount,
      paidThisMonth,
      overdueCount,
      recentInvoices,
    ] = await Promise.all([
      Invoice.countDocuments({ userId: clerkId }),
      Invoice.aggregate([
        {
          $match: {
            userId: clerkId,
            status: { $in: ["draft", "confirmed", "sent"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Invoice.aggregate([
        {
          $match: {
            userId: clerkId,
            status: "paid",
            updatedAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Invoice.countDocuments({ userId: clerkId, status: "overdue" }),
      Invoice.find({ userId: clerkId }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    res.status(200).json({
      success: true,
      stats: {
        totalInvoices,
        pendingAmount: pendingAmount[0]?.total || 0,
        paidThisMonth: paidThisMonth[0]?.total || 0,
        overdueCount,
      },
      recentInvoices,
    });
  } catch (err) {
    console.error("❌ Dashboard stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
}

// ── Delete invoice ──
export async function removeInvoice(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  try {
    const invoice = await Invoice.findByIdAndDelete(id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    console.log(`✅ Deleted: ${invoice.invoiceNumber}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
}

// ── Get invoice by ID ──
export async function getInvoiceById(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  try {
    const invoice = await Invoice.findById(id).lean();
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.status(200).json({
      success: true,
      invoice: { ...invoice, invoiceNumber: invoice.invoiceNumber || null },
    });
  } catch (err) {
    console.error("❌ Get invoice error:", err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
}

export async function getLatestClientInvoice(req: Request, res: Response) {
  const { clientName } = req.params;
  const { userId } = req.query;

  const invoice = await Invoice.findOne({
    userId,
    clientName: { $regex: new RegExp(`^${clientName}$`, "i") },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!invoice) return res.status(404).json({ error: "Not found" });
  res.json(invoice);
}

// ── Send overdue reminders (called by Render Cron Job) ──
// Single cron job runs every hour (0 * * * *).
// reminderService auto-detects which currencies are at 10 AM right now
// based on CURRENCY_TIMEZONES map — no currency param needed.
// Adding a new currency in future = 1 line in CURRENCY_TIMEZONES map.
export async function sendOverdueReminders(
  req: Request,
  res: Response
): Promise<void> {
  // ── Auth check ──
  const secret = req.query.secret as string;
  if (!secret || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.log("🕐 Cron triggered: sendOverdueReminders");

  try {
    const result = await runScheduledReminders();
    console.log("✅ Reminders done:", result);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("❌ Reminder cron error:", err);
    res.status(500).json({ error: "Failed to process reminders" });
  }
}
