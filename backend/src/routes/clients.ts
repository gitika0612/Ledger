import { Router } from "express";
import {
  getUserClients,
  getClientById,
  getClientByName,
  upsertClient,
  deleteClient,
  parseClientDetails,
  updateClientByName,
} from "../controllers/clientController";

const router = Router();

// ── Static routes first (before any /:id) ──
router.get("/", getUserClients);
router.get("/search", getClientByName);
router.post("/", upsertClient);
router.patch("/by-name/:name", updateClientByName);
router.post("/parse-details", parseClientDetails);

// ── Dynamic routes last ──
router.get("/:id", getClientById);
router.delete("/:id", deleteClient);

export default router;
