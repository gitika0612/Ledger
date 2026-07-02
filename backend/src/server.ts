import "dotenv/config";
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { connectDB } from "./config/db";
import { requireAuth } from "./middleware/requireAuth";
import webhookRoutes from "./routes/webhooks";
import userRoutes from "./routes/users";
import invoiceRoutes from "./routes/invoices";
import chatRoutes from "./routes/chats";
import clientRoutes from "./routes/clients";
import paymentRoutes from "./routes/paymentRoutes";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  "/api/webhooks",
  express.raw({ type: "application/json" }),
  (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    if (Buffer.isBuffer(req.body)) {
      req.body = JSON.parse(req.body.toString("utf8"));
    }
    next();
  }
);

app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentRoutes
);

app.use(
  cors({
    origin: ["http://localhost:5173", "https://ledgerbrain.app"],
    credentials: true,
  })
);
app.use(express.json());
app.use(clerkMiddleware());

app.use("/api/webhooks", webhookRoutes);
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/invoices", requireAuth, invoiceRoutes);
app.use("/api/chats", requireAuth, chatRoutes);
app.use("/api/clients", requireAuth, clientRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Ledger API",
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Ledger API running on http://localhost:${PORT}`);
  });
});
