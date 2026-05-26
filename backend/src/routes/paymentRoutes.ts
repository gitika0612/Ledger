import { Router } from "express";
import express from "express";
import {
  createCheckoutSession,
  getPublicInvoice,
  handleStripeWebhook,
} from "../controllers/paymentController";

const router = Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

router.get("/invoice/:id", getPublicInvoice);
router.post("/create-checkout-session", createCheckoutSession);

export default router;
