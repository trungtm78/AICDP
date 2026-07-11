import type { RawIdentifier } from "../identity/identity.repo.js";

// Map payload shape Segment/RudderStack (track/identify) -> shape INBOUND webhook nội bộ
// (order_completed/identify) để tái dùng ingestInboundEvent. HÀM THUẦN, KHÔNG ném:
// mọi lỗi hình dạng để downstream (zod strict + ingestInboundEvent) bắt & ghi 'rejected'.
// brand_id KHÔNG có ở đây (ingestInboundEvent lấy từ connection — chống spoof).

type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Định danh từ userId/anonymousId (+ email/phone nếu có trong nguồn). */
function identifiers(p: Obj, extra: Obj | undefined): RawIdentifier[] {
  const out: RawIdentifier[] = [];
  const uid = str(p["userId"]);
  const aid = str(p["anonymousId"]);
  const email = str(extra?.["email"]);
  const phone = str(extra?.["phone"]);
  if (uid) out.push({ type: "pos_member_id", value: uid });
  if (aid) out.push({ type: "web_anonymous_id", value: aid });
  if (email) out.push({ type: "email", value: email });
  if (phone) out.push({ type: "phone", value: phone });
  return out;
}

function mapOrder(p: Obj, config: Obj): Obj {
  const props = (p["properties"] ?? {}) as Obj;
  const posTxn = str(props["order_id"]) ?? str(props["orderId"]) ?? str(props["checkout_id"]);
  const ids = identifiers(p, props);
  const properties: Obj = {
    // posTxn có thể undefined -> để zod strict báo thiếu (400) + ghi rejected.
    pos_transaction_id: posTxn,
    total: num(props["total"]) ?? num(props["revenue"]) ?? num(props["value"]),
  };
  const currency = str(props["currency"]);
  if (currency) properties["currency"] = currency;
  if (Array.isArray(props["products"])) properties["items"] = props["products"];

  const out: Obj = {
    type: "order_completed",
    store_id: str(props["store_id"]) ?? str(config["store_id"]) ?? "web",
    properties,
  };
  const ts = str(p["timestamp"]);
  if (ts) out["occ_timestamp"] = ts;
  if (ids.length > 0) out["identifiers"] = ids;
  return out;
}

function mapIdentify(p: Obj): Obj {
  const traitsIn = (p["traits"] ?? {}) as Obj;
  const ids = identifiers(p, traitsIn);
  const traits: Obj = {};
  const joined = [str(traitsIn["firstName"]), str(traitsIn["lastName"])].filter(Boolean).join(" ");
  const fullName = str(traitsIn["name"]) ?? (joined !== "" ? joined : undefined);
  if (fullName) traits["full_name"] = fullName;
  for (const k of ["email", "phone", "gender", "city"] as const) {
    const v = str(traitsIn[k]);
    if (v) traits[k] = v;
  }
  if (isYmd(traitsIn["birthday"])) traits["birth_date"] = traitsIn["birthday"];

  const out: Obj = { type: "identify", identifiers: ids };
  if (Object.keys(traits).length > 0) out["traits"] = traits;
  return out;
}

/**
 * Chuyển payload Segment -> shape inbound. Track chỉ nhận sự kiện đơn hàng (config.orderEvent |
 * mặc định 'Order Completed'); track khác -> type = tên sự kiện (downstream báo UNKNOWN + rejected).
 */
export function mapSegmentPayload(payload: unknown, config: Record<string, unknown>): unknown {
  const p = (payload ?? {}) as Obj;
  const type = p["type"];
  if (type === "identify") return mapIdentify(p);
  if (type === "track") {
    const event = str(p["event"]) ?? "";
    const orderEvent = str(config["orderEvent"]) ?? "Order Completed";
    if (event.trim().toLowerCase() === orderEvent.toLowerCase()) return mapOrder(p, config);
    return { type: event || "track" }; // không hỗ trợ -> UNKNOWN_EVENT_TYPE downstream
  }
  return { type: typeof type === "string" ? type : "unknown" };
}
