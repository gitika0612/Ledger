import { Resend } from "resend";
import { normalizeCurrencyCode } from "./currencies";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendInvoiceEmailParams {
  toEmail: string;
  toName: string;
  fromName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  pdfBuffer: Buffer;
  invoiceId: string;
  currency?: string;
}

export interface SendReminderEmailParams {
  toEmail: string;
  toName: string;
  fromName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  invoiceId: string;
  currency?: string;
  reminderNumber: 1 | 2 | 3;
  daysOverdue: number;
}

function formatAmount(amount: number, currency?: string): string {
  const code = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Extremely unlikely (normalizeCurrencyCode already guarantees a known code),
    // but never let email formatting crash a send.
    return `${code} ${amount.toLocaleString("en-US")}`;
  }
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Reminder tone config per reminder number ──
// Day 1 → gentle nudge
// Day 3 → friendly follow-up
// Day 7 → final notice
function getReminderConfig(reminderNumber: 1 | 2 | 3, daysOverdue: number) {
  switch (reminderNumber) {
    case 1:
      return {
        subject: (inv: string, from: string, total: string) =>
          `Friendly reminder: Invoice ${inv} from ${from} — ${total} overdue`,
        headerBg: "#1a1a1a",
        badge: "Gentle Reminder",
        badgeBg: "#374151",
        greeting: (name: string) => `Hi ${name},`,
        body: (from: string, inv: string, due: string) =>
          `Just a quick heads up — invoice <strong>${inv}</strong> from <strong>${from}</strong> was due on <strong>${due}</strong>. If you've already sent the payment, please ignore this email. If not, we'd appreciate it if you could take a moment to settle it.`,
        ctaText: (total: string) => `Pay ${total} Now`,
        closing: "Thanks for your time,",
      };
    case 2:
      return {
        subject: (inv: string, from: string, total: string) =>
          `Follow-up: Invoice ${inv} from ${from} — ${total} still outstanding`,
        headerBg: "#92400e",
        badge: "Follow-up",
        badgeBg: "#b45309",
        greeting: (name: string) => `Hi ${name},`,
        body: (from: string, inv: string, due: string) =>
          `This is a follow-up regarding invoice <strong>${inv}</strong> from <strong>${from}</strong>, which was due on <strong>${due}</strong> and remains unpaid. We understand things get busy — could you let us know when we can expect the payment?`,
        ctaText: (total: string) => `Pay ${total} Now`,
        closing: "We appreciate your prompt attention,",
      };
    case 3:
      return {
        subject: (inv: string, from: string, total: string) =>
          `Final reminder: Invoice ${inv} from ${from} — ${total} overdue by ${daysOverdue} days`,
        headerBg: "#7f1d1d",
        badge: "Final Reminder",
        badgeBg: "#991b1b",
        greeting: (name: string) => `Hi ${name},`,
        body: (from: string, inv: string, due: string) =>
          `This is our final reminder for invoice <strong>${inv}</strong> from <strong>${from}</strong>, which was due on <strong>${due}</strong>. This invoice is now significantly overdue. Please arrange payment as soon as possible to avoid any further action.`,
        ctaText: (total: string) => `Pay ${total} Immediately`,
        closing: "We hope to resolve this promptly,",
      };
  }
}

