/// <reference types="node" />
import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { ChatSession } from "../models/ChatSession";
import { ChatMessage } from "../models/ChatMessage";

// ── Create new chat session ──
export async function createSession(
  req: Request,
  res: Response
): Promise<void> {
  const { userId: clerkId } = getAuth(req);

  try {
    const session = await ChatSession.create({
      userId: clerkId,
      title: "New Chat",
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    res.status(500).json({ error: "Failed to create session" });
  }
}

// ── Get all sessions for a user ──
export async function getUserSessions(
  req: Request,
  res: Response
): Promise<void> {
  const { userId: clerkId } = getAuth(req);

  try {
    const sessions = await ChatSession.find({ userId: clerkId })
      .sort({ updatedAt: -1 })
      .lean();

    res.status(200).json({ success: true, sessions });
  } catch (err) {
    console.error("❌ Get sessions error:", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
}

// ── Delete a session + all its messages ──
export async function deleteSession(
  req: Request,
  res: Response
): Promise<void> {
  const { sessionId } = req.params;
  const { userId: clerkId } = getAuth(req);

  try {
    const session = await ChatSession.findOneAndDelete({
      _id: sessionId,
      userId: clerkId,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Delete all messages in this session
    await ChatMessage.deleteMany({ sessionId });

    console.log(`✅ Session deleted: ${sessionId}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Delete session error:", err);
    res.status(500).json({ error: "Failed to delete session" });
  }
}

// ── Get all messages in a session ──
export async function getSessionMessages(
  req: Request,
  res: Response
): Promise<void> {
  const { sessionId } = req.params;
  const { userId: clerkId } = getAuth(req);

  try {
    // Verify session belongs to user
    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: clerkId,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messages = await ChatMessage.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({ success: true, messages });
  } catch (err) {
    console.error("❌ Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
}

// ── Add message to session ──
export async function addMessage(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.params;
  const { userId: clerkId } = getAuth(req);
  const { role, content, invoice } = req.body;

  if (!role || (!content && !invoice)) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    // Verify session belongs to user
    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: clerkId,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Save message
    const message = await ChatMessage.create({
      sessionId,
      userId: clerkId,
      role,
      content,
      invoice: invoice || undefined,
    });

    // Update session title if this is the first user message
    if (role === "user") {
      const messageCount = await ChatMessage.countDocuments({
        sessionId,
        role: "user",
      });

      // First user message → set as session title
      if (messageCount === 1) {
        await ChatSession.findByIdAndUpdate(sessionId, {
          title: content.slice(0, 60),
        });
      } else {
        // Just update updatedAt to bubble session to top
        await ChatSession.findByIdAndUpdate(sessionId, {
          updatedAt: new Date(),
        });
      }
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error("❌ Add message error:", err);
    res.status(500).json({ error: "Failed to add message" });
  }
}

// ── Confirm invoice in a message ──
export async function confirmInvoiceInMessage(
  req: Request,
  res: Response
): Promise<void> {
  const { sessionId, messageId } = req.params;
  const { userId: clerkId } = getAuth(req);
  const { invoiceId, invoiceNumber } = req.body;

  try {
    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: clerkId,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const message = await ChatMessage.findOneAndUpdate(
      { _id: messageId, sessionId },
      {
        "invoice.status": "confirmed",
        "invoice.invoiceId": invoiceId,
        "invoice.invoiceNumber": invoiceNumber,
      },
      { new: true }
    );

    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    console.log(`✅ Invoice confirmed in message: ${messageId}`);
    res.status(200).json({ success: true, message });
  } catch (err) {
    console.error("❌ Confirm invoice error:", err);
    res.status(500).json({ error: "Failed to confirm invoice" });
  }
}

export async function updateMessageInvoice(
  req: Request,
  res: Response
): Promise<void> {
  const { sessionId, messageId } = req.params;
  const { userId: clerkId } = getAuth(req);
  const { invoiceData } = req.body;

  try {
    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: clerkId,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const message = await ChatMessage.findOneAndUpdate(
      { _id: messageId, sessionId },
      { "invoice.data": invoiceData },
      { new: true }
    );
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.status(200).json({ success: true, message });
  } catch (err) {
    console.error("❌ Update message invoice error:", err);
    res.status(500).json({ error: "Failed to update message invoice" });
  }
}
