import { UIMessage } from "@/hooks/useInvoiceChat";

function getTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const WELCOME: UIMessage = {
  _id: "welcome",
  role: "assistant",
  content:
    "Hi! Tell me what invoice you want to create, edit, or copy. You can also create invoices for multiple clients in one chat.",
  timestamp: getTime(),
};
