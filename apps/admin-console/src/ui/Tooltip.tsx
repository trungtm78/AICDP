import { useState, type ReactNode } from "react";
import { cn } from "./cn.js";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

/** Tooltip nhẹ, hiện khi hover/focus. Không phụ thuộc portal (đủ dùng cho UI dày đặc). */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-alt px-2 py-1 text-xs font-medium text-text shadow-md",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
