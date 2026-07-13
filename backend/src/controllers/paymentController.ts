import Stripe from "stripe";
import { Request, Response } from "express";
import { Invoice } from "../models/Invoice";
import {
  toStripeCurrency,
  toStripeUnitAmount,
  isOnlinePaymentSupported,
} from "../lib/stripeCurrency";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCheckoutSession(req: Request, res: Response) {
  const { invoiceId } = req.body;

  try {
    const invoice = await Invoice.findById(invoiceId).lean();

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!["sent", "overdue"].includes(invoice.status)) {
      return res
        .status(403)
        .json({ error: "Invoice not available for payment" });
    }

    if (!isOnlinePaymentSupported(invoice.currency)) {
      return res.status(400).json({
        error: `Online payment isn't available for invoices in ${
          invoice.currency ?? "this currency"
        } yet.`,
      });
    }

    const stripeCurrency = toStripeCurrency(invoice.currency);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      currency: stripeCurrency,
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
              description: `${invoice.invoiceMonth ?? ""}`,
            },
            unit_amount: toStripeUnitAmount(invoice.total, invoice.currency),
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
      },
      success_url: `${process.env.FRONTEND_URL}/pay/${invoiceId}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/pay/${invoiceId}`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    // Backstop for defense-in-depth: covers any currency that slips past the
    // isOnlinePaymentSupported() gate above (e.g. ACCOUNT_SUPPORTED_CURRENCIES
    // drifting out of sync with what Stripe actually accepts). Stripe rejects
    // an unsettleable currency with a StripeInvalidRequestError whose `param`
    // points at the checkout line item's currency field — detect that
    // specifically so we don't tell the customer to "try again" on something
    // that will never succeed.
    const isInvalidCurrencyError =
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      ((typeof err.param === "string" &&
        err.param.toLowerCase().includes("currency")) ||
        /invalid currency/i.test(err.message ?? ""));

    if (isInvalidCurrencyError) {
      console.warn(
        `Stripe rejected currency for invoice ${invoiceId} — account not configured to settle it:`,
        err.message
      );
      return res.status(400).json({
        error:
          "This currency isn't available for online payment. Please contact the sender.",
      });
    }

    console.error("Stripe checkout error:", err);
    res.status(500).json({ error: "Failed to create payment session" });
  }
}

// ── Get public invoice (no auth — for payment page) ──
export async function getPublicInvoice(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const invoice = await Invoice.findById(id)
      .select("-userId -embedding -idempotencyKey")
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!["sent", "overdue"].includes(invoice.status)) {
      return res
        .status(403)
        .json({ error: "Invoice not available for payment" });
    }

    res.json({
      invoice: {
        ...invoice,
        onlinePaymentAvailable: isOnlinePaymentSupported(invoice.currency),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
}

// ── Stripe Webhook ──
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    return res.status(400).json({ error: "Missing stripe signature" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;

    if (invoiceId) {
      try {
        await Invoice.findByIdAndUpdate(invoiceId, { status: "paid" });
        console.log(`✅ Invoice ${invoiceId} marked as paid`);
      } catch (err) {
        console.error("Failed to mark invoice as paid:", err);
      }
    }
  }

  res.json({ received: true });
}
