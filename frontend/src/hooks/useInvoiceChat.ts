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

type BatchItem = {
  invoice: ParsedInvoice;
  matchResult: { type: string; client: ClientAPI | null; score: number };
};

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
  pendingBatch?: BatchItem[];
}

// ── Detects if a reply while awaiting client details is an invoice override ──
// e.g. "Add VAT 10%", "give 10% discount", "net 30", "add note: pay via bank"
function isInvoiceOverride(reply: string): boolean {
  const r = reply.toLowerCase().trim();
  return (
    /\b(vat|tax|gst)\s*\d/.test(r) || // "VAT 10%", "tax 18%", "gst 5%"
    /add\s+(vat|tax|gst)/.test(r) || // "add VAT 10%"
    /set\s+(vat|tax|gst)/.test(r) || // "set tax to 18%"
    /\d+%\s*(vat|tax|gst|off|discount)/.test(r) || // "10% VAT", "5% off"
    /\b(discount|off)\b/.test(r) || // "give 10% discount"
    /net\s*\d+/.test(r) || // "net 30"
    /payment\s*terms/.test(r) || // "payment terms 45 days"
    /\d+\s*days(\s*(payment|terms))?/.test(r) || // "30 days"
    /add\s+note/.test(r) || // "add note: ..."
    /remove\s+\w+/.test(r) // "remove item"
  );
}

