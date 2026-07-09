import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Tabs kiểu underline (điều hướng nội dung trong màn). */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex items-center gap-1 border-b border-border", className)} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined && (
              <span className={cn("rounded-pill px-1.5 text-xs tabular", active ? "bg-accent-subtle text-accent" : "bg-surface-alt text-text-subtle")}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** SegmentedControl — chọn 1 trong vài lựa chọn ngắn (vd Ngày/Tuần/Tháng). */
export function SegmentedControl({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cn("inline-flex rounded-md border border-border bg-surface-alt p-0.5", className)} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1 text-[0.8125rem] font-medium transition-colors",
              active ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text",
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
