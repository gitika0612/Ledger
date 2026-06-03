import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { InvoiceAgentState } from "../state";
import { Invoice } from "../../models/Invoice";

const querySchema = z.object({
  queryType: z.enum([
    "overdue",
    "by_status", // show draft/confirmed/sent/paid invoices
    "by_client", // show all invoices for a client
    "total_billed",
    "due_this_week",
    "due_this_month",
    "due_in_month", // invoices due in a specific month
    "above_amount", // invoices above a certain amount
    "unpaid",
    "outstanding",
    "mark_paid",
    "general", // general question, answer from context
  ]),
  clientName: z.string(), // extracted client name if mentioned
  status: z.string(), // extracted status if mentioned
  amount: z.number(), // extracted amount threshold if mentioned
  month: z.string(), // extracted month if mentioned (e.g. "May 2026")
  invoiceRef: z.string(), // extracted invoice number if mentioned
});

type QueryType = z.infer<typeof querySchema>["queryType"];

function formatCurrency(amount: number, currency = "INR"): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
  return `${symbol}${amount.toLocaleString("en-IN")}`;
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getDueLabel(dueDate: Date | string): string {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil(
    (due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) /
      (1000 * 60 * 60 * 24)
  );
  if (diff < 0)
    return `overdue by ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""}`;
  if (diff === 0) return "due today";
  if (diff === 1) return "due tomorrow";
  return `due in ${diff} days`;
}

