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
  invoiceId: string;
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
    invoiceId,
  } = params;

  const paymentLink = `${process.env.FRONTEND_URL}/pay/${invoiceId}`;
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
                            Sent via <strong style="color:#6b7280;">Ledger</strong> · ledgerbrain.vercel.app
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
