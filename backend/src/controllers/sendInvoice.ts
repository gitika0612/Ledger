import { Request, Response } from "express";
import { Invoice } from "../models/Invoice";
import { User } from "../models/User";
import { Client } from "../models/Client";
import { sendInvoiceEmail } from "../lib/emailService";

export async function sendInvoice(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { pdfBase64, clientEmail: providedEmail } = req.body;

  if (!pdfBase64) {
    res.status(400).json({ error: "Missing PDF data" });
    return;
  }

  try {
    // ── 1. Fetch and validate invoice ──
    const invoice = await Invoice.findById(id).lean();
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status !== "confirmed") {
      res.status(400).json({ error: "Only confirmed invoices can be sent" });
      return;
    }

    // ── 2. Get sender profile ──
    const user = await User.findOne({ clerkId: invoice.userId }).lean();
    const fromName = user?.businessName?.trim() || "";

    if (!fromName) {
      res.status(400).json({
        error: "no_profile",
        message:
          "Your company name isn't set up. Go to Profile Settings to add it before sending.",
      });
      return;
    }

    // ── 3. Resolve client email ──
    // Priority: user typed one in the modal → stored client record → search by name
    let clientEmail = providedEmail?.trim() || "";

    if (!clientEmail && invoice.clientId) {
      const client = await Client.findById(invoice.clientId).lean();
      clientEmail = client?.email?.trim() || "";
    }

    if (!clientEmail) {
      const client = await Client.findOne({
        userId: invoice.userId,
        name: { $regex: new RegExp(`^${invoice.clientName}$`, "i") },
      }).lean();
      clientEmail = client?.email?.trim() || "";
    }

    if (!clientEmail) {
      res.status(400).json({
        error: "no_email",
        message: `No email on file for ${invoice.clientName}. Please provide one to send this invoice.`,
      });
      return;
    }

    // ── 4. If user provided a new email → upsert into Client record ──
    if (providedEmail?.trim()) {
      await Client.findOneAndUpdate(
        {
          userId: invoice.userId,
          name: { $regex: new RegExp(`^${invoice.clientName}$`, "i") },
        },
        {
          $set: { email: providedEmail.trim().toLowerCase() },
          $setOnInsert: { userId: invoice.userId, name: invoice.clientName },
        },
        { upsert: true, new: true }
      );
    }

    // ── 5. Convert base64 → Buffer and send email ──
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    await sendInvoiceEmail({
      toEmail: clientEmail,
      toName: invoice.clientName,
      fromName,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      dueDate: invoice.dueDate,
      pdfBuffer,
    });

    // ── 6. Update invoice status ──
    await Invoice.findByIdAndUpdate(id, { status: "sent" });

    console.log(
      `✅ Invoice ${invoice.invoiceNumber} sent to ${clientEmail} by ${fromName}`
    );

    res.status(200).json({
      success: true,
      sentTo: clientEmail,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (err) {
    console.error("❌ Send invoice error:", err);
    res
      .status(500)
      .json({ error: "Failed to send invoice. Please try again." });
  }
}
