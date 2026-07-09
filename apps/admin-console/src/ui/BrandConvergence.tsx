// Animation "hội tụ thương hiệu" — 6 thương hiệu OCH gửi dữ liệu về lõi OCH ID trung tâm.
// Truyền tải thông điệp CDP: nhiều thương hiệu → MỘT khách hàng hợp nhất. Dùng ở login hero.
// SVG thuần + CSS keyframes (index.css); tự dừng khi prefers-reduced-motion (guard toàn cục).

const GOLD = "#c39851";
const GOLD_SOFT = "rgba(195,152,81,0.9)";

// Khung vẽ + tâm lõi
const W = 440;
const H = 384;
const CX = 220;
const CY = 188;
const RX = 176;
const RY = 138;

// 6 thương hiệu OCH thật, xếp quanh lõi (bắt đầu từ đỉnh, theo chiều kim đồng hồ)
const BRANDS = [
  { short: "Givral", initials: "GV" },
  { short: "Kem Tràng Tiền", initials: "KTT" },
  { short: "Fuji", initials: "FJ" },
  { short: "Sunrise", initials: "SR" },
  { short: "StarCity", initials: "SC" },
  { short: "Dusit", initials: "DS" },
];

const NODES = BRANDS.map((b, i) => {
  const angle = (-90 + i * (360 / BRANDS.length)) * (Math.PI / 180);
  return { ...b, x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
});

/** Đồ hoạ động: luồng dữ liệu từ mỗi thương hiệu chạy về lõi OCH ID. */
export function BrandConvergence({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Sáu thương hiệu OCH hội tụ dữ liệu về một mã khách hàng OCH ID duy nhất"
      style={{ width: "100%", height: "auto", maxWidth: 460 }}
    >
      {/* Đường nối thương hiệu → lõi (mờ) */}
      {NODES.map((n, i) => (
        <line
          key={`line-${i}`}
          x1={n.x}
          y1={n.y}
          x2={CX}
          y2={CY}
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1.25}
        />
      ))}

      {/* Hạt dữ liệu chạy dọc đường nối về lõi (so le thời gian) */}
      {NODES.map((n, i) => (
        <circle
          key={`pulse-${i}`}
          r={3.4}
          fill={GOLD}
          cx={0}
          cy={0}
          style={{
            offsetPath: `path("M ${n.x} ${n.y} L ${CX} ${CY}")`,
            animation: `och-travel 2.6s linear ${(i * 0.42).toFixed(2)}s infinite`,
            filter: "drop-shadow(0 0 4px rgba(195,152,81,0.8))",
          }}
        />
      ))}

      {/* Node thương hiệu */}
      {NODES.map((n, i) => (
        <g
          key={`node-${i}`}
          style={{
            animation: `och-node-in 0.5s ease-out ${(0.15 + i * 0.1).toFixed(2)}s both`,
            transformOrigin: `${n.x}px ${n.y}px`,
          }}
        >
          <circle cx={n.x} cy={n.y} r={25} fill="rgba(20,17,25,0.55)" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
          <text
            x={n.x}
            y={n.y + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill="#ffffff"
            fontFamily="'Geist Variable', system-ui, sans-serif"
          >
            {n.initials}
          </text>
          <text
            x={n.x}
            y={n.y + 42}
            textAnchor="middle"
            fontSize={11}
            fill="rgba(255,255,255,0.72)"
            fontFamily="'Geist Variable', system-ui, sans-serif"
          >
            {n.short}
          </text>
        </g>
      ))}

      {/* Vòng xung nhịp quanh lõi */}
      {[0, 1].map((k) => (
        <circle
          key={`ring-${k}`}
          cx={CX}
          cy={CY}
          r={40}
          fill="none"
          stroke={GOLD_SOFT}
          strokeWidth={1.5}
          style={{
            transformOrigin: `${CX}px ${CY}px`,
            animation: `och-pulse 2.8s ease-out ${k * 1.4}s infinite`,
          }}
        />
      ))}

      {/* Lõi OCH ID trung tâm */}
      <g style={{ animation: "och-core-glow 3s ease-in-out infinite" }}>
        <circle cx={CX} cy={CY} r={40} fill="#2e2e40" stroke={GOLD} strokeWidth={2} />
        <text
          x={CX}
          y={CY - 3}
          textAnchor="middle"
          fontSize={17}
          fontWeight={800}
          fill="#ffffff"
          fontFamily="'Geist Variable', system-ui, sans-serif"
        >
          OCH
        </text>
        <text
          x={CX}
          y={CY + 15}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill={GOLD}
          letterSpacing={1.5}
          fontFamily="'Geist Variable', system-ui, sans-serif"
        >
          OCH ID
        </text>
      </g>
    </svg>
  );
}
