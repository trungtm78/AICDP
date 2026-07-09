import { cn } from "./cn.js";

/** Mark "Convergence Node" — 5 thương hiệu hội tụ về 1 node (OCC ID hợp nhất). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} role="img" aria-label="OCC CDP">
      <defs>
        <linearGradient id="occ-mark" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="0.5" stopColor="#06B6D4" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#occ-mark)" />
      <g stroke="#fff" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round">
        <line x1="24" y1="24" x2="24" y2="11" />
        <line x1="24" y1="24" x2="36.4" y2="20" />
        <line x1="24" y1="24" x2="31.6" y2="34.5" />
        <line x1="24" y1="24" x2="16.4" y2="34.5" />
        <line x1="24" y1="24" x2="11.6" y2="20" />
      </g>
      <g fill="#fff">
        <circle cx="24" cy="11" r="2.5" />
        <circle cx="36.4" cy="20" r="2.5" />
        <circle cx="31.6" cy="34.5" r="2.5" />
        <circle cx="16.4" cy="34.5" r="2.5" />
        <circle cx="11.6" cy="20" r="2.5" />
      </g>
      <circle cx="24" cy="24" r="5.6" fill="#fff" />
      <circle cx="24" cy="24" r="2.7" fill="#2563EB" />
    </svg>
  );
}

/** Lockup logo = mark + wordmark "OCC CDP". */
export function Logo({ markSize = 28, className }: { markSize?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={markSize} />
      <span className="text-[0.975rem] font-bold tracking-tight text-text">
        OCC<span className="font-medium text-text-muted"> CDP</span>
      </span>
    </span>
  );
}