export async function queryNode(
  state: InvoiceAgentState
): Promise<Partial<InvoiceAgentState>> {
  if (!state.userId) {
    return {
      agentResult: {
        action: "info",
        message: "I couldn't identify your account. Please try again.",
      },
    };
  }

  // ── Classify the query ──
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const structured = model.withStructuredOutput(querySchema);
  const now = new Date();
  const currentMonth = now.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const classification = await structured.invoke(
    `Classify this invoice query. Extract any relevant filters.
Today: ${now.toISOString().split("T")[0]}
Current month: ${currentMonth}

Query: "${state.prompt}"

queryType options:
- overdue: "show overdue invoices", "which invoices are overdue"
- by_status: "show all draft invoices", "show confirmed invoices", "show sent invoices", "show paid invoices"
- by_client: "show all invoices for Priya", "Rahul's invoices"
- total_billed: "total billed to Rahul", "how much have I billed", "total revenue"
- due_this_week: "due this week", "which invoices are due this week"
- due_this_month: "due this month", "due in June"
- due_in_month: "due in May", "due in March 2026"
- above_amount: "invoices above ₹1,00,000", "invoices over $5000"
- unpaid: "unpaid invoices", "invoices not yet paid", "show outstanding invoices"
- outstanding: "clients with outstanding payments", "who owes me money"
- mark_paid: "mark INV-2026-001 as paid", "Priya paid", "mark paid"
- general: anything else

For month extraction, always include year (e.g. "May 2026").
For amount, extract the number only (no currency symbol).`
  );

  const userId = state.userId;
  const q = classification;

  try {
    switch (q.queryType as QueryType) {
      case "overdue": {
        const invoices = await Invoice.find({ userId, status: "overdue" })
          .sort({ dueDate: 1 })
          .limit(20)
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: "✅ No overdue invoices. You're all caught up!",
            },
          };
        const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — ${getDueLabel(
                inv.dueDate
              )}`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `🔴 **${invoices.length} overdue invoice${
              invoices.length !== 1 ? "s" : ""
            }** totalling **${formatCurrency(total)}**:\n\n${lines}`,
          },
        };
      }

      case "by_status": {
        const status = q.status || "draft";
        const invoices = await Invoice.find({ userId, status })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: `No ${status} invoices found.`,
            },
          };
        const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — ${
                inv.invoiceMonth ?? ""
              }`
          )
          .join("\n");
        const label = status.charAt(0).toUpperCase() + status.slice(1);
        return {
          agentResult: {
            action: "info",
            message: `**${invoices.length} ${label} invoice${
              invoices.length !== 1 ? "s" : ""
            }** — Total: **${formatCurrency(total)}**\n\n${lines}`,
          },
        };
      }

      case "by_client": {
        if (!q.clientName)
          return {
            agentResult: {
              action: "info",
              message: "Which client would you like to see invoices for?",
            },
          };
        const invoices = await Invoice.find({
          userId,
          clientName: { $regex: new RegExp(q.clientName, "i") },
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: `No invoices found for **${q.clientName}**.`,
            },
          };
        const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${formatCurrency(
                inv.total,
                inv.currency
              )} — ${inv.status} — ${inv.invoiceMonth ?? ""}`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `**${invoices.length} invoice${
              invoices.length !== 1 ? "s" : ""
            }** for **${q.clientName}** — Total billed: **${formatCurrency(
              total
            )}**\n\n${lines}`,
          },
        };
      }

      case "total_billed": {
        if (q.clientName) {
          const result = await Invoice.aggregate([
            {
              $match: {
                userId,
                clientName: { $regex: new RegExp(q.clientName, "i") },
                status: { $in: ["confirmed", "sent", "paid"] },
              },
            },
            {
              $group: {
                _id: "$currency",
                total: { $sum: "$total" },
                count: { $sum: 1 },
              },
            },
          ]);
          if (result.length === 0)
            return {
              agentResult: {
                action: "info",
                message: `No confirmed invoices found for **${q.clientName}**.`,
              },
            };
          const lines = result
            .map(
              (r) =>
                `**${formatCurrency(r.total, r._id)}** across ${
                  r.count
                } invoice${r.count !== 1 ? "s" : ""}`
            )
            .join(" | ");
          return {
            agentResult: {
              action: "info",
              message: `Total billed to **${q.clientName}**: ${lines}`,
            },
          };
        }
        // Overall total by currency
        const result = await Invoice.aggregate([
          {
            $match: { userId, status: { $in: ["confirmed", "sent", "paid"] } },
          },
          {
            $group: {
              _id: "$currency",
              total: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]);
        if (result.length === 0)
          return {
            agentResult: {
              action: "info",
              message: "No confirmed invoices found yet.",
            },
          };
        const lines = result
          .map(
            (r) =>
              `**${formatCurrency(r.total, r._id)}** (${r.count} invoice${
                r.count !== 1 ? "s" : ""
              })`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `💰 **Total billed (confirmed + sent + paid):**\n\n${lines}`,
          },
        };
      }

      case "due_this_week": {
        const startOfWeek = new Date(now);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        const invoices = await Invoice.find({
          userId,
          status: { $in: ["sent", "confirmed"] },
          dueDate: { $gte: startOfWeek, $lte: endOfWeek },
        })
          .sort({ dueDate: 1 })
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: "No invoices due this week.",
            },
          };
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — ${getDueLabel(
                inv.dueDate
              )}`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `📅 **${invoices.length} invoice${
              invoices.length !== 1 ? "s" : ""
            } due this week:**\n\n${lines}`,
          },
        };
      }

      case "due_this_month":
      case "due_in_month": {
        const targetMonth = q.month || currentMonth;
        // Parse "May 2026" → month filter
        const [monthName, yearStr] = targetMonth.split(" ");
        const monthIndex = new Date(
          `${monthName} 1, ${yearStr || now.getFullYear()}`
        ).getMonth();
        const year = parseInt(yearStr || String(now.getFullYear()));
        const startOfMonth = new Date(year, monthIndex, 1);
        const endOfMonth = new Date(year, monthIndex + 1, 0, 23, 59, 59);
        const invoices = await Invoice.find({
          userId,
          status: { $in: ["sent", "confirmed", "overdue"] },
          dueDate: { $gte: startOfMonth, $lte: endOfMonth },
        })
          .sort({ dueDate: 1 })
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: `No invoices due in **${targetMonth}**.`,
            },
          };
        const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — due ${formatDate(
                inv.dueDate
              )}`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `📅 **${invoices.length} invoice${
              invoices.length !== 1 ? "s" : ""
            } due in ${targetMonth}** — Total: **${formatCurrency(
              total
            )}**\n\n${lines}`,
          },
        };
      }

      case "above_amount": {
        const threshold = q.amount || 100000;
        const invoices = await Invoice.find({
          userId,
          total: { $gte: threshold },
        })
          .sort({ total: -1 })
          .limit(20)
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: `No invoices found above ${formatCurrency(threshold)}.`,
            },
          };
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — ${inv.status}`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `**${invoices.length} invoice${
              invoices.length !== 1 ? "s" : ""
            } above ${formatCurrency(threshold)}:**\n\n${lines}`,
          },
        };
      }

      case "unpaid": {
        const invoices = await Invoice.find({
          userId,
          status: { $in: ["sent", "overdue", "confirmed"] },
        })
          .sort({ dueDate: 1 })
          .limit(20)
          .lean();
        if (invoices.length === 0)
          return {
            agentResult: {
              action: "info",
              message: "✅ No unpaid invoices found!",
            },
          };
        const byStatus = invoices.reduce((acc, inv) => {
          acc[inv.status] = (acc[inv.status] || 0) + inv.total;
          return acc;
        }, {} as Record<string, number>);
        const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const lines = invoices
          .map(
            (inv) =>
              `• **${inv.invoiceNumber}** — ${
                inv.clientName
              } — ${formatCurrency(inv.total, inv.currency)} — ${inv.status}${
                inv.dueDate ? ` — ${getDueLabel(inv.dueDate)}` : ""
              }`
          )
          .join("\n");
        const summaryParts = Object.entries(byStatus)
          .map(([s, t]) => `${s}: ${formatCurrency(t)}`)
          .join(" | ");
        return {
          agentResult: {
            action: "info",
            message: `💸 **${invoices.length} unpaid invoice${
              invoices.length !== 1 ? "s" : ""
            }** — Total: **${formatCurrency(
              total
            )}**\n${summaryParts}\n\n${lines}`,
          },
        };
      }

      case "outstanding": {
        const result = await Invoice.aggregate([
          { $match: { userId, status: { $in: ["sent", "overdue"] } } },
          {
            $group: {
              _id: { client: "$clientName", currency: "$currency" },
              total: { $sum: "$total" },
              count: { $sum: 1 },
              oldest: { $min: "$dueDate" },
            },
          },
          { $sort: { total: -1 } },
        ]);
        if (result.length === 0)
          return {
            agentResult: {
              action: "info",
              message: "✅ No clients with outstanding payments!",
            },
          };
        const lines = result
          .map(
            (r) =>
              `• **${r._id.client}** — ${formatCurrency(
                r.total,
                r._id.currency
              )} across ${r.count} invoice${r.count !== 1 ? "s" : ""}${
                r.oldest ? ` — oldest due ${formatDate(r.oldest)}` : ""
              }`
          )
          .join("\n");
        return {
          agentResult: {
            action: "info",
            message: `👥 **Clients with outstanding payments:**\n\n${lines}`,
          },
        };
      }

      case "mark_paid": {
        // Find invoice by ref or client name
        let invoice = null;
        if (q.invoiceRef) {
          invoice = await Invoice.findOne({
            userId,
            invoiceNumber: { $regex: new RegExp(q.invoiceRef, "i") },
          });
        }
        if (!invoice && q.clientName) {
          invoice = await Invoice.findOne({
            userId,
            clientName: { $regex: new RegExp(q.clientName, "i") },
            status: { $in: ["sent", "overdue", "confirmed"] },
          }).sort({ createdAt: -1 });
        }
        if (!invoice)
          return {
            agentResult: {
              action: "info",
              message: `Couldn't find an invoice to mark as paid. Please specify an invoice number (e.g. INV-2026-001) or client name.`,
            },
          };
        await Invoice.findByIdAndUpdate(invoice._id, { status: "paid" });
        return {
          agentResult: {
            action: "info",
            message: `✅ **${invoice.invoiceNumber}** for **${
              invoice.clientName
            }** marked as **paid** — ${formatCurrency(
              invoice.total,
              invoice.currency
            )}`,
          },
        };
      }

      default: {
        return {
          agentResult: {
            action: "info",
            message:
              'I can help you with invoice queries. Try: "show overdue invoices", "total billed to Rahul", "invoices due this week", or "mark INV-2026-001 as paid".',
          },
        };
      }
    }
  } catch (err) {
    console.error("❌ Query node error:", err);
    return {
      agentResult: {
        action: "info",
        message:
          "Something went wrong while fetching your invoices. Please try again.",
      },
    };
  }
}
