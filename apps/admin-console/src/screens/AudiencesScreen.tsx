import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import {
  ApiError,
  type ActivateResult,
  type ConsentPurpose,
  type SegmentCriteria,
} from "../lib/types.js";

const PURPOSES: { value: ConsentPurpose; label: string }[] = [
  { value: "marketing_email", label: "Email marketing" },
  { value: "marketing_sms", label: "SMS marketing" },
  { value: "marketing_zalo", label: "Zalo marketing" },
  { value: "personalization", label: "Cá nhân hóa" },
  { value: "data_sharing", label: "Chia sẻ dữ liệu" },
];

/** Audiences — kích hoạt danh sách OCC ID tới destination, GATE bằng consent (deny-by-default). */
export function AudiencesScreen() {
  const [audienceName, setAudienceName] = useState("");
  const [purpose, setPurpose] = useState<ConsentPurpose>("marketing_email");
  const [channel, setChannel] = useState("email");
  const [destination, setDestination] = useState("rudderstack");
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ActivateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Segment builder: dựng danh sách OCC ID theo tiêu chí thay vì nhập tay.
  const [segBrand, setSegBrand] = useState("");
  const [segMinSpend, setSegMinSpend] = useState("");
  const [segMinTxn, setSegMinTxn] = useState("");
  const [segCount, setSegCount] = useState<number | null>(null);
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });

  async function previewSegment() {
    setBusy(true);
    setError(null);
    try {
      const criteria: SegmentCriteria = {
        ...(segBrand ? { brandId: segBrand } : {}),
        ...(segMinSpend.trim() ? { minSpend: Number(segMinSpend) } : {}),
        ...(segMinTxn.trim() ? { minTransactions: Number(segMinTxn) } : {}),
      };
      const seg = await api.previewSegment(criteria);
      setRaw(seg.occIds.join("\n"));
      setSegCount(seg.count);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Lỗi segment");
    } finally {
      setBusy(false);
    }
  }

  const occIds = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function run() {
    if (!audienceName.trim() || occIds.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.activate({
          audienceName: audienceName.trim(),
          purpose,
          channel: channel.trim(),
          destination: destination.trim(),
          occIds,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Lỗi kích hoạt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-[900px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Audiences · Activation</h1>
        <p className="text-text-muted">
          Kích hoạt audience tới destination. Người chưa cấp consent cho mục đích này sẽ bị loại
          (deny-by-default) — đây là chokepoint consent duy nhất.
        </p>
      </header>

      <div className="mb-5 rounded-lg border border-border bg-surface-alt p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-text-subtle">
          Dựng segment theo tiêu chí
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Thương hiệu</span>
            <select
              aria-label="Thương hiệu segment"
              value={segBrand}
              onChange={(e) => setSegBrand(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">— tất cả —</option>
              {brands.data?.map((b) => (
                <option key={b.brand_id} value={b.brand_id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Chi tiêu tối thiểu (VND)</span>
            <input
              aria-label="Chi tiêu tối thiểu"
              inputMode="numeric"
              value={segMinSpend}
              onChange={(e) => setSegMinSpend(e.target.value)}
              className="input tabular"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Số giao dịch tối thiểu</span>
            <input
              aria-label="Số giao dịch tối thiểu"
              inputMode="numeric"
              value={segMinTxn}
              onChange={(e) => setSegMinTxn(e.target.value)}
              className="input tabular"
            />
          </label>
          <button
            type="button"
            onClick={previewSegment}
            disabled={busy}
            className="h-9 rounded-md border border-border bg-surface px-4 font-medium disabled:opacity-40"
          >
            Xem trước segment
          </button>
          {segCount !== null && (
            <span className="text-sm text-text-muted">
              khớp <strong data-testid="segment-count">{segCount}</strong> khách
            </span>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-4"
      >
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Tên audience</span>
            <input
              aria-label="Tên audience"
              value={audienceName}
              onChange={(e) => setAudienceName(e.target.value)}
              className="input w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Mục đích (consent)</span>
            <select
              aria-label="Mục đích consent"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Kênh</span>
            <input
              aria-label="Kênh"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Destination</span>
            <input
              aria-label="Destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="input"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">
            Danh sách OCC ID (mỗi dòng hoặc cách nhau dấu phẩy) — {occIds.length} id
          </span>
          <textarea
            aria-label="Danh sách OCC ID"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={5}
            className="rounded-md border border-border bg-surface p-3 font-mono text-xs"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !audienceName.trim() || occIds.length === 0}
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? "Đang kích hoạt…" : "Kích hoạt"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-md border border-error/40 bg-surface p-3 text-error">{error}</div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-subtle">
            Kết quả kích hoạt (run {result.runId.slice(0, 8)}…)
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            <Stat label="Tổng" testid="act-total" value={result.total} />
            <Stat label="Được gửi" testid="act-allowed" value={result.allowedCount} accent="text-success" />
            <Stat
              label="Bị chặn (no consent)"
              testid="act-suppressed"
              value={result.suppressedCount}
              accent="text-warning"
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Stat(props: { label: string; testid: string; value: number; accent?: string }) {
  return (
    <div className="p-4">
      <div className="text-xs uppercase tracking-wide text-text-subtle">{props.label}</div>
      <div data-testid={props.testid} className={`tabular text-2xl font-bold ${props.accent ?? ""}`}>
        {props.value}
      </div>
    </div>
  );
}
