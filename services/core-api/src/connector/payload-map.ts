// Mapper INBOUND cấu hình được (field-path) — cho phép MỌI nguồn webhook (KiotViet/GHN/MISA/custom)
// POST payload NATIVE của họ; connection khai `config.payloadMapping` để rút field về shape CDP
// (order_completed/identify) rồi tái dùng ingestInboundEvent. HÀM THUẦN, KHÔNG ném (lỗi hình dạng
// để zod strict downstream bắt + ghi 'rejected'). brand_id vẫn TỪ connection (chống spoof).
//
// Quy ước spec field trong mapping:
//   - chuỗi bắt đầu '=' -> HẰNG (literal), vd "=web1".
//   - chuỗi khác -> DOT-PATH vào payload native, vd "data.customer.contactNumber" (hỗ trợ index số).
//   - eventType LUÔN là hằng ("order_completed" | "identify").

type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Obj)[k]),
    obj,
  );
}

/** Rút giá trị theo spec (hằng '=...' hoặc dot-path). undefined nếu không có / spec không phải chuỗi. */
function resolveField(raw: unknown, spec: unknown): unknown {
  if (typeof spec !== "string" || spec === "") return undefined;
  if (spec.startsWith("=")) return spec.slice(1);
  return getPath(raw, spec);
}

/** Chuyển giá trị timestamp bất kỳ -> ISO 8601; undefined nếu không parse được (service tự default now). */
function toIso(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function identifiersFrom(raw: unknown, m: Obj): Array<{ type: string; value: string }> {
  const out: Array<{ type: string; value: string }> = [];
  const phone = str(resolveField(raw, m["phone"]));
  const email = str(resolveField(raw, m["email"]));
  const member = str(resolveField(raw, m["member"]));
  if (phone) out.push({ type: "phone", value: phone });
  if (email) out.push({ type: "email", value: email });
  if (member) out.push({ type: "pos_member_id", value: member });
  return out;
}

export function applyPayloadMapping(raw: unknown, mapping: unknown): unknown {
  const m = (mapping ?? {}) as Obj;
  const eventType = typeof m["eventType"] === "string" ? (m["eventType"] as string) : "";

  if (eventType === "order_completed") {
    const properties: Obj = {
      pos_transaction_id: str(resolveField(raw, m["pos_transaction_id"])),
      total: num(resolveField(raw, m["total"])),
    };
    const currency = str(resolveField(raw, m["currency"]));
    if (currency) properties["currency"] = currency;
    const items = resolveField(raw, m["items"]);
    if (Array.isArray(items)) properties["items"] = items;

    const out: Obj = {
      type: "order_completed",
      store_id: str(resolveField(raw, m["store_id"])) ?? "webhook",
      properties,
    };
    const source = str(resolveField(raw, m["source"]));
    if (source) out["source"] = source;
    const ts = toIso(resolveField(raw, m["occ_timestamp"]));
    if (ts) out["occ_timestamp"] = ts;
    const ids = identifiersFrom(raw, m);
    if (ids.length > 0) out["identifiers"] = ids;
    return out;
  }

  if (eventType === "identify") {
    const traits: Obj = {};
    for (const k of ["full_name", "phone", "email", "gender", "city"] as const) {
      const v = str(resolveField(raw, m[k]));
      if (v) traits[k] = v;
    }
    const out: Obj = { type: "identify", identifiers: identifiersFrom(raw, m) };
    if (Object.keys(traits).length > 0) out["traits"] = traits;
    return out;
  }

  return { type: eventType || "unknown" }; // không hỗ trợ -> UNKNOWN_EVENT_TYPE downstream
}
