import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  showSuggestions?: boolean;
  sessionId?: string | null;
}

const SUGGESTIONS = [
  "Invoice Priya for 5 days of Next.js work at ₹10k/day with 18% GST",
  "Bill Rahul for logo design, 3 revisions, ₹25,000 total",
  "Create invoice for Kartik of React consulting, 40 hours at ₹2,500/hr",
];

export function ChatInput({
  onSend,
  isLoading,
  showSuggestions = false,
  sessionId,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-100 bg-white px-4 py-4 flex-shrink-0">
      {/* Suggestions */}
      {showSuggestions && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Badge
              key={s}
              variant="outline"
              onClick={() => onSend(s)}
              className="cursor-pointer text-xs bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 transition-colors font-normal py-1 px-3 rounded-full"
            >
              {s.length > 50 ? s.slice(0, 50) + "..." : s}
            </Badge>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-3">
        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 transition-all">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Try: "Invoice Priya for 5 days of Next.js at ₹10k/day with 18% GST"'
            rows={1}
            disabled={isLoading}
            autoFocus={!isLoading}
            className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 resize-none border-0 focus:border-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 p-1 leading-relaxed shadow-none"
            style={{ maxHeight: "120px" }}
          />
        </div>

        <Button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          size="icon"
          className={`
            w-11 h-11 rounded-xl flex-shrink-0 transition-all duration-150
            ${
              input.trim() && !isLoading
                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
          style={
            input.trim() && !isLoading
              ? { boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }
              : {}
          }
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
