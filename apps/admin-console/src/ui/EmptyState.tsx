import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}

export function EmptyState({ icon, title, description, action, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center", className)}>
      {icon && (
        <span
          className={cn(
            "mb-3 grid size-12 place-items-center rounded-xl",
            tone === "error" ? "bg-error-subtle text-error" : "bg-surface-alt text-text-subtle",
          )}
        >
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
