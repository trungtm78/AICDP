import type { ReactNode } from "react";
import { cn } from "./cn.js";

type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "info" | "violet";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-alt text-text-muted border-border",
  accent: "bg-accent-subtle text-accent border-transparent",
  success: "bg-success-subtle text-success border-transparent",
  warning: "bg-warning-subtle text-warning border-transparent",
  error: "bg-error-subtle text-error border-transparent",
  info: "bg-info-subtle text-info border-transparent",
  violet: "bg-[#f2edfb] text-violet border-transparent",
};

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** StatusPill = badge + chấm/icon trạng thái (không chỉ dựa màu — WCAG). */
export function StatusPill({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {icon ?? <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
