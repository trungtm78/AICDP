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

export const LIFECYCLE_LABEL: Record<string, string> = {
  new: "Mới", active: "Đang hoạt động", at_risk: "Có nguy cơ", vip: "VIP",
  dormant: "Ngủ đông", churned: "Đã rời", unknown: "Chưa rõ",
};
export const BRAND_LABEL: Record<string, string> = {
  givral: "Givral", kem_trang_tien: "Kem Tràng Tiền", hai_ha_kotobuki: "Hải Hà Kotobuki",
  fuji: "Fuji Foods", origato: "Origato",
};
export const CAT_LABEL: Record<string, string> = {
  banh: "Bánh", kem: "Kem", do_uong: "Đồ uống", qua_tang: "Quà tặng",
};
