import { useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@clerk/clerk-react";
import {
  parseInvoiceWithAI,
  saveDraftInvoice,
  confirmInvoice,
  deleteInvoice,
  updateInvoice,
  fetchInvoiceById,
  AgentResult,
} from "@/lib/api/invoiceApi";
import { parseClientDetailsFromText, ClientAPI } from "@/lib/api/clientApi";
import { ParsedInvoice } from "@/components/invoice/InvoicePreviewCard";
import {
  ChatSessionAPI,
  ChatMessageAPI,
  createChatSession,
  getUserChatSessions,
  deleteChatSession,
  getSessionMessages,
  addChatMessage,
  confirmInvoiceInMessage,
  updateMessageInvoiceData,
} from "@/lib/api/chatApi";
import { SessionInvoice } from "@/components/invoice/InvoicePanel";
import { WELCOME } from "@/lib/invoice-chat/constants";
import { getTime, toUIMessage } from "@/lib/invoice-chat/messageHelpers";
import { recalculateTotals } from "@/lib/invoice-chat/invoiceHelpers";
import {
  buildSessionContext,
  findMatchingInvoices,
} from "@/lib/invoice-chat/sessionHelpers";
import { formatCurrency } from "@/lib/currency";

export interface UIMessage {
  _id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  invoiceMessageId?: string;
  status?: "draft" | "confirmed" | "sent" | "paid" | "overdue";
  invoiceNumber?: string;
  dbMessageId?: string;
}

const GENERIC_CLIENT_NAMES = new Set([
  "international client",
  "client",
  "the client",
  "new client",
  "unknown client",
  "customer",
  "overseas client",
  "foreign client",
]);

function isGenericClientName(name: string): boolean {
  return GENERIC_CLIENT_NAMES.has(name.toLowerCase().trim());
}

type PendingStatus =
  | "awaiting_client_details"
  | "awaiting_confirm_same"
  | "awaiting_ambiguity"
  | "awaiting_edit_ambiguity"
  | "awaiting_client_name";

interface PendingState {
  status: PendingStatus;
  sessionId: string;
  originalPrompt: string;
  invoice?: ParsedInvoice;
  clientName?: string;
  matchedClient?: ClientAPI | null;
  ambiguityInvoice?: ParsedInvoice;
  ambiguityTargetRef?: string;
  ambiguitySourceRef?: string;
  pendingEmail?: string;
}

export function useInvoiceChat() {
  const { user, isLoaded } = useUser();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionAPI[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([WELCOME]);
  const [sessionInvoices, setSessionInvoices] = useState<SessionInvoice[]>([]);
  const [selectedPanelMessageId, setSelectedPanelMessageId] = useState<
    string | null
  >(null);
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [panelTab, setPanelTab] = useState<"draft" | "confirmed" | undefined>(
    undefined
  );

  const pendingStateRef = useRef<PendingState | null>(null);
  const sessionInvoicesRef = useRef<SessionInvoice[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    sessionInvoicesRef.current = sessionInvoices;
  }, [sessionInvoices]);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);
  useEffect(() => {
    if (!isLoaded || !user) return;
    loadSessions();
  }, [isLoaded, user]);
  useEffect(() => {
    if (!user || !currentSessionId) return;
    localStorage.setItem(`ledger_session_${user.id}`, currentSessionId);
  }, [currentSessionId, user]);

  const setPending = (val: PendingState | null) => {
    pendingStateRef.current = val;
    setPendingState(val);
  };

  const setActiveTab = (tab: "draft" | "confirmed") => {
    setPanelTab(tab);
  };

  const loadMessagesForSession = useCallback(
    async (userId: string, sessionId: string) => {
      setCurrentSessionId(sessionId);
      setLoadingMessages(true);
      setMessages([]);
      setSessionInvoices([]);
      setSelectedPanelMessageId(null);
      setPanelTab(undefined);
      setPending(null);

      try {
        const msgs = await getSessionMessages(userId, sessionId);
        if (msgs.length === 0) {
          setMessages([WELCOME]);
        } else {
          setMessages(msgs.map(toUIMessage));
          const invoiceMsgs = msgs.filter(
            (m) => m.invoice?.data && m.invoice?.invoiceId
          );
          if (invoiceMsgs.length > 0) {
            const results = await Promise.all(
              invoiceMsgs.map(async (m): Promise<SessionInvoice | null> => {
                const invoiceId = m.invoice?.invoiceId;
                if (!invoiceId) return null;
                try {
                  const db = await fetchInvoiceById(invoiceId);
                  if (!db) return null;
                  return {
                    messageId: m._id,
                    invoice: {
                      clientName: db.clientName,
                      lineItems: db.lineItems,
                      currency: db.currency,
                      gstPercent: db.gstPercent,
                      gstType: db.gstType,
                      cgstAmount: db.cgstAmount,
                      sgstAmount: db.sgstAmount,
                      igstAmount: db.igstAmount,
                      gstAmount: db.gstAmount,
                      discountType: db.discountType,
                      discountValue: db.discountValue,
                      discountAmount: db.discountAmount,
                      notes: db.notes,
                      paymentTermsDays: db.paymentTermsDays,
                      subtotal: db.subtotal,
                      taxableAmount: db.taxableAmount,
                      total: db.total,
                      invoiceDate: db.invoiceDate,
                      invoiceMonth: db.invoiceMonth,
                      taxAmount: db.taxAmount,
                      taxLabel: db.taxLabel,
                      taxPercent: db.taxPercent,
                    } as ParsedInvoice,
                    status: db.status,
                    invoiceNumber: db.invoiceNumber,
                    invoiceId,
                    dbMessageId: m._id,
                  };
                } catch {
                  return null;
                }
              })
            );
            const invoices = results.filter(
              (inv): inv is SessionInvoice => inv !== null
            );
            setSessionInvoices(invoices);
            if (invoices.length > 0) {
              setSelectedPanelMessageId(
                invoices[invoices.length - 1].messageId
              );
            }
          }
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
        setMessages([WELCOME]);
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  const loadSessions = async () => {
    if (!user) return;
    try {
      const data = await getUserChatSessions(user.id);
      setSessions(data);
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        const savedId = localStorage.getItem(`ledger_session_${user.id}`);
        if (savedId) {
          const session = data.find((s) => s._id === savedId);
          if (session) await loadMessagesForSession(user.id, session._id);
        }
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const ensureSession = async (): Promise<string> => {
    if (currentSessionId) return currentSessionId;
    if (!user) throw new Error("No user");
    const session = await createChatSession(user.id);
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session._id);
    return session._id;
  };

  const addAIMessage = async (
    content: string,
    sessionId: string
  ): Promise<ChatMessageAPI> => {
    if (!user) throw new Error("No user");
    const saved = await addChatMessage(
      user.id,
      sessionId,
      "assistant",
      content
    );
    if (currentSessionIdRef.current === sessionId) {
      setMessages((prev) => [
        ...prev,
        {
          _id: saved._id,
          role: "assistant",
          content,
          timestamp: getTime(),
          dbMessageId: saved._id,
        },
      ]);
    }
    return saved;
  };

  const addUserMessageToUI = (content: string, tempId: string) => {
    setMessages((prev) =>
      prev
        .filter((m) => m._id !== "welcome")
        .concat({ _id: tempId, role: "user", content, timestamp: getTime() })
    );
  };

  const saveDraftAndShow = async (
    invoice: ParsedInvoice,
    client: ClientAPI | null,
    sessionId: string,
    originalPrompt: string,
    autoSelect = true,
    suppressGenericMessage = false
  ) => {
    if (!user) return;
    const finalInvoice = recalculateTotals(invoice);

    let savedDraft = null;
    try {
      savedDraft = await saveDraftInvoice(
        finalInvoice,
        user.id,
        originalPrompt,
        client?._id
      );
    } catch (err) {
      console.error("Failed to save draft:", err);
    }

    // When suppressed, use empty content so no text bubble shows — but message still
    // exists in DB with invoice attachment so the mini card renders in UI.
    const content = suppressGenericMessage
      ? " "
      : `Invoice draft ready for **${finalInvoice.clientName}**. Review it in the side panel.`;

    const savedMsg = await addChatMessage(
      user.id,
      sessionId,
      "assistant",
      content,
      {
        data: finalInvoice,
        status: "draft",
        invoiceId: savedDraft?._id || "",
        invoiceNumber: savedDraft?.invoiceNumber || "",
      }
    );

    // Always add to UI so the mini card renders — but only if still on this session.
    // Empty content = no text bubble shown, just the invoice mini card.
    if (currentSessionIdRef.current === sessionId) {
      setMessages((prev) => [
        ...prev,
        {
          _id: savedMsg._id,
          role: "assistant",
          content,
          timestamp: getTime(),
          invoiceMessageId: savedMsg._id,
          invoiceNumber: savedDraft?.invoiceNumber,
          dbMessageId: savedMsg._id,
        },
      ]);
    }

    const newInvoice: SessionInvoice = {
      messageId: savedMsg._id,
      invoice: finalInvoice,
      status: "draft",
      dbMessageId: savedMsg._id,
      invoiceId: savedDraft?._id,
      invoiceNumber: savedDraft?.invoiceNumber,
    };

    // Only update session invoices and panel if user is still on this session
    if (currentSessionIdRef.current === sessionId) {
      setSessionInvoices((prev) => {
        const updated = [...prev, newInvoice];
        if (autoSelect)
          setSelectedPanelMessageId(updated[updated.length - 1].messageId);
        return updated;
      });
    }

    sessionInvoicesRef.current = [...sessionInvoicesRef.current, newInvoice];

    setActiveTab("draft");

    // Always show warning when a confirmed invoice already exists for same client+month.
    // suppressGenericMessage only hides the "draft ready" text — never the warning.
    // Multi-invoice batch: individual warnings show inline; consolidated check in multi_created.
    if (
      savedDraft?.hasSimilar &&
      savedDraft.similarInvoiceNumber &&
      currentSessionIdRef.current === sessionId
    ) {
      await addAIMessage(
        `⚠️ A confirmed invoice already exists for **${finalInvoice.clientName}** in **${savedDraft.similarInvoiceMonth}** (${savedDraft.similarInvoiceNumber}). This new draft is ${savedDraft.invoiceNumber}. Review both before confirming.`,
        sessionId
      );
    }

    // Return both savedDraft info and the message ID for reliable batch selection
    return { ...(savedDraft ?? {}), _msgId: savedMsg._id };
  };

  const applyEditAndShow = async (
    target: SessionInvoice,
    updatedInvoice: ParsedInvoice,
    message: string,
    sessionId: string
  ) => {
    if (target.status === "confirmed") {
      await addAIMessage(
        `⚠️ **${target.invoice.clientName}**'s invoice (${
          target.invoiceNumber ?? "confirmed"
        }) is already confirmed and cannot be edited via chat. Go to **All Invoices** to edit it directly.`,
        sessionId
      );
      return;
    }

    const finalInvoice = recalculateTotals(updatedInvoice);

    if (target.invoiceId) {
      try {
        await updateInvoice(target.invoiceId, finalInvoice);
      } catch (err) {
        console.error("Failed to update invoice in DB:", err);
      }
    }

    setSessionInvoices((prev) =>
      prev.map((s) =>
        s.messageId === target.messageId ? { ...s, invoice: finalInvoice } : s
      )
    );

    const sid = currentSessionIdRef.current;
    if (sid) {
      try {
        await updateMessageInvoiceData(sid, target.messageId, finalInvoice);
      } catch (err) {
        console.error("Failed to persist edit:", err);
      }
    }

    setSelectedPanelMessageId(target.messageId);
    await addAIMessage(message, sessionId);
  };

  const handleAgentResult = async (
    result: AgentResult,
    sessionId: string,
    originalPrompt: string
  ) => {
    const { action, message, invoice, invoices, invoicesWithMatch, targetRef } =
      result;

    switch (action) {
      case "created":
      case "copied": {
        if (!invoice) break;
        await addAIMessage(message, sessionId);
        await saveDraftAndShow(
          invoice,
          result.matchResult?.client ?? null,
          sessionId,
          originalPrompt,
          true,
          true
        );
        if (result.warning && currentSessionIdRef.current === sessionId) {
          await addAIMessage(`⚠️ ${result.warning}`, sessionId);
        }
        break;
      }

      case "needs_client": {
        if (!invoice) break;
        const matchType = result.matchResult?.type;

        if (isGenericClientName(invoice.clientName)) {
          setPending({
            status: "awaiting_client_name",
            sessionId,
            originalPrompt,
            invoice,
            clientName: invoice.clientName,
          });
          await addAIMessage(
            `Invoice of **${formatCurrency(
              invoice.total,
              invoice.currency
            )}** is ready!\n\nWhat's the client's name?`,
            sessionId
          );
          if (result.warning && currentSessionIdRef.current === sessionId) {
            await addAIMessage(`⚠️ ${result.warning}`, sessionId);
          }
          break;
        }

        if (matchType === "partial") {
          setPending({
            status: "awaiting_confirm_same",
            sessionId,
            originalPrompt,
            invoice,
            clientName: invoice.clientName,
            matchedClient: result.matchResult?.client ?? null,
          });
        } else {
          setPending({
            status: "awaiting_client_details",
            sessionId,
            originalPrompt,
            invoice,
            clientName: invoice.clientName,
          });
        }
        await addAIMessage(message, sessionId);
        break;
      }

      case "edited": {
        if (!invoice) {
          await addAIMessage(message, sessionId);
          break;
        }
        let matches = findMatchingInvoices(
          sessionInvoicesRef.current,
          targetRef ?? ""
        );
        // If no matches by targetRef, fall back to panel-selected or most recent draft
        if (matches.length === 0) {
          const drafts = sessionInvoicesRef.current.filter(
            (s) => s.status !== "confirmed"
          );
          if (drafts.length === 1) {
            matches = drafts;
          } else if (selectedPanelMessageId) {
            const panelMatch = sessionInvoicesRef.current.find(
              (s) =>
                s.messageId === selectedPanelMessageId &&
                s.status !== "confirmed"
            );
            if (panelMatch) matches = [panelMatch];
          } else if (drafts.length > 0) {
            matches = [drafts[drafts.length - 1]]; // most recent draft
          }
        }
        if (matches.length === 0) {
          await addAIMessage(message, sessionId);
          break;
        }
        if (matches.length === 1) {
          await applyEditAndShow(matches[0], invoice, message, sessionId);
          break;
        }
        // Multiple matches — but filter out confirmed ones first
        const editableMatches = matches.filter((m) => m.status !== "confirmed");
        if (editableMatches.length === 1) {
          await applyEditAndShow(
            editableMatches[0],
            invoice,
            message,
            sessionId
          );
          break;
        }
        // Still ambiguous
        setPending({
          status: "awaiting_edit_ambiguity",
          sessionId,
          originalPrompt,
          ambiguityInvoice: invoice,
          ambiguityTargetRef: targetRef,
        });
        const latest = [...matches].sort((a, b) =>
          b.dbMessageId.localeCompare(a.dbMessageId)
        )[0];
        const invoiceList = matches
          .map(
            (m) =>
              `**${m.invoiceNumber ?? "Draft"}** — ${
                m.invoice.invoiceMonth ?? "unknown"
              }${m.status === "confirmed" ? " (confirmed — cannot edit)" : ""}`
          )
          .join("\n");
        await addAIMessage(
          `Found **${
            matches.length
          } invoices** for **${targetRef}**:\n\n${invoiceList}\n\nWhich one should I update? Reply with an invoice number or **latest** for the most recent (${
            latest.invoiceNumber ?? "Draft"
          }).`,
          sessionId
        );
        break;
      }

      case "ambiguous": {
        setPending({
          status: "awaiting_ambiguity",
          sessionId,
          originalPrompt,
          ambiguityTargetRef: targetRef,
          ambiguitySourceRef: targetRef, // source client being copied from
          invoice: undefined,
        });
        await addAIMessage(message, sessionId);
        break;
      }

      case "multi_created": {
        await addAIMessage(message, sessionId);
        const items =
          invoicesWithMatch ??
          (invoices ?? []).map((inv) => ({
            invoice: inv,
            matchResult: { type: "none" as const, client: null, score: 0 },
          }));

        // Track the first saved message ID for auto-select.
        // Warnings are now emitted directly in saveDraftAndShow — no need to collect here.
        let firstBatchMessageId: string | null = null;

        for (const { invoice: inv, matchResult } of items) {
          const savedDraft = await saveDraftAndShow(
            inv,
            matchResult.type === "exact" ? matchResult.client : null,
            sessionId,
            originalPrompt,
            false, // no auto-select during batch
            true // suppress individual "draft ready" messages
          );

          if (!firstBatchMessageId && savedDraft?._msgId) {
            firstBatchMessageId = savedDraft._msgId;
          }
        }

        if (firstBatchMessageId && currentSessionIdRef.current === sessionId) {
          setSelectedPanelMessageId(firstBatchMessageId);
        } else if (currentSessionIdRef.current === sessionId) {
          // Fallback: use ref (may have race condition on first render)
          const allNow = sessionInvoicesRef.current;
          const batchStart = Math.max(0, allNow.length - items.length);
          const firstOfBatch = allNow[batchStart];
          if (firstOfBatch) setSelectedPanelMessageId(firstOfBatch.messageId);
        }
        break;
      }

      case "not_found":
      case "unclear":
      case "info":
      default:
        await addAIMessage(message, sessionId);
        break;
    }
  };

  const handlePendingReply = async (reply: string, sessionId: string) => {
    const current = pendingStateRef.current;
    if (!current || !user) return;

    const sessionContext = buildSessionContext(sessionInvoicesRef.current);

    const result = await parseInvoiceWithAI(
      reply,
      user.id,
      sessionContext,
      current.invoice || null,
      {
        status: current.status,
        clientName: current.clientName,
        invoice: current.invoice,
        originalPrompt: current.originalPrompt,
        matchedClient: current.matchedClient,
      }
    );

    // Backend wants to parse contact details (email/phone/address)
    if (
      result.action === "needs_client" &&
      result.message === "_parse_client_details_"
    ) {
      const rawDetails = result.rawClientDetails || reply;
      try {
        const parsed = await parseClientDetailsFromText(
          user.id,
          rawDetails,
          current.clientName!
        );
        setPending(null);
        await addAIMessage(
          parsed?.client
            ? `Saved **${current.clientName}**'s details ✓ Creating invoice now!`
            : `Creating invoice! You can add client details later.`,
          sessionId
        );
        await saveDraftAndShow(
          current.invoice!,
          parsed?.client ?? null,
          sessionId,
          current.originalPrompt,
          true,
          true
        );
        return;
      } catch {
        setPending(null);
        await addAIMessage(`Creating invoice now!`, sessionId);
        await saveDraftAndShow(
          current.invoice!,
          null,
          sessionId,
          current.originalPrompt,
          true,
          true
        );
        return;
      }
    }

    // Backend says needs_client with a new/corrected name — update pending
    if (result.action === "needs_client" && result.pendingClientName) {
      setPending({
        ...current,
        status: "awaiting_client_details",
        clientName: result.pendingClientName,
        invoice: result.invoice || current.invoice,
      });
      await addAIMessage(result.message, sessionId);
      return;
    }

    // Backend says needs_client (stay in flow — different client, etc.)
    if (result.action === "needs_client") {
      setPending({
        ...current,
        status: "awaiting_client_details",
        clientName: result.invoice?.clientName || current.clientName,
        invoice: result.invoice || current.invoice,
      });
      await addAIMessage(result.message, sessionId);
      return;
    }

    // Resolved — clear pending and handle normally
    setPending(null);
    await handleAgentResult(result, sessionId, current.originalPrompt);
  };

  const handleSend = async (prompt: string) => {
    if (!user) return;
    const tempId = Date.now().toString();
    addUserMessageToUI(prompt, tempId);
    setIsLoading(true);

    try {
      const sessionId = await ensureSession();
      const requestSessionId = sessionId;
      setLoadingSessionId(sessionId);

      const savedUserMsg = await addChatMessage(
        user.id,
        sessionId,
        "user",
        prompt
      );

      if (currentSessionIdRef.current === requestSessionId) {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === tempId
              ? { ...m, _id: savedUserMsg._id, dbMessageId: savedUserMsg._id }
              : m
          )
        );
      }

      if (pendingStateRef.current) {
        // ── If new prompt looks like a fresh invoice while awaiting client details,
        //    auto-dismiss the pending state and treat as a new invoice ──
        const looksLikeNewInvoice =
          /\b(invoice|bill|create)\b/i.test(prompt) &&
          /[$€₹]|\d/.test(prompt) &&
          pendingStateRef.current.status === "awaiting_client_details";

        if (looksLikeNewInvoice) {
          setPending(null); // dismiss current pending state silently
          // fall through to normal invoice creation below
        } else {
          await handlePendingReply(prompt, sessionId);
          loadSessions();
          return;
        }
      }

      //  pass sessionContext and let backend figure out everything ──
      const sessionContext = buildSessionContext(sessionInvoicesRef.current);

      const result = await parseInvoiceWithAI(prompt, user.id, sessionContext);
      await handleAgentResult(result, sessionId, prompt);
      loadSessions();
    } catch (err) {
      console.error("Failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          _id: Date.now().toString(),
          role: "assistant",
          content: "❌ Sorry, something went wrong. Please try again.",
          timestamp: getTime(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingSessionId(null);
    }
  };

  const handleConfirmFromPanel = async (messageId: string) => {
    if (!user || !currentSessionId) return;
    const si = sessionInvoices.find((s) => s.messageId === messageId);
    if (!si?.invoiceId) return;
    try {
      const confirmed = await confirmInvoice(si.invoiceId);
      await confirmInvoiceInMessage(
        currentSessionId,
        messageId,
        confirmed.invoiceNumber,
        si.invoiceId
      );
      setSessionInvoices((prev) =>
        prev.map((s) =>
          s.messageId === messageId
            ? {
                ...s,
                status: "confirmed",
                invoiceNumber: confirmed.invoiceNumber,
              }
            : s
        )
      );
      setSelectedPanelMessageId(messageId);
      setActiveTab("confirmed");
      setMessages((prev) =>
        prev.map((m) =>
          m.invoiceMessageId === messageId
            ? {
                ...m,
                status: "confirmed",
                invoiceNumber: confirmed.invoiceNumber,
              }
            : m
        )
      );
      const confirmContent = `✅ Invoice **${
        confirmed.invoiceNumber
      }** confirmed for **${si.invoice.clientName}**. Total: **${formatCurrency(
        si.invoice.total,
        si.invoice.currency
      )}**.`;
      const savedMsg = await addChatMessage(
        user.id,
        currentSessionId,
        "assistant",
        confirmContent
      );
      setMessages((prev) => [
        ...prev,
        {
          _id: savedMsg._id,
          role: "assistant",
          content: confirmContent,
          timestamp: getTime(),
        },
      ]);
    } catch (err) {
      console.error("Failed to confirm:", err);
    }
  };

  const handleEditFromPanel = async (
    messageId: string,
    updated: ParsedInvoice
  ) => {
    setSessionInvoices((prev) =>
      prev.map((s) =>
        s.messageId === messageId ? { ...s, invoice: updated } : s
      )
    );
    if (currentSessionId) {
      try {
        await updateMessageInvoiceData(currentSessionId, messageId, updated);
      } catch (err) {
        console.error("Failed to persist edit:", err);
      }
    }
  };

  const handleDiscardFromPanel = async (messageId: string) => {
    const si = sessionInvoices.find((s) => s.messageId === messageId);
    if (si?.invoiceId) {
      try {
        await deleteInvoice(si.invoiceId);
      } catch (err) {
        console.error("Failed to delete draft:", err);
      }
    }
    setSessionInvoices((prev) => {
      const updated = prev.filter((s) => s.messageId !== messageId);
      if (selectedPanelMessageId === messageId) {
        setSelectedPanelMessageId(
          updated.length > 0 ? updated[updated.length - 1].messageId : null
        );
      }
      return updated;
    });
    setMessages((prev) =>
      prev.map((m) =>
        m.invoiceMessageId === messageId
          ? {
              ...m,
              invoiceMessageId: undefined,
              status: undefined,
              invoiceNumber: undefined,
            }
          : m
      )
    );
  };

  const handleNewChat = async () => {
    if (!user) return;
    try {
      const session = await createChatSession(user.id);
      setSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session._id);
      setMessages([WELCOME]);
      setSessionInvoices([]);
      setSelectedPanelMessageId(null);
      setPanelTab(undefined);
      setPending(null);
      localStorage.removeItem(`ledger_session_${user.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteChatSession(user.id, sessionId);
      setSessions((prev) => prev.filter((s) => s._id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([WELCOME]);
        setSessionInvoices([]);
        setSelectedPanelMessageId(null);
        setPanelTab(undefined);
        setPending(null);
        localStorage.removeItem(`ledger_session_${user.id}`);
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  const handleLoadSession = async (session: ChatSessionAPI) => {
    if (!user) return;
    await loadMessagesForSession(user.id, session._id);
  };

  const scrollToMessage = (messageId: string) => {
    const el = messageRefs.current[messageId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // True only when the CURRENT session is processing a request
  const isCurrentSessionLoading =
    isLoading && loadingSessionId === currentSessionId;

  return {
    user,
    isLoading: isCurrentSessionLoading,
    loadingSessions,
    loadingMessages,
    sessions,
    currentSessionId,
    messages,
    sessionInvoices,
    selectedPanelMessageId,
    pendingState,
    panelTab,
    setPanelTab,
    bottomRef,
    messageRefs,
    handleSend,
    handleNewChat,
    handleDeleteSession,
    handleLoadSession,
    handleConfirmFromPanel,
    handleDiscardFromPanel,
    handleEditFromPanel,
    setSelectedPanelMessageId,
    setSessionInvoices,
    scrollToMessage,
  };
}
