import { safeFetch } from "../http-client.js";
import { AppError } from "../../http/errors.js";
import { applyPayloadMapping, getPath } from "../payload-map.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { InboundPullAdapter, PulledEvent, OutboundDeps } from "./types.js";

// Adapter INBOUND-pull generic REST/OData (ERP: SAP/Oracle/…). GET phân trang qua safeFetch
// (SSRF-safe + pin IP), rút mảng record theo recordsPath, map từng record qua payloadMapping ->
// order_completed/identify, rồi runner (inbound-pull.service) nạp + tiến cursor. Lỗi giữa trang ->
// KHÔNG tiến (re-pull trang, ingest idempotent theo message_id) — không mất dữ liệu.
//
// BẢO MẬT: nextLink (do SERVER trả) BẮT BUỘC cùng-origin với endpoint (cả input cursor lẫn response)
// -> chống rò Authorization token ra host ngoài + chống poison cursor. authHeaderName validate token.
// Cap số record/trang (chống DoS map/ingest). config: endpoint, mode('odata'|'offset'), recordsPath,
// nextLinkPath, payloadMapping, authType, apiKey(secret), authHeaderName, pageSize, offsetParam, limitParam.

interface RestDefaults { recordsPath: string; nextLinkPath: string; mode: string }
const PRESETS: Record<string, RestDefaults> = {
  src_rest: { recordsPath: "value", nextLinkPath: "@odata.nextLink", mode: "odata" },
  src_sap: { recordsPath: "d.results", nextLinkPath: "d.__next", mode: "odata" }, // SAP OData v2
  src_oracle: { recordsPath: "items", nextLinkPath: "@odata.nextLink", mode: "odata" }, // Oracle REST
};

const MAX_PAGE = 500;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

function misconfigured(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: msg,
    why: "Cấu hình REST/OData chưa hợp lệ.", fix: "Kiểm tra endpoint/payloadMapping/auth của connection.", retryable: false,
  });
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** Lấy field theo path: ưu tiên KEY LITERAL (vd '@odata.nextLink' có dấu chấm trong tên) rồi mới
 *  dot-path lồng (vd 'd.results'/'d.__next'). hasOwnProperty -> không chạm prototype (an toàn). */
function getField(json: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(json, path)) return json[path];
  return getPath(json, path);
}

/** Resolve link (tuyệt đối HOẶC tương đối theo OData) về URL tuyệt đối + BẮT BUỘC cùng-origin base. */
function resolveSameOrigin(link: string, base: string): string {
  let abs: string;
  try { abs = new URL(link, base).toString(); } catch { throw misconfigured("URL trang không hợp lệ."); }
  if (!sameOrigin(abs, base)) throw misconfigured("nextLink khác origin với endpoint — từ chối (chống rò token/poison).");
  return abs;
}

function authHeaders(config: Record<string, unknown>): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const apiKey = str(config["apiKey"]);
  const authType = str(config["authType"]) ?? (apiKey ? "bearer" : "none");
  if (authType === "bearer" && apiKey) {
    h["authorization"] = `Bearer ${apiKey}`;
  } else if (authType === "header" && apiKey) {
    const name = (str(config["authHeaderName"]) ?? "x-api-key").toLowerCase();
    if (!HEADER_NAME_RE.test(name)) throw misconfigured("authHeaderName không hợp lệ (chỉ [A-Za-z0-9-]).");
    h[name] = apiKey;
  }
  return h;
}

async function restPull(
  config: Record<string, unknown>,
  cursor: Record<string, unknown> | null,
  deps: OutboundDeps | undefined,
  defaults: RestDefaults,
): Promise<{ events: PulledEvent[]; nextCursor: Record<string, unknown> | null }> {
  const endpoint = str(config["endpoint"]);
  if (!endpoint) throw misconfigured("Thiếu endpoint REST/OData.");
  const mapping = config["payloadMapping"];
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw misconfigured("Thiếu payloadMapping hợp lệ.");
  const recordsPath = str(config["recordsPath"]) ?? defaults.recordsPath;
  const nextLinkPath = str(config["nextLinkPath"]) ?? defaults.nextLinkPath;
  const mode = str(config["mode"]) ?? defaults.mode;
  const pageSize = Math.min(MAX_PAGE, Math.max(1, Number(config["pageSize"]) || 100));
  const headers = authHeaders(config);

  // URL trang cần lấy.
  let url: string;
  let offset = 0;
  if (mode === "odata") {
    const nextLink = cursor && str(cursor["nextLink"]);
    url = nextLink ? resolveSameOrigin(nextLink, endpoint) : endpoint; // cùng-origin, resolve relative
  } else {
    offset = Number(cursor?.["offset"]) || 0;
    const sep = endpoint.includes("?") ? "&" : "?";
    const offsetParam = str(config["offsetParam"]) ?? "$skip";
    const limitParam = str(config["limitParam"]) ?? "$top";
    url = `${endpoint}${sep}${encodeURIComponent(offsetParam)}=${offset}&${encodeURIComponent(limitParam)}=${pageSize}`;
  }

  const res = await safeFetch(url, fetchOpts({ method: "GET", headers }, deps));
  if (!res.ok) throw misconfigured(`Nguồn REST trả HTTP ${res.status}.`);
  let json: Record<string, unknown>;
  try { json = JSON.parse(res.body) as Record<string, unknown>; } catch { throw misconfigured("Nguồn REST trả body không phải JSON."); }

  const recordsRaw = getField(json, recordsPath);
  const records = Array.isArray(recordsRaw) ? recordsRaw : [];
  // Cap số record/trang: chống endpoint độc trả rất nhiều record nhỏ (<2MB) gây DoS map/ingest.
  if (records.length > MAX_PAGE) throw misconfigured(`Trang trả quá nhiều record (>${MAX_PAGE}) — cấu hình $top/pageSize ở nguồn.`);
  const events: PulledEvent[] = records.map((rec) => {
    const data = applyPayloadMapping(rec, mapping) as { type: "order_completed" | "identify" };
    return { type: data.type, data };
  });

  // Cursor trang kế: OData theo nextLinkPath (đã validate cùng-origin để KHÔNG poison cursor); offset theo số record.
  let nextCursor: Record<string, unknown> | null = null;
  if (mode === "odata") {
    const nl = str(getField(json, nextLinkPath));
    nextCursor = nl ? { nextLink: resolveSameOrigin(nl, endpoint) } : null;
  } else {
    nextCursor = records.length >= pageSize ? { offset: offset + records.length } : null;
  }
  return { events, nextCursor };
}

/** Adapter REST/OData cho 1 connectorKey (preset SAP/Oracle: default recordsPath/nextLinkPath riêng). */
export function makeRestInboundAdapter(key: string): InboundPullAdapter {
  const defaults = PRESETS[key] ?? PRESETS["src_rest"]!;
  return { key, pull: (config, cursor, deps) => restPull(config, cursor, deps, defaults) };
}

export const restInboundAdapter = makeRestInboundAdapter("src_rest");
