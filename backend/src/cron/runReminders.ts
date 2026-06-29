import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { runScheduledReminders } from "../lib/reminderService";

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI not set");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected");

  const result = await runScheduledReminders();
  console.log("✅ Done:", JSON.stringify(result, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Cron failed:", err);
  process.exit(1);
});
