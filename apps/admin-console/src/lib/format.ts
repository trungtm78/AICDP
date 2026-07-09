// Định dạng số/tiền tệ dùng chung (vi-VN).
const nf = new Intl.NumberFormat("vi-VN");

export function fmtInt(n: number): string {
  return nf.format(Math.round(n));
}

/** Tiền VND rút gọn (tỷ/tr) — cho KPI/label chart. */
export function fmtVnd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} tỷ`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return nf.format(Math.round(n));
}

/** Tiền VND đầy đủ (dấu phân cách). */
export function fmtVndFull(n: number): string {
  return `${nf.format(Math.round(n))} ₫`;
}

export function fmtPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Ngày giờ rút gọn dd/MM HH:mm (vi-VN). */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const LIFECYCLE_LABEL: Record<string, string> = {
  new: "Mới", active: "Đang hoạt động", at_risk: "Có nguy cơ", vip: "VIP",
  dormant: "Ngủ đông", churned: "Đã rời", unknown: "Chưa rõ",
};
export const BRAND_LABEL: Record<string, string> = {
  givral: "Givral", kem_trang_tien: "Kem Tràng Tiền", fuji: "Fuji",
  sunrise_nha_trang: "Sunrise Nha Trang", starcity_nha_trang: "StarCity Nha Trang",
  dusit_hanoi: "Dusit Le Palais Tu Hoa",
};
export const CAT_LABEL: Record<string, string> = {
  banh: "Bánh", kem: "Kem", do_uong: "Đồ uống", qua_tang: "Quà tặng",
  dong_lanh: "Thực phẩm đông lạnh", luu_tru: "Lưu trú", am_thuc_dv: "Ẩm thực & Dịch vụ",
};

/**
 * Hạng khách hàng (loyalty tier) suy từ TỔNG CHI TIÊU tích luỹ (VND).
 * Kim cương ≥ 50tr · Vàng ≥ 15tr · Bạc ≥ 3tr · Đồng < 3tr (hiệu chỉnh theo phân bố thực tế).
 */
export type TierKey = "diamond" | "gold" | "silver" | "bronze";
export interface Tier { key: TierKey; label: string; color: string; min: number }
const TIERS: Tier[] = [
  { key: "diamond", label: "Kim cương", color: "#22b8cf", min: 50_000_000 },
  { key: "gold", label: "Vàng", color: "#c39851", min: 15_000_000 },
  { key: "silver", label: "Bạc", color: "#8a929e", min: 3_000_000 },
  { key: "bronze", label: "Đồng", color: "#b87333", min: 0 },
];
export function customerTier(totalSpend: number): Tier {
  return TIERS.find((t) => totalSpend >= t.min) ?? TIERS[TIERS.length - 1]!;
}
/** Ngưỡng chi tiêu để lên hạng kế tiếp (null nếu đã cao nhất). */
export function nextTier(totalSpend: number): Tier | null {
  const idx = TIERS.findIndex((t) => totalSpend >= t.min);
  return idx > 0 ? TIERS[idx - 1]! : null;
}
