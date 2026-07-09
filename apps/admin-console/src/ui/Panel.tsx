import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** id cho E2E / anchor. */
  testid?: string;
}

/** Panel = card có header (title + actions) + body. Đơn vị bố cục chính của mỗi màn. */
export function Panel({ title, subtitle, icon, actions, children, className, bodyClassName, testid }: PanelProps) {
  return (
    <section
      data-testid={testid}
      className={cn("flex flex-col rounded-lg border border-border bg-surface shadow-xs", className)}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="truncate text-sm font-semibold text-text">{title}</h2>}
              {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Nhóm section nhỏ trong một panel/form. */
export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">{title}</h3>}
      {children}
    </div>
  );
}
