import { Invoice } from "../models/Invoice";
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter =
  mongoose.models["Counter"] || mongoose.model("Counter", counterSchema);

// ── Per-user invoice numbering ──
// Each user has their own INV-<year>-<seq> sequence, tracked by a Counter
// document scoped to `invoices_${userId}_${year}`. The first time we
// generate a number for a given user+year, we lazily seed the counter from
// that user's own existing invoices (never another user's), then increment
// normally on every call after that.
export async function generateInvoiceNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const counterId = `invoices_${userId}_${year}`;

  const existing = await Counter.findById(counterId).lean();
  if (!existing) {
    await seedCounterFromExistingInvoices(userId, year, counterId);
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const number = String(counter.seq).padStart(3, "0");
  return `INV-${year}-${number}`;
}

async function seedCounterFromExistingInvoices(
  userId: string,
  year: number,
  counterId: string
): Promise<void> {
  const prefix = `INV-${year}-`;

  try {
    // Find this user's highest existing invoice number this year — scoped
    // strictly to userId so one user's history never bleeds into another's.
    const latest = await Invoice.findOne({
      userId,
      invoiceNumber: { $regex: `^${prefix}` },
    })
      .sort({ invoiceNumber: -1 })
      .lean();

    const currentMax = latest
      ? parseInt(latest.invoiceNumber.split("-")[2]) || 0
      : 0;

    // ── Use $max to safely set counter — never decrements ──
    await Counter.findOneAndUpdate(
      { _id: counterId },
      { $max: { seq: currentMax } }, // only updates if currentMax > existing seq
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err: any) {
    // If duplicate key on counter itself — it already exists, that's fine
    if (err.code === 11000) {
      return;
    }
    console.error(
      `❌ Failed to seed invoice counter for ${counterId}:`,
      err.message
    );
  }
}
