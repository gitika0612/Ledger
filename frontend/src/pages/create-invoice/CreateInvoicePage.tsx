import { ChatMessage } from "@/components/invoice/chat-mode/ChatMessage";
import { ChatInput } from "@/components/invoice/chat-mode/ChatInput";
import { TypingIndicator } from "@/components/invoice/TypingIndicator";
import { ChatSidebar } from "@/components/invoice/chat-mode/ChatSidebar";
import { InvoicePanel } from "@/components/invoice/InvoicePanel";
import { InvoiceMiniCard } from "@/components/invoice/InvoiceMiniCard";
import { useInvoiceChat } from "@/hooks/useInvoiceChat";

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
