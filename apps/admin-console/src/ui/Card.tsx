import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Nổi bật hơn (shadow-sm). Mặc định phẳng-hairline (airy nhưng gọn). */
  raised?: boolean;
  padded?: boolean;
}

export function Card({ raised = false, padded = true, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface",
        raised ? "shadow-sm" : "shadow-xs",
        padded && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Biến thiên: text đã format (vd "+12%"). */
  delta?: string | undefined;
  deltaTone?: "up" | "down" | "flat";
  hint?: string;
  /** Slot sparkline / mini-chart bên phải hoặc dưới. */
  chart?: ReactNode;
  /** Hero highlight: dùng gradient thương hiệu (chỉ 1 tile/màn). */
  hero?: boolean;
  /** data-testid đặt trên phần tử value (chứa đúng giá trị — cho E2E exact-text). */
  testid?: string;
}

const DELTA_TONE: Record<NonNullable<StatTileProps["deltaTone"]>, string> = {
  up: "text-success",
  down: "text-error",
  flat: "text-text-subtle",
};

export function StatTile({ label, value, icon, delta, deltaTone = "flat", hint, chart, hero = false, testid }: StatTileProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border p-4",
        hero ? "brand-gradient border-transparent text-white shadow-sm" : "border-border bg-surface shadow-xs",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("text-xs font-medium", hero ? "text-white/80" : "text-text-muted")}>{label}</div>
          <div data-testid={testid} className={cn("mt-1.5 text-2xl font-bold tracking-tight tabular", hero ? "text-white" : "text-text")}>
            {value}
          </div>
        </div>
        {icon && (
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg",
              hero ? "bg-white/20 text-white" : "bg-accent-subtle text-accent",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      {(delta || hint) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta && <span className={cn("font-semibold tabular", hero ? "text-white" : DELTA_TONE[deltaTone])}>{delta}</span>}
          {hint && <span className={cn(hero ? "text-white/70" : "text-text-subtle")}>{hint}</span>}
        </div>
      )}
      {chart && <div className="mt-3">{chart}</div>}
    </div>
  );
}
