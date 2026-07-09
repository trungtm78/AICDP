import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brand";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-xs",
  secondary: "bg-surface text-text border border-border hover:bg-surface-hover",
  ghost: "text-text-muted hover:bg-surface-alt hover:text-text",
  danger: "bg-error text-white hover:brightness-95 shadow-xs",
  brand: "brand-gradient text-white shadow-sm hover:brightness-[1.05]",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem] gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-[0.9375rem] gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  label: string;
  children: ReactNode;
}

const ICON_SIZE: Record<Size, string> = { sm: "size-7 rounded-md", md: "size-9 rounded-md", lg: "size-11 rounded-lg" };

export function IconButton({ variant = "ghost", size = "md", label, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
