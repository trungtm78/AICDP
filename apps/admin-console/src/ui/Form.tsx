import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { cn } from "./cn.js";

const FIELD_BASE =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text transition-colors placeholder:text-text-subtle hover:border-border-strong focus:border-accent disabled:opacity-50";

export interface FieldProps {
  label?: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

/** Bọc label + control + hint/error. */
export function Field({ label, hint, error, required, children, htmlFor, className }: FieldProps) {
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-text-muted">
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : (
        hint && <p className="text-xs text-text-subtle">{hint}</p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
}

export function Input({ className, icon, ...rest }: InputProps) {
  if (icon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle">{icon}</span>
        <input className={cn(FIELD_BASE, "pl-9", className)} {...rest} />
      </div>
    );
  }
  return <input className={cn(FIELD_BASE, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_BASE, "cursor-pointer pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "h-auto min-h-[5rem] py-2 leading-relaxed", className)} {...rest} />;
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-pill transition-colors",
          checked ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-xs transition-all", checked ? "left-[1.125rem]" : "left-0.5")} />
      </button>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-text", disabled && "cursor-not-allowed opacity-50")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border-strong text-accent accent-accent"
      />
      {label}
    </label>
  );
}
