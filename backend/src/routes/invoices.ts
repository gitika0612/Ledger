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
} from "../controllers/invoiceController";
import { sendInvoice } from "../controllers/sendInvoice";

const router = Router();

router.post("/parse", parseInvoice);
router.post("/save", saveDraftInvoice);
router.patch("/:id/confirm", confirmInvoice);
router.get("/dashboard-stats", getDashboardStats);
router.get("/client-history/:clientName", getClientHistory);
router.get("/client/:clientName/latest", getLatestClientInvoice);
router.get("/", getUserInvoices);
router.get("/:id", getInvoiceById);
router.put("/:id", updateInvoice);
router.delete("/:id", removeInvoice);
router.post("/:id/send", sendInvoice);

export default router;
