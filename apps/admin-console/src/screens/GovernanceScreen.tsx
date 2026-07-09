import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Search, X, History } from "lucide-react";
import { api } from "../lib/api.js";
import {
  ApiError,
  type ConsentState,
  type ConsentEffectiveStatus,
  type ConsentPurpose,
} from "../lib/types.js";
import { fmtDateTime } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Button, StatusPill, EmptyState, Drawer, Table, Skeleton, type Column } from "../ui/index.js";

const PURPOSES: { purpose: ConsentPurpose; label: string }[] = [
  { purpose: "marketing_email", label: "Email marketing" },
  { purpose: "marketing_sms", label: "SMS marketing" },
  { purpose: "marketing_zalo", label: "Zalo marketing" },
  { purpose: "personalization", label: "Cá nhân hóa" },
  { purpose: "data_sharing", label: "Chia sẻ dữ liệu" },
];

const STATUS_TONE: Record<ConsentEffectiveStatus, "success" | "warning" | "neutral"> = {
  granted: "success",
  withdrawn: "warning",
  denied: "neutral",
};

/** Governance — quản trị consent (deny-by-default). Chỉ activation mới bị gate bởi consent. */
export function GovernanceScreen() {
  const [occId, setOccId] = useState("");
  const [loadedOccId, setLoadedOccId] = useState("");
  const [states, setStates] = useState<Record<string, ConsentState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [histPurpose, setHistPurpose] = useState<{ purpose: ConsentPurpose; label: string } | null>(null);

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
      const list = await api.listConsents(loadedOccId);
      setStates(Object.fromEntries(list.map((c) => [c.purpose, c])));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] p-6">
      <PageHeader
        title="Governance · Consent"
        description="Deny-by-default. Ingestion và loyalty luôn ghi nhận; chỉ activation bị chặn theo consent."
        breadcrumb={["Quản trị", "Consent"]}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[280px] flex-1" label="OCH ID">
            <Input aria-label="OCH ID" value={occId} onChange={(e) => setOccId(e.target.value)} placeholder="uuid khách hàng" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button variant="primary" onClick={load} disabled={!occId.trim() || busy} loading={busy} className="mb-[1px]">Xem consent</Button>
        </div>
      </Panel>

      {error && <div className="mt-4"><EmptyState tone="error" icon={<X className="size-6" />} title="Lỗi" description={error} /></div>}

      {states && (
        <Panel className="mt-5" title="Trạng thái đồng ý theo mục đích" icon={<ShieldCheck className="size-4" />} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {PURPOSES.map(({ purpose, label }) => {
              const status: ConsentEffectiveStatus = states[purpose]?.status ?? "denied";
              return (
                <li key={purpose} data-testid={`consent-${purpose}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-text">{label}</div>
                    <div className="font-mono text-xs text-text-subtle">{purpose}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill tone={STATUS_TONE[status]}>{status.toUpperCase()}</StatusPill>
                    <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistPurpose({ purpose, label })}>Lịch sử</Button>
                    <Button size="sm" variant="secondary" onClick={() => setConsent(purpose, "granted")} disabled={busy || status === "granted"}>Cấp</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConsent(purpose, "withdrawn")} disabled={busy || status !== "granted"}>Thu hồi</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {histPurpose && loadedOccId && (
        <ConsentHistoryDrawer occId={loadedOccId} purpose={histPurpose.purpose} label={histPurpose.label} onClose={() => setHistPurpose(null)} />
      )}
    </div>
  );
}

/** Drill-down: timeline cấp/thu hồi của một purpose. */
function ConsentHistoryDrawer({ occId, purpose, label, onClose }: { occId: string; purpose: ConsentPurpose; label: string; onClose: () => void }) {
  const hq = useQuery({ queryKey: ["consent-history", occId, purpose], queryFn: () => api.getConsentHistory(occId, purpose) });
  const cols: Column<{ status: string; source: string; channel: string | null; recordedAt: string }>[] = [
    { key: "status", header: "Hành động", width: "120px", cell: (h) => <StatusPill tone={h.status === "granted" ? "success" : "warning"}>{h.status === "granted" ? "Cấp" : "Thu hồi"}</StatusPill> },
    { key: "source", header: "Nguồn", cell: (h) => <span className="text-text-muted">{h.source}{h.channel ? ` · ${h.channel}` : ""}</span> },
    { key: "at", header: "Thời gian", width: "110px", cell: (h) => <span className="tabular text-xs text-text-subtle">{fmtDateTime(h.recordedAt)}</span> },
  ];
  return (
    <Drawer open onClose={onClose} title={`Lịch sử consent — ${label}`} description={purpose}>
      {hq.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Table columns={cols} rows={hq.data ?? []} rowKey={(h, i) => `${h.recordedAt}-${i}`}
          empty={{ title: "Chưa có bản ghi consent cho mục đích này" }} density="compact" />
      )}
    </Drawer>
  );
}
