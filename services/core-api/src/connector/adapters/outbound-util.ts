import type { SafeFetchOptions } from "../http-client.js";
import type { OutboundDeps } from "./types.js";

// Tiện ích dùng chung cho các adapter OUTBOUND REST/webhook.

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

/** Gộp SafeFetchOptions từ deps (chỉ set field có giá trị — tránh exactOptionalPropertyTypes). */
export function fetchOpts(base: SafeFetchOptions, deps?: OutboundDeps): SafeFetchOptions {
  const o: SafeFetchOptions = { ...base };
  if (deps?.fetchImpl) o.fetchImpl = deps.fetchImpl;
  if (deps?.allowHttp !== undefined) o.allowHttp = deps.allowHttp;
  if (deps?.lookup) o.lookup = deps.lookup;
  return o;
}
