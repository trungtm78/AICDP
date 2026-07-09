import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Breadcrumb: mảng nhãn (workspace › mục). */
  breadcrumb?: string[];
  actions?: ReactNode;
  /** Badge ngữ cảnh (vd brand đang xem). */
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumb, actions, badge, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1 flex items-center gap-1.5 text-xs text-text-subtle">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-border-strong">/</span>}
                <span>{b}</span>
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold tracking-tight text-text">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Thanh công cụ ngang (filter/search/actions) — nền surface, hairline. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-xs", className)}>
      {children}
    </div>
  );
}
