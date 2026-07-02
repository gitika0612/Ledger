import api from "@/lib/api/api";
import { ParsedInvoice } from "@/components/invoice/InvoicePreviewCard";

export interface ChatSessionAPI {
  _id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceAttachment {
  data: ParsedInvoice;
  invoiceId?: string;
  invoiceNumber?: string;
  status: "draft" | "confirmed" | "sent" | "paid" | "overdue";
}

export interface ChatMessageAPI {
  _id: string;
  sessionId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  invoice?: InvoiceAttachment;
  createdAt: string;
  updatedAt: string;
}

export async function createChatSession(): Promise<ChatSessionAPI> {
  const response = await api.post("/chats/", {});
  return response.data.session;
}

export async function getUserChatSessions(): Promise<ChatSessionAPI[]> {
  const response = await api.get("/chats/");
  return response.data.sessions;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await api.delete(`/chats/${sessionId}`);
}

export async function getSessionMessages(
  sessionId: string
): Promise<ChatMessageAPI[]> {
  const response = await api.get(`/chats/${sessionId}/messages`);
  return response.data.messages;
}

export async function addChatMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  invoice?: InvoiceAttachment
): Promise<ChatMessageAPI> {
  const response = await api.post(`/chats/${sessionId}/messages`, {
    role,
    content,
    invoice,
  });
  return response.data.message;
}

export async function confirmInvoiceInMessage(
  sessionId: string,
  messageId: string,
  invoiceNumber: string,
  invoiceId: string
): Promise<void> {
  await api.patch(`/chats/${sessionId}/messages/${messageId}/confirm`, {
    invoiceId,
    invoiceNumber,
  });
}

export async function updateMessageInvoiceData(
  sessionId: string,
  messageId: string,
  invoiceData: ParsedInvoice
): Promise<void> {
  await api.patch(`/chats/${sessionId}/messages/${messageId}/invoice`, {
    invoiceData,
  });
}
