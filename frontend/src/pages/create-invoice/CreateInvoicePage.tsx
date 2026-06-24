import { ChatMessage } from "@/components/invoice/chat-mode/ChatMessage";
import { ChatInput } from "@/components/invoice/chat-mode/ChatInput";
import { TypingIndicator } from "@/components/invoice/TypingIndicator";
import { ChatSidebar } from "@/components/invoice/chat-mode/ChatSidebar";
import { InvoicePanel } from "@/components/invoice/InvoicePanel";
import { InvoiceMiniCard } from "@/components/invoice/InvoiceMiniCard";
import { useInvoiceChat } from "@/hooks/useInvoiceChat";
import { SESSION_LIMIT } from "@/lib/invoice-chat/sessionHelpers";
import { AlertTriangle, Plus } from "lucide-react";

export function CreateInvoicePage() {
  const {
    user,
    isLoading,
    loadingSessions,
    loadingMessages,
    sessions,
    currentSessionId,
    messages,
    sessionInvoices,
    selectedPanelMessageId,
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
  } = useInvoiceChat();

  const isAtSessionLimit = sessionInvoices.length >= SESSION_LIMIT;

  return (
    <div className="h-screen bg-[#F9FAFB] flex overflow-hidden">
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        loadingSessions={loadingSessions}
        onNewChat={handleNewChat}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">
              Create Invoice
            </h1>
            <p className="text-xs text-gray-400">
              Describe your invoice in natural language
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg._id}
                ref={(el) => {
                  messageRefs.current[msg._id] = el;
                }}
              >
                <ChatMessage
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                />
                {msg.invoiceMessageId &&
                  (() => {
                    const si = sessionInvoices.find(
                      (s) => s.messageId === msg.invoiceMessageId
                    );
                    if (!si) return null;
                    return (
                      <div className="ml-11">
                        <InvoiceMiniCard
                          clientName={si.invoice.clientName}
                          total={si.invoice.total}
                          currency={si.invoice.currency}
                          status={si.status}
                          invoiceNumber={si.invoiceNumber}
                          onClick={() => {
                            setSelectedPanelMessageId(si.messageId);
                            scrollToMessage(msg._id);
                          }}
                        />
                      </div>
                    );
                  })()}
              </div>
            ))
          )}
          {isLoading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* ── Session limit banner ── */}
        {/* Shown as a system notice above the input, not as a chat message.
            Appears once the session hits the limit — stays visible until
            user starts a new chat. Editing existing invoices still works. */}
        {isAtSessionLimit && (
          <div className="mx-4 mb-2 flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <span className="flex-1">
              This session has reached{" "}
              <span className="font-semibold">{SESSION_LIMIT} invoices</span>.
              You can still edit existing ones, but new invoices require a fresh
              chat.
            </span>
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1 font-semibold text-amber-900 hover:text-amber-950 whitespace-nowrap"
            >
              <Plus className="w-3 h-3" />
              New chat
            </button>
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          showSuggestions={messages.length <= 1}
          sessionId={currentSessionId}
        />
      </div>

      <InvoicePanel
        sessionInvoices={sessionInvoices}
        selectedMessageId={selectedPanelMessageId}
        activeTab={panelTab}
        onTabChange={() => setPanelTab(undefined)}
        onConfirm={handleConfirmFromPanel}
        onDiscard={handleDiscardFromPanel}
        onEdit={handleEditFromPanel}
        onSelect={(messageId) => {
          setSelectedPanelMessageId(messageId);
          if (messageId) scrollToMessage(messageId);
        }}
        onSend={(messageId) => {
          setSessionInvoices((prev) =>
            prev.map((s) =>
              s.messageId === messageId ? { ...s, status: "sent" } : s
            )
          );
        }}
        userName={user?.fullName || user?.firstName || "Ledger User"}
      />
    </div>
  );
}
