import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn.js";
import { IconButton } from "./Button.js";

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function useEscClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/** Modal trung tâm. */
export function Modal({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  useEscClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface shadow-lg", className)}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
          <IconButton label="Đóng" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Drawer trượt từ phải (chi tiết / panel phụ). */
export function Drawer({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  useEscClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onClose} />
      <div className={cn("absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lg", className)}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
          <IconButton label="Đóng" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
