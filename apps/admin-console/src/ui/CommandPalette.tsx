import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "./cn.js";
import { Kbd } from "./Kbd.js";

export interface CommandItem {
  id: string;
  label: string;
  group?: string;
  icon?: ReactNode;
  keywords?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
}

/** Command palette (Cmd/Ctrl+K) — điều hướng nhanh + hành động. */
export function CommandPalette({ open, onClose, items, placeholder = "Tìm workspace, hành động…" }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => (it.label + " " + (it.keywords ?? "") + " " + (it.group ?? "")).toLowerCase().includes(s));
  }, [q, items]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // focus sau khi mount
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[active];
      if (it) {
        it.onSelect();
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-lg" onKeyDown={onKey}>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-text-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="h-12 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-80 overflow-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-text-subtle">Không có kết quả cho “{q}”.</p>}
          {filtered.map((it, i) => (
            <button
              key={it.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                it.onSelect();
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm",
                i === active ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-alt",
              )}
            >
              {it.icon && <span className={cn(i === active ? "text-accent" : "text-text-subtle")}>{it.icon}</span>}
              <span className="flex-1">{it.label}</span>
              {it.group && <span className="text-xs text-text-subtle">{it.group}</span>}
              {i === active && <CornerDownLeft className="size-3.5 text-accent" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
