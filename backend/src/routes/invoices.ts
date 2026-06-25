import { Router } from "express";
import {
  parseInvoice,
  saveDraftInvoice,
  confirmInvoice,
  getUserInvoices,
  updateInvoice,
  getDashboardStats,
  removeInvoice,
  getInvoiceById,
  getClientHistory,
  getLatestClientInvoice,
  sendOverdueReminders,
} from "../controllers/invoiceController";
import { sendInvoice } from "../controllers/sendInvoice";

const router = Router();

// ── Static routes first (before /:id) ──
router.post("/parse", parseInvoice);
router.post("/save", saveDraftInvoice);
router.get("/dashboard-stats", getDashboardStats);
router.get("/client-history/:clientName", getClientHistory);
router.get("/client/:clientName/latest", getLatestClientInvoice);
router.get("/", getUserInvoices);

// ── Cron route — protected by secret query param ──
// Single cron job runs every hour: 0 * * * *
// URL: POST /api/invoices/send-overdue-reminders?secret=your-secret
// reminderService auto-detects which currencies are at 10 AM
router.post("/send-overdue-reminders", sendOverdueReminders);

// ── Dynamic routes last ──
router.get("/:id", getInvoiceById);
router.patch("/:id/confirm", confirmInvoice);
router.put("/:id", updateInvoice);
router.delete("/:id", removeInvoice);
router.post("/:id/send", sendInvoice);

export default router;
