import { Invoice } from "../models/Invoice";
import { Client } from "../models/Client";
import { User } from "../models/User";
import { sendReminderEmail } from "../lib/emailService";

// ── Reminder schedule ──
// Day 1 → gentle nudge
// Day 3 → friendly follow-up
// Day 7 → final notice
const REMINDER_DAYS = [1, 3, 7] as const;
type ReminderDay = (typeof REMINDER_DAYS)[number];

// ── Currency → timezone mapping ──
// Adding a new currency in future = 1 line here.
// Cron runs every hour and auto-detects which currencies are at 10 AM.
const CURRENCY_TIMEZONES: Record<string, string> = {
  INR: "Asia/Kolkata", // UTC+5:30 — India
  USD: "America/New_York", // UTC-5    — USA (EST)
  EUR: "Europe/Paris", // UTC+1    — Central Europe (CET)
};

// ── Which currencies are at 10 AM right now? ──
// Called every hour by the cron job.
// Returns e.g. ["INR"] at 4:30 AM UTC, ["EUR"] at 9:00 AM UTC, ["USD"] at 3:00 PM UTC.
export function getCurrenciesAt10AM(): string[] {
  const now = new Date();
  return Object.entries(CURRENCY_TIMEZONES)
    .filter(([_, tz]) => {
      const hour = parseInt(
        now.toLocaleString("en-US", {
          timeZone: tz,
          hour: "numeric",
          hour12: false,
        })
      );
      return hour === 10;
    })
    .map(([currency]) => currency);
}

// ── Which reminder number is this? ──
// day 1 → reminderNumber 1
// day 3 → reminderNumber 2
// day 7 → reminderNumber 3
function getReminderNumber(day: ReminderDay): 1 | 2 | 3 {
  const map: Record<ReminderDay, 1 | 2 | 3> = { 1: 1, 3: 2, 7: 3 };
  return map[day];
}

// ── Calculate how many days overdue an invoice is ──
function getDaysOverdue(dueDate: Date): number {
  const now = new Date();
  const due = new Date(dueDate);

  // Compare dates only (ignore time) to avoid timezone edge cases
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffMs = now.getTime() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ── Find all invoices that need a reminder for a given currency ──
// Conditions:
// - status is "sent" or "overdue" (not draft/confirmed/paid)
// - dueDate is in the past
// - not all 3 reminders sent yet
// - currency matches what's being processed
async function findInvoicesNeedingReminder(currency: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Invoice.find({
    status: { $in: ["sent", "overdue"] },
    dueDate: { $lt: today },
    currency,
    // Only fetch invoices that haven't had all 3 reminders sent yet
    // $ifNull handles existing invoices created before remindersSent was added
    $expr: { $lt: [{ $size: { $ifNull: ["$remindersSent", []] } }, 3] },
  }).lean();
}

// ── Process reminders for one currency ──
async function processReminders(
  currency: string
): Promise<{ sent: number; skipped: number; errors: number }> {
  console.log(`🕐 processReminders started for currency: ${currency}`);

  const invoices = await findInvoicesNeedingReminder(currency);
  console.log(`📋 Found ${invoices.length} invoices to check for ${currency}`);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const invoice of invoices) {
    try {
      const daysOverdue = getDaysOverdue(invoice.dueDate);

      // ── Find which reminder to send today ──
      // Check each reminder day in order (1, 3, 7)
      // Send the first one that is due and hasn't been sent yet
      const reminderDayToSend = REMINDER_DAYS.find(
        (day) => daysOverdue >= day && !invoice.remindersSent.includes(day)
      );

      if (!reminderDayToSend) {
        // Already sent all due reminders — nothing to do today
        skipped++;
        continue;
      }

      // ── Fetch client email ──
      const client = await Client.findOne({
        userId: invoice.userId,
        name: { $regex: new RegExp(`^${invoice.clientName}$`, "i") },
      }).lean();

      if (!client?.email) {
        console.warn(
          `⚠️ No email for client ${invoice.clientName} — skipping invoice ${invoice.invoiceNumber}`
        );
        skipped++;
        continue;
      }

      // ── Fetch sender name from User model ──
      const user = await User.findOne({ clerkId: invoice.userId }).lean();
      const fromName =
        user?.businessName ||
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        "Ledger User";

      // ── Send the reminder email ──
      await sendReminderEmail({
        toEmail: client.email,
        toName: client.name,
        fromName,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
        invoiceId: String(invoice._id),
        currency: invoice.currency,
        reminderNumber: getReminderNumber(reminderDayToSend),
        daysOverdue,
      });

      // ── Update invoice: mark reminder as sent ──
      await Invoice.updateOne(
        { _id: invoice._id },
        {
          $push: { remindersSent: reminderDayToSend },
          $set: {
            lastReminderAt: new Date(),
            status: "overdue", // ensure status is overdue
          },
        }
      );

      console.log(
        `✅ Reminder ${getReminderNumber(reminderDayToSend)} sent for ${
          invoice.invoiceNumber
        } (${invoice.clientName}) — ${daysOverdue} days overdue`
      );
      sent++;
    } catch (err) {
      console.error(
        `❌ Failed to send reminder for invoice ${invoice.invoiceNumber}:`,
        err
      );
      errors++;
    }
  }

  console.log(
    `✅ processReminders done for ${currency}: sent=${sent} skipped=${skipped} errors=${errors}`
  );

  return { sent, skipped, errors };
}

// ── Main entry point called by the controller ──
// Detects which currencies are at 10 AM right now and processes them.
// Called every hour by a single Render cron job (0 * * * *).
export async function runScheduledReminders(): Promise<{
  processed: string[];
  results: Record<string, { sent: number; skipped: number; errors: number }>;
}> {
  const currencies = getCurrenciesAt10AM();

  if (currencies.length === 0) {
    console.log("⏭️ No currencies at 10 AM right now — skipping");
    return { processed: [], results: {} };
  }

  console.log(`🌍 Currencies at 10 AM: ${currencies.join(", ")}`);

  const results: Record<
    string,
    { sent: number; skipped: number; errors: number }
  > = {};

  for (const currency of currencies) {
    results[currency] = await processReminders(currency);
  }

  return { processed: currencies, results };
}
