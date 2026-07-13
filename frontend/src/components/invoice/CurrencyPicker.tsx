import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { CURRENCIES, getCurrencySymbol } from "@/lib/currencies";

/** A small, commonly-used subset shown first, before the rest of the ISO-4217 list. */
const COMMON_CURRENCY_CODES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "JPY",
];

interface CurrencyPickerProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Searchable currency picker covering every supported ISO-4217 currency.
 * Modeled after the invoice line-item UnitSelector for visual/interaction consistency.
 */
export function CurrencyPicker({
  value,
  onChange,
  disabled,
  className,
}: CurrencyPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? CURRENCIES.filter(
        (c) =>
          c.code.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query)
      )
    : CURRENCIES;

  const commonFirst = query
    ? filtered
    : [
        ...COMMON_CURRENCY_CODES.map((code) =>
          CURRENCIES.find((c) => c.code === code)
        ).filter((c): c is (typeof CURRENCIES)[number] => !!c),
        ...CURRENCIES.filter((c) => !COMMON_CURRENCY_CODES.includes(c.code)),
      ];

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full h-9 rounded-xl bg-gray-50 border border-gray-200 px-3 text-xs font-semibold text-gray-700 flex items-center justify-between gap-1 hover:border-indigo-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">
          {getCurrencySymbol(value)} {value}
        </span>
        <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search currency..."
              className="w-full text-xs px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-indigo-300"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {commonFirst.slice(0, 200).map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => handleSelect(c.code)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center justify-between gap-2 ${
                  value === c.code
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-gray-700"
                }`}
              >
                <span className="truncate">
                  {c.code} · {c.name}
                </span>
                <span className="text-gray-400 flex-shrink-0">
                  {getCurrencySymbol(c.code)}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">
                No currency found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
