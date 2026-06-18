import { useState } from "react";
import { api } from "../lib/api.js";
import {
  ApiError,
  type ConsentState,
  type ConsentEffectiveStatus,
  type ConsentPurpose,
} from "../lib/types.js";

const PURPOSES: { purpose: ConsentPurpose; label: string }[] = [
  { purpose: "marketing_email", label: "Email marketing" },
  { purpose: "marketing_sms", label: "SMS marketing" },
  { purpose: "marketing_zalo", label: "Zalo marketing" },
  { purpose: "personalization", label: "Cá nhân hóa" },
  { purpose: "data_sharing", label: "Chia sẻ dữ liệu" },
];

const STATUS_STYLE: Record<ConsentEffectiveStatus, string> = {
  granted: "text-success",
  withdrawn: "text-warning",
  denied: "text-text-subtle",
};

/** Governance — quản trị consent (deny-by-default). Chỉ activation mới bị gate bởi consent. */
export function GovernanceScreen() {
  const [occId, setOccId] = useState("");
  // occId ĐÃ load (gắn với bảng đang hiển thị). Thao tác ghi theo giá trị này, KHÔNG theo
  // input hiện tại — tránh ghi nhầm consent cho OCC khác khi user vừa sửa ô input.
  const [loadedOccId, setLoadedOccId] = useState("");
  const [states, setStates] = useState<Record<string, ConsentState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function errMsg(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return err instanceof Error ? err.message : "Lỗi consent";
  }

  async function load() {
    if (!occId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const target = occId.trim();
      const list = await api.listConsents(target);
      setStates(Object.fromEntries(list.map((c) => [c.purpose, c])));
      setLoadedOccId(target);
    } catch (err) {
      setStates(null);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function setConsent(purpose: ConsentPurpose, status: "granted" | "withdrawn") {
    if (!loadedOccId) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordConsent(loadedOccId, purpose, status, "csr");
      // Đọc lại theo đúng OCC đã ghi (không phụ thuộc input có thể đã đổi).
      const list = await api.listConsents(loadedOccId);
      setStates(Object.fromEntries(list.map((c) => [c.purpose, c])));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-[900px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Governance · Consent</h1>
        <p className="text-text-muted">
          Deny-by-default. Ingestion và loyalty luôn ghi nhận; chỉ activation bị chặn theo consent.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">OCC ID</span>
          <input
            aria-label="OCC ID"
            value={occId}
            onChange={(e) => setOccId(e.target.value)}
            placeholder="uuid khách hàng"
            className="input w-full font-mono"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={!occId.trim() || busy}
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          Xem consent
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-error/40 bg-surface p-3 text-error">
          {error}
        </div>
      )}

      {states && (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <ul className="divide-y divide-border">
            {PURPOSES.map(({ purpose, label }) => {
              const status: ConsentEffectiveStatus = states[purpose]?.status ?? "denied";
              return (
                <li
                  key={purpose}
                  data-testid={`consent-${purpose}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{label}</div>
                    <div className="font-mono text-xs text-text-subtle">{purpose}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium uppercase ${STATUS_STYLE[status]}`}>
                      {status}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConsent(purpose, "granted")}
                      disabled={busy || status === "granted"}
                      className="h-8 rounded-md border border-border bg-surface-alt px-3 disabled:opacity-40"
                    >
                      Cấp
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsent(purpose, "withdrawn")}
                      disabled={busy || status !== "granted"}
                      className="h-8 rounded-md border border-border bg-surface-alt px-3 disabled:opacity-40"
                    >
                      Thu hồi
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
