import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendInvoiceEmailParams {
  toEmail: string;
  toName: string;
  fromName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  pdfBuffer: Buffer;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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
  } = params;

  const dueDateStr = formatDate(dueDate);
  const totalStr = formatINR(total);

  const { error } = await resend.emails.send({
    from: `${fromName} <onboarding@resend.dev>`,
    to: toEmail,
    subject: `Invoice ${invoiceNumber} from ${fromName} — ${totalStr} due ${dueDateStr}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body style="margin:0; padding:0; background:#F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB; padding: 40px 16px;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

                  <!-- Logo / Brand -->
                  <tr>
                    <td style="padding-bottom: 24px; text-align: center;">
                      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                        <tr>
                          <td style="background:#4F46E5; width:32px; height:32px; border-radius:8px; text-align:center; vertical-align:middle;">
                            <span style="color:white; font-size:18px; font-weight:bold; line-height:32px;">⚡</span>
                          </td>
                          <td style="padding-left:8px; font-size:18px; font-weight:700; color:#111827;">
                            Ledger
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Card -->
                  <tr>
                    <td style="background:#ffffff; border-radius:16px; border:1px solid #E5E7EB; overflow:hidden;">

                      <!-- Indigo top bar -->
                      <tr>
                        <td style="background:#4F46E5; height:4px;"></td>
                      </tr>

                      <!-- Body -->
                      <tr>
                        <td style="padding: 36px 40px 32px;">

                          <p style="margin:0 0 8px; font-size:14px; color:#6B7280;">
                            Hi ${toName},
                          </p>
                          <h1 style="margin:0 0 24px; font-size:22px; font-weight:700; color:#111827;">
                            You have a new invoice
                          </h1>

                          <!-- Invoice details box -->
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#F9FAFB; border-radius:10px; padding:20px; margin-bottom:28px;">
                            <tr>
                              <td style="padding-bottom:12px;">
                                <span style="font-size:11px; font-weight:600; color:#9CA3AF; text-transform:uppercase; letter-spacing:0.05em;">
                                  Invoice Number
                                </span><br/>
                                <span style="font-size:15px; font-weight:700; color:#111827;">
                                  ${invoiceNumber}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="border-top:1px solid #E5E7EB; padding-top:12px; padding-bottom:12px;">
                                <span style="font-size:11px; font-weight:600; color:#9CA3AF; text-transform:uppercase; letter-spacing:0.05em;">
                                  Amount Due
                                </span><br/>
                                <span style="font-size:22px; font-weight:700; color:#4F46E5;">
                                  ${totalStr}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="border-top:1px solid #E5E7EB; padding-top:12px;">
                                <span style="font-size:11px; font-weight:600; color:#9CA3AF; text-transform:uppercase; letter-spacing:0.05em;">
                                  Due Date
                                </span><br/>
                                <span style="font-size:14px; font-weight:600; color:#111827;">
                                  ${dueDateStr}
                                </span>
                              </td>
                            </tr>
                          </table>

                          <p style="margin:0 0 28px; font-size:14px; color:#6B7280; line-height:1.6;">
                            Please find the invoice PDF attached to this email.
                            If you have any questions, simply reply to this email.
                          </p>

                          <p style="margin:0; font-size:14px; color:#374151;">
                            Thanks,<br/>
                            <strong>${fromName}</strong>
                          </p>

                        </td>
                      </tr>

                      <!-- Footer inside card -->
                      <tr>
                        <td style="background:#F9FAFB; border-top:1px solid #E5E7EB; padding:16px 40px; text-align:center;">
                          <p style="margin:0; font-size:11px; color:#9CA3AF;">
                            Sent via <strong>Ledger</strong> · Invoice ${invoiceNumber}
                          </p>
                        </td>
                      </tr>

                    </td>
                  </tr>

                  <!-- Bottom caption -->
                  <tr>
                    <td style="padding-top:20px; text-align:center;">
                      <p style="margin:0; font-size:11px; color:#9CA3AF;">
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