export async function sendInvoiceEmail(
  params: SendInvoiceEmailParams
): Promise<void> {
  const {
    toEmail,
    toName,
    fromName,
    invoiceNumber,
    total,
    dueDate,
    pdfBuffer,
    invoiceId,
    currency,
  } = params;

  const paymentLink = `${process.env.FRONTEND_URL}/pay/${invoiceId}`;
  const dueDateStr = formatDate(dueDate);
  const totalStr = formatAmount(total, currency);

  const { error } = await resend.emails.send({
    from: `${fromName} <invoices@ledgerbrain.app>`,
    to: toEmail,
    subject: `Invoice ${invoiceNumber} from ${fromName} — ${totalStr} due ${dueDateStr}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body style="margin:0; padding:0; background:#f4f4f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0; padding: 40px 16px;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

                  <!-- Logo -->
                  <tr>
                    <td style="padding-bottom: 24px; text-align: center;">
                      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                        <tr>
                          <td style="background:#1a1a1a; width:30px; height:30px; border-radius:7px; text-align:center; vertical-align:middle;">
                            <span style="color:white; font-size:16px; line-height:30px;">⚡</span>
                          </td>
                          <td style="padding-left:8px; font-size:17px; font-weight:700; color:#1a1a1a; letter-spacing:-0.3px;">
                            Ledger
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Main card -->
                  <tr>
                    <td style="background:#ffffff; border-radius:16px; border:1px solid #e8e8e4; overflow:hidden;">

                      <!-- Dark header -->
                      <tr>
                        <td style="background:#1a1a1a; padding:28px 36px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td>
                                <span style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:0.07em;">Invoice</span><br/>
                                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.4px;">${invoiceNumber}</span>
                              </td>
                              <td align="right">
                                <span style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:0.07em;">Amount due</span><br/>
                                <span style="font-size:26px; font-weight:700; color:#ffffff; letter-spacing:-0.8px;">${totalStr}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Body -->
                      <tr>
                        <td style="padding: 32px 36px 28px;">

                          <p style="margin:0 0 6px; font-size:14px; color:#6b7280;">Hi ${toName},</p>
                          <p style="margin:0 0 28px; font-size:15px; color:#374151; line-height:1.6;">
                            <strong>${fromName}</strong> has sent you an invoice. 
                            Please review and pay by <strong>${dueDateStr}</strong>.
                          </p>

                          <!-- Invoice detail rows -->
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f9fafb; border:1px solid #e8e8e4; border-radius:12px; margin-bottom:28px;">
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">Invoice number</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#374151;">${invoiceNumber}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">From</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#374151;">${fromName}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #e5e7eb;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">Due date</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#374151;">${dueDateStr}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:18px 20px;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:15px; font-weight:700; color:#111;">Total due</td>
                                    <td align="right" style="font-size:20px; font-weight:700; color:#111; letter-spacing:-0.4px;">${totalStr}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>

                          <!-- Pay Now CTA -->
                          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                            <tr>
                              <td align="center">
                                <a href="${paymentLink}"
                                   style="display:inline-block; background:#4F46E5; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:14px 44px; border-radius:10px; letter-spacing:-0.2px;">
                                  Pay ${totalStr} Online
                                </a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding-top:10px;">
                                <span style="font-size:12px; color:#9ca3af;">
                                  🔒 Secure payment · Powered by Stripe
                                </span>
                              </td>
                            </tr>
                          </table>

                          <!-- Fallback link -->
                          <p style="margin:0 0 28px; font-size:12px; color:#9ca3af; text-align:center; line-height:1.6;">
                            Can't click the button? Copy this link:<br/>
                            <a href="${paymentLink}" style="color:#4F46E5; text-decoration:none; word-break:break-all;">
                              ${paymentLink}
                            </a>
                          </p>

                          <hr style="border:none; border-top:1px solid #f0f0ec; margin:0 0 24px;" />

                          <!-- PDF note -->
                          <p style="margin:0 0 20px; font-size:13px; color:#9ca3af; line-height:1.6;">
                            The invoice PDF is also attached to this email for your records. 
                            If you have any questions, simply reply to this email.
                          </p>

                          <p style="margin:0; font-size:14px; color:#374151;">
                            Thanks,<br/>
                            <strong>${fromName}</strong>
                          </p>

                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td style="background:#f9fafb; border-top:1px solid #f0f0ec; padding:16px 36px; text-align:center;">
                          <p style="margin:0; font-size:11px; color:#9ca3af;">
                            Sent via <strong style="color:#6b7280;">Ledger</strong> · ledgerbrain.app
                          </p>
                        </td>
                      </tr>

                    </td>
                  </tr>

                  <!-- Bottom note -->
                  <tr>
                    <td style="padding-top:20px; text-align:center;">
                      <p style="margin:0; font-size:11px; color:#9ca3af;">
                        This email was sent by ${fromName} using Ledger.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

// ── Reminder email — no PDF attachment ──
// Tone escalates across the 3 reminders:
// Reminder 1 (day 1): gentle nudge
// Reminder 2 (day 3): friendly follow-up
// Reminder 3 (day 7): final notice
export async function sendReminderEmail(
  params: SendReminderEmailParams
): Promise<void> {
  const {
    toEmail,
    toName,
    fromName,
    invoiceNumber,
    total,
    dueDate,
    invoiceId,
    currency,
    reminderNumber,
    daysOverdue,
  } = params;

  const paymentLink = `${process.env.FRONTEND_URL}/pay/${invoiceId}`;
  const dueDateStr = formatDate(dueDate);
  const totalStr = formatAmount(total, currency);
  const config = getReminderConfig(reminderNumber, daysOverdue);

  const { error } = await resend.emails.send({
    from: `${fromName} <invoices@ledgerbrain.app>`,
    to: toEmail,
    subject: config.subject(invoiceNumber, fromName, totalStr),
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body style="margin:0; padding:0; background:#f4f4f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0; padding: 40px 16px;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

                  <!-- Logo -->
                  <tr>
                    <td style="padding-bottom: 24px; text-align: center;">
                      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                        <tr>
                          <td style="background:#1a1a1a; width:30px; height:30px; border-radius:7px; text-align:center; vertical-align:middle;">
                            <span style="color:white; font-size:16px; line-height:30px;">⚡</span>
                          </td>
                          <td style="padding-left:8px; font-size:17px; font-weight:700; color:#1a1a1a; letter-spacing:-0.3px;">
                            Ledger
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Main card -->
                  <tr>
                    <td style="background:#ffffff; border-radius:16px; border:1px solid #e8e8e4; overflow:hidden;">

                      <!-- Colored header based on urgency -->
                      <tr>
                        <td style="background:${
                          config.headerBg
                        }; padding:28px 36px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td>
                                <span style="display:inline-block; background:${
                                  config.badgeBg
                                }; color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; padding:3px 10px; border-radius:20px; margin-bottom:10px;">
                                  ${config.badge}
                                </span><br/>
                                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.4px;">${invoiceNumber}</span>
                              </td>
                              <td align="right">
                                <span style="font-size:11px; color:#aaa; text-transform:uppercase; letter-spacing:0.07em;">Amount overdue</span><br/>
                                <span style="font-size:26px; font-weight:700; color:#ffffff; letter-spacing:-0.8px;">${totalStr}</span>
                                <br/>
                                <span style="font-size:11px; color:#aaa;">${daysOverdue} day${
      daysOverdue !== 1 ? "s" : ""
    } overdue</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Body -->
                      <tr>
                        <td style="padding: 32px 36px 28px;">

                          <p style="margin:0 0 6px; font-size:14px; color:#6b7280;">${config.greeting(
                            toName
                          )}</p>
                          <p style="margin:0 0 28px; font-size:15px; color:#374151; line-height:1.6;">
                            ${config.body(fromName, invoiceNumber, dueDateStr)}
                          </p>

                          <!-- Invoice detail rows -->
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f9fafb; border:1px solid #e8e8e4; border-radius:12px; margin-bottom:28px;">
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">Invoice number</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#374151;">${invoiceNumber}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">From</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#374151;">${fromName}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">Due date</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#ef4444;">${dueDateStr}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 20px; border-bottom:1px solid #f0f0ec;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:13px; color:#9ca3af;">Days overdue</td>
                                    <td align="right" style="font-size:13px; font-weight:600; color:#ef4444;">${daysOverdue} day${
      daysOverdue !== 1 ? "s" : ""
    }</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:18px 20px;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size:15px; font-weight:700; color:#111;">Total due</td>
                                    <td align="right" style="font-size:20px; font-weight:700; color:#111; letter-spacing:-0.4px;">${totalStr}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>

                          <!-- Pay Now CTA -->
                          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                            <tr>
                              <td align="center">
                                <a href="${paymentLink}"
                                   style="display:inline-block; background:#4F46E5; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:14px 44px; border-radius:10px; letter-spacing:-0.2px;">
                                  ${config.ctaText(totalStr)}
                                </a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding-top:10px;">
                                <span style="font-size:12px; color:#9ca3af;">
                                  🔒 Secure payment · Powered by Stripe
                                </span>
                              </td>
                            </tr>
                          </table>

                          <!-- Fallback link -->
                          <p style="margin:0 0 28px; font-size:12px; color:#9ca3af; text-align:center; line-height:1.6;">
                            Can't click the button? Copy this link:<br/>
                            <a href="${paymentLink}" style="color:#4F46E5; text-decoration:none; word-break:break-all;">
                              ${paymentLink}
                            </a>
                          </p>

                          <hr style="border:none; border-top:1px solid #f0f0ec; margin:0 0 24px;" />

                          <p style="margin:0; font-size:14px; color:#374151;">
                            ${config.closing}<br/>
                            <strong>${fromName}</strong>
                          </p>

                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td style="background:#f9fafb; border-top:1px solid #f0f0ec; padding:16px 36px; text-align:center;">
                          <p style="margin:0; font-size:11px; color:#9ca3af;">
                            Sent via <strong style="color:#6b7280;">Ledger</strong> · ledgerbrain.app
                          </p>
                        </td>
                      </tr>

                    </td>
                  </tr>

                  <!-- Bottom note -->
                  <tr>
                    <td style="padding-top:20px; text-align:center;">
                      <p style="margin:0; font-size:11px; color:#9ca3af;">
                        This email was sent by ${fromName} using Ledger.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    // No PDF attachment on reminders — keeps it lightweight and friendly
  });

  if (error) {
    throw new Error(`Failed to send reminder email: ${error.message}`);
  }
}
