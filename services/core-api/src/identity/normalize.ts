// Chuẩn hóa định danh theo tracking-plan-spec v1 (mục 2).
// Sai chuẩn hóa = sai stitching danh tính → đây là phần correctness lõi.

export type IdentifierType =
  | "phone"
  | "email"
  | "loyalty_card"
  | "pos_member_id"
  | "web_anonymous_id"
  | "app_anonymous_id"
  | "social_lead_id";

export interface NormalizedIdentifier {
  type: IdentifierType;
  valueNormalized: string;
  /** Định danh mạnh (đủ để deterministic-merge) hay yếu (chỉ stitch khi user định danh). */
  isStrong: boolean;
}

export interface NormalizeOptions {
  /** Bắt buộc cho pos_member_id (scope theo brand). */
  brandId?: string;
  /** Bắt buộc cho social_lead_id (vd "facebook", "tiktok", "zalo"). */
  provider?: string;
}

const STRONG_TYPES: ReadonlySet<IdentifierType> = new Set([
  "phone",
  "email",
  "loyalty_card",
  "pos_member_id",
]);

// Mobile VN hợp lệ: 9 chữ số quốc gia, bắt đầu bằng 3/5/7/8/9.
const VN_MOBILE_NATIONAL = /^[35789]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trả về định danh đã chuẩn hóa, hoặc null nếu không hợp lệ (bị bỏ qua khi resolve). */
export function normalizeIdentifier(
  type: IdentifierType,
  value: string,
  opts: NormalizeOptions = {},
): NormalizedIdentifier | null {
  const isStrong = STRONG_TYPES.has(type);
  const raw = value ?? "";

  switch (type) {
    case "phone": {
      const national = toVnNationalNumber(raw);
      if (national === null) return null;
      return { type, valueNormalized: `+84${national}`, isStrong };
    }

    case "email": {
      const e = raw.trim().toLowerCase().normalize("NFC");
      if (!EMAIL_RE.test(e)) return null;
      return { type, valueNormalized: e, isStrong };
    }

    case "loyalty_card": {
      const v = raw.trim().toUpperCase();
      if (v.length === 0) return null;
      return { type, valueNormalized: v, isStrong };
    }

    case "pos_member_id": {
      const v = raw.trim();
      if (v.length === 0 || !opts.brandId) return null;
      return { type, valueNormalized: `${opts.brandId}:${v}`, isStrong };
    }

    case "social_lead_id": {
      const v = raw.trim();
      if (v.length === 0 || !opts.provider) return null;
      return { type, valueNormalized: `${opts.provider}:${v}`, isStrong };
    }

    case "web_anonymous_id":
    case "app_anonymous_id": {
      const v = raw.trim();
      if (v.length === 0) return null;
      return { type, valueNormalized: v, isStrong };
    }
  }
}

/** Trả 9 chữ số quốc gia VN (bỏ mã quốc gia/đầu 0), hoặc null nếu không hợp lệ. */
function toVnNationalNumber(input: string): string | null {
  const s = input.replace(/[\s().+-]/g, "");
  let national: string | null = null;
  if (s.startsWith("84")) national = s.slice(2);
  else if (s.startsWith("0")) national = s.slice(1);
  else national = s; // có thể đã là 9 số quốc gia
  if (national === null || !VN_MOBILE_NATIONAL.test(national)) return null;
  return national;
}
