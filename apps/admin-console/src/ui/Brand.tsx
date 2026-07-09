import { cn } from "./cn.js";
import { useTheme } from "./ThemeProvider.js";

// Logo OCH thật (asset gốc och.vn). Bản navy cho nền sáng; bản trắng cho nền tối.
function ochSrc(theme: string): string {
  return theme === "dark" ? "/och-logo-light.png" : "/och-logo.png";
}

/** Chỉ logo OCH — topbar/login. */
export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  const { theme } = useTheme();
  return (
    <img src={ochSrc(theme)} alt="OCH" style={{ height: size, width: "auto" }} className={className} draggable={false} />
  );
}

/** Lockup: logo OCH + phụ đề "Customer Data Platform". */
export function Logo({ markSize = 28, className }: { markSize?: number; className?: string }) {
  const { theme } = useTheme();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src={ochSrc(theme)} alt="OCH — Customer Data Platform" style={{ height: markSize, width: "auto" }} draggable={false} />
      <span className="hidden border-l border-border pl-2.5 text-[0.62rem] font-semibold uppercase leading-tight tracking-wider text-text-subtle sm:inline">
        Customer<br />Data Platform
      </span>
    </span>
  );
}
