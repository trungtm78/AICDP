import { safeFetch } from "../http-client.js";
import { AppError } from "../../http/errors.js";
import { applyPayloadMapping, getPath } from "../payload-map.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { InboundPullAdapter, PulledEvent, OutboundDeps } from "./types.js";

// Adapter INBOUND-pull generic REST/OData (ERP: SAP/Oracle/…). GET phân trang qua safeFetch
// (SSRF-safe + pin IP — kể cả nextLink do SERVER trả cũng bị kiểm SSRF), rút mảng record theo
// recordsPath, map từng record qua payloadMapping (dot-path) -> order_completed/identify, rồi
// runner (inbound-pull.service) nạp + tiến cursor. Không per-event cursor -> lỗi giữa trang thì
// KHÔNG tiến (re-pull trang, ingest idempotent theo message_id) — không mất dữ liệu.
//
// config: endpoint(url), mode('odata'|'offset'), recordsPath(mặc định 'value'), payloadMapping,
//   authType('bearer'|'header'|'none'), apiKey(secret), authHeaderName, pageSize, offsetParam, limitParam.

function misconfigured(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: msg,
    why: "Cấu hình REST/OData chưa hợp lệ.", fix: "Kiểm tra endpoint/payloadMapping/auth của connection.", retryable: false,
  });
}

function authHeaders(config: Record<string, unknown>): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const apiKey = str(config["apiKey"]);
  const authType = str(config["authType"]) ?? (apiKey ? "bearer" : "none");
  if (authType === "bearer" && apiKey) h["authorization"] = `Bearer ${apiKey}`;
  else if (authType === "header" && apiKey) h[str(config["authHeaderName"]) ?? "x-api-key"] = apiKey;
  return h;
}

const MAX_PAGE = 500;

async function restPull(
  config: Record<string, unknown>,
  cursor: Record<string, unknown> | null,
  deps?: OutboundDeps,
): Promise<{ events: PulledEvent[]; nextCursor: Record<string, unknown> | null }> {
    const endpoint = str(config["endpoint"]);
    if (!endpoint) throw misconfigured("Thiếu endpoint REST/OData.");
    const mapping = config["payloadMapping"];
    if (!mapping || typeof mapping !== "object") throw misconfigured("Thiếu payloadMapping.");
    const recordsPath = str(config["recordsPath"]) ?? "value";
    const mode = str(config["mode"]) ?? "odata";
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Number(config["pageSize"]) || 100));
    const headers = authHeaders(config);

    // Xác định URL trang cần lấy.
    let url: string;
    let offset = 0;
    if (mode === "odata") {
      url = (cursor && str(cursor["nextLink"])) || endpoint;
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

    const recordsRaw = getPath(json, recordsPath);
    const records = Array.isArray(recordsRaw) ? recordsRaw : [];
    const events: PulledEvent[] = records.map((rec) => {
      const data = applyPayloadMapping(rec, mapping) as { type: "order_completed" | "identify" };
      return { type: data.type, data };
    });

    // Cursor trang kế: OData theo @odata.nextLink; offset theo số record (dừng khi trang ngắn).
    let nextCursor: Record<string, unknown> | null = null;
    if (mode === "odata") {
      const nl = str(json["@odata.nextLink"]);
      nextCursor = nl ? { nextLink: nl } : null;
    } else {
      nextCursor = records.length >= pageSize ? { offset: offset + records.length } : null;
    }
    return { events, nextCursor };
}

/** Adapter REST/OData cho 1 connectorKey (preset SAP/Oracle dùng chung logic, khác default config). */
export function makeRestInboundAdapter(key: string): InboundPullAdapter {
  return { key, pull: restPull };
}

export const restInboundAdapter = makeRestInboundAdapter("src_rest");
