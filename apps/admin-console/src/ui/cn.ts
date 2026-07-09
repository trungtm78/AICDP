/** Ghép className, loại bỏ falsy. Nhẹ, không phụ thuộc thư viện ngoài. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
