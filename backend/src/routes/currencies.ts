import { Router } from "express";
import { getCurrencyRates } from "../controllers/currencyController";

const router = Router();

router.get("/rates", getCurrencyRates);

export default router;
