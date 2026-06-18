import { useRef, useState } from "react";
import { api } from "../lib/api.js";
import {
  ApiError,
  type Customer360,
  type IdentifierType,
  type Recommendation,
} from "../lib/types.js";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "success"; data: Customer360 };

const TYPES: { value: IdentifierType; label: string }[] = [
  { value: "phone", label: "Số điện thoại" },
  { value: "email", label: "Email" },
  { value: "loyalty_card", label: "Thẻ loyalty" },
  { value: "pos_member_id", label: "POS member ID" },
];

/** Customer 360 — tra cứu 1 khách theo identifier. Data 100% từ core-api. */
export function CustomersScreen() {
  const [type, setType] = useState<IdentifierType>("phone");
  const [value, setValue] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [recs, setRecs] = useState<Recommendation[]>([]);
  // Mỗi lần tra cứu tăng id; chỉ áp kết quả của request mới nhất (chống stale-response).
  const reqId = useRef(0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    const myReq = ++reqId.current;
    setView({ kind: "loading" });
    setRecs([]);
    try {
      const data = await api.lookupCustomer(type, value.trim());
      if (myReq !== reqId.current) return; // đã có request mới hơn -> bỏ kết quả cũ
      setView({ kind: "success", data });
      // Nạp gợi ý cross-sell (best-effort; lỗi/role không đủ -> bỏ qua, không chặn 360).
      try {
        const r = await api.getRecommendations(data.occId);
        if (myReq === reqId.current) setRecs(r.recommendations);
      } catch {
        if (myReq === reqId.current) setRecs([]);
      }
    } catch (err) {
      if (myReq !== reqId.current) return;
      if (err instanceof ApiError && err.code === "CUSTOMER_NOT_FOUND") {
        setView({ kind: "notfound" });
      } else {
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Lỗi không xác định",
        });
      }
    }
  }

  return (
    <section className="mx-auto max-w-[1100px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Customer 360</h1>
        <p className="text-text-muted">Tra cứu một khách hàng theo định danh, hợp nhất xuyên thương hiệu.</p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Loại định danh</span>
          <select
            aria-label="Loại định danh"
            value={type}
            onChange={(e) => setType(e.target.value as IdentifierType)}
            className="h-9 rounded-md border border-border bg-surface px-2"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">Giá trị</span>
          <input
            aria-label="Giá trị định danh"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="vd 0901234567"
            className="h-9 min-w-[220px] rounded-md border border-border bg-surface px-3 font-mono"
          />
        </label>

        <button
          type="submit"
          disabled={!value.trim() || view.kind === "loading"}
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          {view.kind === "loading" ? "Đang tra cứu…" : "Tra cứu"}
        </button>
      </form>

      <div className="mt-6">
        {view.kind === "idle" && (
          <p className="text-text-subtle">Nhập định danh để tra cứu hồ sơ khách hàng.</p>
        )}
        {view.kind === "loading" && <p className="text-text-muted">Đang tải…</p>}
        {view.kind === "notfound" && (
          <div className="rounded-md border border-border bg-surface-alt p-4">
            <p className="font-medium">Không tìm thấy khách hàng</p>
            <p className="text-text-muted">
              Định danh chưa gắn với OCC ID nào — khách có thể chưa phát sinh giao dịch.
            </p>
          </div>
        )}
        {view.kind === "error" && (
          <div className="rounded-md border border-error/40 bg-surface p-4 text-error">
            Lỗi: {view.message}
          </div>
        )}
        {view.kind === "success" && (
          <>
            <CustomerCard data={view.data} />
            {recs.length > 0 && <CrossSell recs={recs} />}
          </>
        )}
      </div>
    </section>
  );
}

function CrossSell({ recs }: { recs: Recommendation[] }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-subtle">
        Gợi ý cross-sell (AI) — khách tương tự cũng mua
      </div>
      <ul className="divide-y divide-border">
        {recs.map((r) => (
          <li
            key={r.sku}
            data-testid={`rec-${r.sku}`}
            className="flex items-center justify-between px-4 py-2"
          >
            <span>
              <span className="font-mono text-xs text-text-muted">{r.sku}</span>{" "}
              {r.name ?? "(không tên)"}
            </span>
            <span className="tabular text-xs text-text-muted">điểm {r.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomerCard({ data }: { data: Customer360 }) {
  const fullName = (data.profile.full_name as string | undefined) ?? "(chưa có tên)";
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-subtle">OCC ID</div>
          <div className="font-mono">{data.occId}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-text-subtle">Giao dịch</div>
          <div data-testid="txn-count" className="tabular text-lg font-bold">
            {data.transactions.length}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3">
        <div>
          <dt className="text-xs text-text-subtle">Họ tên</dt>
          <dd>{fullName}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-subtle">Số định danh</dt>
          <dd className="tabular">{data.identifiers.length}</dd>
        </div>
      </dl>
      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-text-subtle">Định danh</div>
        <ul className="flex flex-wrap gap-2">
          {data.identifiers.map((id) => (
            <li
              key={`${id.identifier_type}:${id.value_normalized}`}
              className="rounded-md border border-border bg-surface-alt px-2 py-1 font-mono text-xs"
            >
              <span className="text-text-muted">{id.identifier_type}</span> {id.value_normalized}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