// Human-readable summary when deterministic override is applied
function applyOverrideSummary(reply: string, invoice: ParsedInvoice): string {
  const currency = invoice.currency ?? "INR";
  const r = reply.toLowerCase();
  if (/vat|tax|gst/.test(r)) {
    const rate =
      currency === "INR" ? invoice.gstPercent : invoice.taxPercent ?? 0;
    const label =
      currency === "INR" ? "GST" : currency === "EUR" ? "VAT" : "Tax";
    const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
    if (invoice.isTaxInclusive) {
      return `Got it! ${label} ${rate}% back-calculated from total — subtotal: ${sym}${invoice.subtotal.toLocaleString(
        "en-IN"
      )}, ${label}: ${sym}${(
        invoice.taxAmount ??
        invoice.gstAmount ??
        0
      ).toLocaleString(
        "en-IN"
      )}, total stays ${sym}${invoice.total.toLocaleString("en-IN")}`;
    }
    return `Updated! ${label} ${rate}% applied → new total: ${sym}${invoice.total.toLocaleString(
      "en-IN"
    )}`;
  }
  if (/discount|off/.test(r)) {
    const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
    return `Discount applied → new total: ${sym}${invoice.total.toLocaleString(
      "en-IN"
    )}`;
  }
  if (/net|days|terms/.test(r)) {
    return `Payment terms updated to ${invoice.paymentTermsDays} days.`;
  }
  return "Updated invoice.";
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

    return { ...(savedDraft ?? {}), _msgId: savedMsg._id };
  };

  const saveMultiBatch = async (
    items: BatchItem[],
    sessionId: string,
    originalPrompt: string,
    resolvedClient?: ClientAPI | null
  ) => {
    let firstBatchMessageId: string | null = null;

    for (const { invoice: inv, matchResult } of items) {
      console.log("💾 saveMultiBatch item:", inv.clientName, inv.total);
      const client =
        resolvedClient !== undefined
          ? resolvedClient
          : matchResult.type === "exact"
          ? matchResult.client
          : null;

      const savedDraft = await saveDraftAndShow(
        inv,
        client,
        sessionId,
        originalPrompt,
        false,
        true
      );

      if (!firstBatchMessageId && savedDraft?._msgId) {
        firstBatchMessageId = savedDraft._msgId;
      }
    }

    if (firstBatchMessageId && currentSessionIdRef.current === sessionId) {
      setSelectedPanelMessageId(firstBatchMessageId);
    } else if (currentSessionIdRef.current === sessionId) {
      const allNow = sessionInvoicesRef.current;
      const batchStart = Math.max(0, allNow.length - items.length);
      const firstOfBatch = allNow[batchStart];
      if (firstOfBatch) setSelectedPanelMessageId(firstOfBatch.messageId);
    }

    if (currentSessionIdRef.current === sessionId) {
      await addAIMessage(
        `All ${items.length} invoice${
          items.length !== 1 ? "s" : ""
        } are ready. Review each one in the side panel.`,
        sessionId
      );
    }
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

    const sid = currentSessionIdRef.current;
    if (sid) {
      try {
        await updateMessageInvoiceData(sid, target.messageId, finalInvoice);
      } catch (err) {
        console.error("Failed to persist edit:", err);
      }
    }

    setSessionInvoices((prev) =>
      prev.map((s) =>
        s.messageId === target.messageId ? { ...s, invoice: finalInvoice } : s
      )
    );

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

        // ── Find matching invoice in session ──
        let matches = findMatchingInvoices(
          sessionInvoicesRef.current,
          targetRef ?? ""
        );

        if (matches.length === 0) {
          const drafts = sessionInvoicesRef.current.filter(
            (s) => s.status !== "confirmed"
          );

          // Only fall back to a draft when NO specific client/invoice was targeted.
          // If a specific client (targetRef) was mentioned but not found in session,
          // do NOT fall back — that would edit the wrong invoice.
          const hasSpecificTarget = (targetRef ?? "").trim().length > 0;

          if (!hasSpecificTarget && drafts.length === 1) {
            matches = drafts;
          } else if (!hasSpecificTarget && selectedPanelMessageId) {
            const panelMatch = sessionInvoicesRef.current.find(
              (s) =>
                s.messageId === selectedPanelMessageId &&
                s.status !== "confirmed"
            );
            if (panelMatch) matches = [panelMatch];
          } else if (!hasSpecificTarget && drafts.length > 0) {
            matches = [drafts[drafts.length - 1]];
          }
        }

        // No match found — show not-found message and stop
        if (matches.length === 0) {
          const notFoundMsg =
            (targetRef ?? "").trim().length > 0
              ? `I couldn't find an invoice for **${targetRef}** in this session. Check the side panel or specify an invoice number (e.g. INV-2026-001).`
              : message;
          await addAIMessage(notFoundMsg, sessionId);
          break;
        }

        if (matches.length === 1) {
          await applyEditAndShow(matches[0], invoice, message, sessionId);
          break;
        }

        // Multiple matches — filter confirmed ones first
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

        // Still ambiguous — ask user
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
        const destinationClientName =
          extractDestinationClientFromPrompt(originalPrompt);
        setPending({
          status: "awaiting_ambiguity",
          sessionId,
          originalPrompt,
          ambiguityTargetRef: targetRef,
          ambiguitySourceRef: targetRef,
          clientName: destinationClientName,
          invoice: undefined,
        });
        await addAIMessage(message, sessionId);
        break;
      }

      case "multi_created": {
        const items: BatchItem[] =
          invoicesWithMatch ??
          (invoices ?? []).map((inv) => ({
            invoice: inv,
            matchResult: { type: "none" as const, client: null, score: 0 },
          }));

        const firstUnresolved = items.find(
          (item) => item.matchResult.type !== "exact"
        );

        if (firstUnresolved) {
          const clientName = firstUnresolved.invoice.clientName;
          const summaryMessage = message
            .replace(/\n*Review each invoice in the side panel\.?/i, "")
            .trimEnd();

          if (isGenericClientName(clientName)) {
            setPending({
              status: "awaiting_client_name",
              sessionId,
              originalPrompt,
              invoice: firstUnresolved.invoice,
              clientName,
              pendingBatch: items,
            });
            await addAIMessage(
              `${summaryMessage}\n\nWhat's the client's name for these invoices?`,
              sessionId
            );
            break;
          }

          if (firstUnresolved.matchResult.type === "partial") {
            setPending({
              status: "awaiting_confirm_same",
              sessionId,
              originalPrompt,
              invoice: firstUnresolved.invoice,
              clientName,
              matchedClient: firstUnresolved.matchResult.client ?? null,
              pendingBatch: items,
            });
            await addAIMessage(
              `${summaryMessage}\n\nI found a saved client named **${firstUnresolved.matchResult.client?.name}**.\nIs **${clientName}** the same client? Reply **same** or **different**.`,
              sessionId
            );
          } else {
            setPending({
              status: "awaiting_client_details",
              sessionId,
              originalPrompt,
              invoice: firstUnresolved.invoice,
              clientName,
              pendingBatch: items,
            });
            await addAIMessage(
              `${summaryMessage}\n\nPlease share **${clientName}**'s contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr say **skip**.`,
              sessionId
            );
          }
          break;
        }

        await addAIMessage(message, sessionId);
        await saveMultiBatch(items, sessionId, originalPrompt);
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

  function extractDestinationClientFromPrompt(
    prompt: string
  ): string | undefined {
    const ALL_MONTHS = new Set([
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
      "jan",
      "feb",
      "mar",
      "apr",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ]);
    const STOP_WORDS = new Set([
      "invoice",
      "bill",
      "same",
      "last",
      "previous",
      "month",
      "this",
      "that",
      "the",
      "a",
      "an",
      "with",
      "and",
      "or",
      "but",
      "for",
      "to",
      "from",
      "in",
      "on",
      "at",
      "of",
      "copy",
      "create",
      "make",
      "generate",
      "next",
      "again",
      "work",
      "time",
      "before",
      "new",
      "client",
      "named",
      ...Array.from(ALL_MONTHS),
    ]);

    const specificPatterns: RegExp[] = [
      /but\s+for\s+(?:(?:a\s+)?new\s+)?(?:client\s+)?(?:named\s+)?([A-Za-z]+)\s*$/i,
      /but\s+for\s+(?:(?:a\s+)?new\s+)?(?:client\s+)?(?:named\s+)?([A-Za-z]+)/i,
      /for\s+(?:a\s+)?new\s+client\s+(?:named\s+)?([A-Za-z]+)/i,
      /client\s+(?:named\s+)?([A-Za-z]+)\s*$/i,
      /named\s+([A-Za-z]+)\s*$/i,
      /for\s+([A-Za-z]+)\s*$/i,
    ];

    for (const pattern of specificPatterns) {
      const match = prompt.match(pattern);
      const candidate = match?.[1]?.trim();
      if (candidate && !STOP_WORDS.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return undefined;
  }

  const handlePendingReply = async (reply: string, sessionId: string) => {
    const current = pendingStateRef.current;
    if (!current || !user) return;

    // ── Invoice override while awaiting client details ──
    // When user is in awaiting_client_details flow but types an invoice
    // modification (e.g. "Add VAT 10%", "give 10% discount", "net 30"),
    // apply it to the pending invoice and re-ask for client details.
    if (
      current.status === "awaiting_client_details" &&
      current.invoice &&
      isInvoiceOverride(reply)
    ) {
      // Try AI edit first
      const sessionContext = buildSessionContext(sessionInvoicesRef.current);
      const overrideResult = await parseInvoiceWithAI(
        reply,
        user.id,
        sessionContext,
        current.invoice,
        {
          status: "awaiting_client_details",
          clientName: current.clientName,
          invoice: current.invoice,
          originalPrompt: current.originalPrompt,
        }
      );

      // Get updated invoice — from AI edit result OR apply deterministically
      let updatedInvoice: ParsedInvoice | null =
        overrideResult.action === "edited" && overrideResult.invoice
          ? overrideResult.invoice
          : null;

      // Deterministic fallback: if AI didn't return an edit,
      // apply common overrides directly so they are never lost
      if (!updatedInvoice) {
        const r = reply.toLowerCase().trim();
        let patched = { ...current.invoice };

        // VAT/Tax/GST rate change: "add 10% VAT", "set tax 18%", "VAT 10%", "20% VAT"
        const taxMatch =
          r.match(/(\d+(?:\.\d+)?)\s*%?\s*(vat|tax|gst)/i) ||
          r.match(/(vat|tax|gst)\s*[a-z\s]*?(\d+(?:\.\d+)?)/i);
        if (taxMatch) {
          const rate = parseFloat(taxMatch[1] ?? taxMatch[2]);
          if (!isNaN(rate)) {
            const currency = patched.currency ?? "INR";
            // wasInclusive = true only if invoice was explicitly inclusive WITH a warning
            // (meaning isTaxInclusive=true AND no rate was set yet).
            // If isTaxInclusive=true but taxPercent/gstPercent already has a value,
            // the rate was already known — this is a rate-change edit, not an initial clarification.
            // If isTaxInclusive=false, always add-on.
            const inv = current.invoice!;
            const existingRate =
              currency === "INR" ? inv.gstPercent ?? 0 : inv.taxPercent ?? 0;
            // Only back-calculate if invoice was marked inclusive AND no rate set yet
            const wasInclusive =
              inv.isTaxInclusive === true && existingRate === 0;
            console.log("🔍 Override tax check:", {
              isTaxInclusive: inv.isTaxInclusive,
              existingRate,
              wasInclusive,
              rate,
              currency,
              total: inv.total,
            });

            if (currency === "INR") {
              if (wasInclusive) {
                // Back-calculate: total stays the same, find pre-tax subtotal
                const statedTotal = current.invoice!.total;
                const preTax = Math.round((statedTotal * 100) / (100 + rate));
                const gstAmount = statedTotal - preTax;
                patched = {
                  ...patched,
                  gstPercent: rate,
                  isTaxInclusive: true,
                  lineItems: [
                    { ...patched.lineItems[0], amount: preTax, rate: preTax },
                  ],
                  subtotal: preTax,
                  taxableAmount: preTax,
                  gstAmount,
                  cgstAmount: Math.round(gstAmount / 2),
                  sgstAmount: gstAmount - Math.round(gstAmount / 2),
                  igstAmount: 0,
                  total: statedTotal,
                };
                return; // skip recalculateTotals — values already correct
              } else {
                patched = { ...patched, gstPercent: rate };
              }
            } else {
              if (wasInclusive) {
                // Back-calculate: total stays the same
                const statedTotal = current.invoice!.total;
                const preTax = Math.round((statedTotal * 100) / (100 + rate));
                const taxAmount = statedTotal - preTax;
                patched = {
                  ...patched,
                  taxPercent: rate,
                  taxLabel: currency === "EUR" ? "VAT" : "Tax",
                  isTaxInclusive: true,
                  lineItems: [
                    { ...patched.lineItems[0], amount: preTax, rate: preTax },
                  ],
                  subtotal: preTax,
                  taxableAmount: preTax,
                  taxAmount,
                  total: statedTotal,
                };
                updatedInvoice = patched as ParsedInvoice;
                // Skip the recalculateTotals below — already computed
                const editMsg = applyOverrideSummary(reply, updatedInvoice);
                setPending({
                  ...current,
                  invoice: updatedInvoice,
                  pendingBatch: current.pendingBatch
                    ? current.pendingBatch.map((item) => ({
                        ...item,
                        invoice:
                          item.invoice.clientName === current.clientName
                            ? { ...item.invoice, ...updatedInvoice! }
                            : item.invoice,
                      }))
                    : current.pendingBatch,
                });
                await addAIMessage(
                  `${editMsg}

Please share **${current.clientName}**'s contact details:

**Email** *(required)*
*(Optional: Address, City, State, Phone, GSTIN)*

Or type **skip** to continue without details.`,
                  sessionId
                );
                return;
              } else {
                patched = {
                  ...patched,
                  taxPercent: rate,
                  taxLabel: currency === "EUR" ? "VAT" : "Tax",
                };
              }
            }
          }
        }

        // Discount: "10% discount", "give 10% off"
        const discountMatch = r.match(/(\d+(?:\.\d+)?)\s*%\s*(off|discount)/i);
        if (discountMatch) {
          const val = parseFloat(discountMatch[1]);
          if (!isNaN(val)) {
            patched = {
              ...patched,
              discountType: "percent",
              discountValue: val,
            };
          }
        }

        // Payment terms: "net 30", "30 days"
        const termsMatch =
          r.match(/(?:net\s*|payment\s*terms?\s*)(\d+)/i) ||
          r.match(/(\d+)\s*days/i);
        if (termsMatch) {
          const days = parseInt(termsMatch[1]);
          if (!isNaN(days)) {
            patched = { ...patched, paymentTermsDays: days };
          }
        }

        updatedInvoice = recalculateTotals(patched);
      }

      const editMessage =
        overrideResult.action === "edited"
          ? overrideResult.message
          : applyOverrideSummary(reply, updatedInvoice!);

      setPending({
        ...current,
        invoice: updatedInvoice!,
        pendingBatch: current.pendingBatch
          ? current.pendingBatch.map((item) => ({
              ...item,
              invoice:
                item.invoice.clientName === current.clientName
                  ? { ...item.invoice, ...updatedInvoice! }
                  : item.invoice,
            }))
          : current.pendingBatch,
      });
      await addAIMessage(
        `${editMessage}\n\nPlease share **${current.clientName}**'s contact details:\n\n**Email** *(required)*\n*(Optional: Address, City, State, Phone, GSTIN)*\n\nOr type **skip** to continue without details.`,
        sessionId
      );
      return;
    }

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

    if (current.status === "awaiting_ambiguity") {
      if (result.action === "copied" || result.action === "created") {
        setPending(null);
        await handleAgentResult(result, sessionId, current.originalPrompt);
        return;
      }
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
      if (result.action === "ambiguous") {
        await addAIMessage(result.message, sessionId);
        return;
      }
      if (result.action === "not_found" || result.action === "unclear") {
        await addAIMessage(result.message, sessionId);
        return;
      }
    }

    const remapBatchNames = (
      batch: BatchItem[],
      name: string,
      onlyClient?: string
    ): BatchItem[] =>
      batch.map((item) => ({
        ...item,
        invoice: {
          ...item.invoice,
          clientName:
            !onlyClient || item.invoice.clientName === onlyClient
              ? name
              : item.invoice.clientName,
        },
      }));
    if (
      result.action === "needs_client" &&
      result.message === "_parse_client_details_"
    ) {
      const rawDetails = result.rawClientDetails || reply;
      const resolvedName = current.clientName ?? "";
      try {
        const parsed = await parseClientDetailsFromText(
          user.id,
          rawDetails,
          current.clientName!
        );
        setPending(null);
        await addAIMessage(
          parsed?.client
            ? `Saved **${current.clientName}**'s details ✓ Creating invoice${
                current.pendingBatch ? "s" : ""
              } now!`
            : `Creating invoice${
                current.pendingBatch ? "s" : ""
              }! You can add client details later.`,
          sessionId
        );
        if (current.pendingBatch) {
          const namedBatch = resolvedName
            ? remapBatchNames(
                current.pendingBatch,
                resolvedName,
                current.clientName
              )
            : current.pendingBatch;
          await saveMultiBatch(
            namedBatch,
            sessionId,
            current.originalPrompt,
            parsed?.client ?? null
          );
        } else {
          await saveDraftAndShow(
            current.invoice!,
            parsed?.client ?? null,
            sessionId,
            current.originalPrompt,
            true,
            true
          );
        }
        return;
      } catch {
        setPending(null);
        await addAIMessage(
          `Creating invoice${current.pendingBatch ? "s" : ""} now!`,
          sessionId
        );
        if (current.pendingBatch) {
          const namedBatch = resolvedName
            ? remapBatchNames(
                current.pendingBatch,
                resolvedName,
                current.clientName
              )
            : current.pendingBatch;
          await saveMultiBatch(
            namedBatch,
            sessionId,
            current.originalPrompt,
            null
          );
        } else {
          await saveDraftAndShow(
            current.invoice!,
            null,
            sessionId,
            current.originalPrompt,
            true,
            true
          );
        }
        return;
      }
    }

    if (result.action === "needs_client" && result.pendingClientName) {
      const newName = result.pendingClientName;
      setPending({
        ...current,
        status: "awaiting_client_details",
        clientName: newName,
        invoice: result.invoice
          ? { ...result.invoice, clientName: newName }
          : current.invoice
          ? { ...current.invoice, clientName: newName }
          : current.invoice,
        pendingBatch: current.pendingBatch
          ? remapBatchNames(current.pendingBatch, newName, current.clientName)
          : current.pendingBatch,
      });
      await addAIMessage(result.message, sessionId);
      return;
    }

    if (result.action === "needs_client") {
      const newName = result.invoice?.clientName || current.clientName;
      setPending({
        ...current,
        status: "awaiting_client_details",
        clientName: newName,
        invoice: result.invoice || current.invoice,
        pendingBatch:
          current.pendingBatch && newName
            ? remapBatchNames(current.pendingBatch, newName, current.clientName)
            : current.pendingBatch,
      });
      await addAIMessage(result.message, sessionId);
      return;
    }

    setPending(null);

    if (
      current.pendingBatch &&
      (result.action === "created" || result.action === "copied")
    ) {
      const resolvedClient = result.matchResult?.client ?? null;
      const resolvedName =
        result.invoice?.clientName ||
        result.matchResult?.client?.name ||
        current.clientName;
      const updatedBatch = resolvedName
        ? remapBatchNames(
            current.pendingBatch,
            resolvedName,
            current.clientName
          )
        : current.pendingBatch;
      await addAIMessage(result.message, sessionId);
      await saveMultiBatch(
        updatedBatch,
        sessionId,
        current.originalPrompt,
        resolvedClient
      );
      return;
    }

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
        const looksLikeNewInvoice =
          /\b(invoice|bill|create)\b/i.test(prompt) &&
          /[$€₹]|\d/.test(prompt) &&
          pendingStateRef.current.status === "awaiting_client_details";

        if (looksLikeNewInvoice) {
          setPending(null);
        } else {
          await handlePendingReply(prompt, sessionId);
          loadSessions();
          return;
        }
      }

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
