import { cn } from "./cn.js";

/** Mark "Channel Hub" — lõi AI/CDP trung tâm + 6 kênh (email/SMS/Zalo/POS/web/app) kết nối vào. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} role="img" aria-label="AICDP">
      <defs>
        <linearGradient id="aicdp-mark" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4F46E5" />
          <stop offset="0.55" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#aicdp-mark)" />
      <g stroke="#fff" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round">
        <line x1="24" y1="24" x2="38" y2="24" />
        <line x1="24" y1="24" x2="31" y2="36.1" />
        <line x1="24" y1="24" x2="17" y2="36.1" />
        <line x1="24" y1="24" x2="10" y2="24" />
        <line x1="24" y1="24" x2="17" y2="11.9" />
        <line x1="24" y1="24" x2="31" y2="11.9" />
      </g>
      <g fill="#fff">
        <circle cx="38" cy="24" r="2.4" />
        <circle cx="31" cy="36.1" r="2.4" />
        <circle cx="17" cy="36.1" r="2.4" />
        <circle cx="10" cy="24" r="2.4" />
        <circle cx="17" cy="11.9" r="2.4" />
        <circle cx="31" cy="11.9" r="2.4" />
      </g>
      <circle cx="24" cy="24" r="6" fill="#fff" />
      <circle cx="24" cy="24" r="2.8" fill="#4F46E5" />
    </svg>
  );
}

/** Lockup logo = mark + wordmark "AICDP" (AI đậm + CDP nhạt). */
export function Logo({ markSize = 28, className }: { markSize?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={markSize} />
      <span className="text-[0.975rem] font-bold tracking-tight text-text">
        AI<span className="font-medium text-text-muted">CDP</span>
      </span>
    </span>
  );
}
