import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import {
  ApiError,
  type ConsentPurpose,
  type JourneyAction,
  type JourneyRunResult,
} from "../lib/types.js";

const PURPOSES: ConsentPurpose[] = [
  "marketing_email",
  "marketing_sms",
  "marketing_zalo",
  "personalization",
  "data_sharing",
];

/** Journeys — orchestration: segment -> action (loyalty bonus / activation gate-consent). */
export function JourneysScreen() {
  const qc = useQueryClient();
  const journeys = useQuery({ queryKey: ["journeys"], queryFn: api.listJourneys });

  const [name, setName] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [actionType, setActionType] = useState<"loyalty_bonus" | "activation">("loyalty_bonus");
  const [points, setPoints] = useState("");
  const [purpose, setPurpose] = useState<ConsentPurpose>("marketing_email");
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, JourneyRunResult>>({});

  const createMut = useMutation({
    mutationFn: () => {
      const action: JourneyAction =
        actionType === "loyalty_bonus"
          ? { type: "loyalty_bonus", points: Number(points) }
          : { type: "activation", purpose, channel: "email", destination: "rudderstack" };
      return api.createJourney({
        name: name.trim(),
        segmentCriteria: minSpend.trim() ? { minSpend: Number(minSpend) } : {},
        action,
      });
    },
    onSuccess: () => {
      setName("");
      setMinSpend("");
      setPoints("");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["journeys"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi tạo journey"),
  });

  const runMut = useMutation({
    mutationFn: (id: string) => api.runJourney(id),
    onSuccess: (res, id) => setRuns((r) => ({ ...r, [id]: res })),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi chạy journey"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (actionType === "loyalty_bonus" && !points.trim()) return;
    createMut.mutate();
  }

  return (
    <section className="mx-auto max-w-[1000px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Journeys</h1>
        <p className="text-text-muted">
          Điều phối: chọn đối tượng (segment) rồi thực thi hành động (thưởng điểm / kích hoạt
          gate-consent). Chạy theo yêu cầu.
        </p>
      </header>

      <form onSubmit={submit} className="mb-6 rounded-lg border border-border bg-surface-alt p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Tên journey</span>
            <input aria-label="Tên journey" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Chi tiêu tối thiểu (VND)</span>
            <input aria-label="Chi tiêu tối thiểu" inputMode="numeric" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} className="input tabular" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Hành động</span>
            <select
              aria-label="Loại hành động"
              value={actionType}
              onChange={(e) => setActionType(e.target.value as "loyalty_bonus" | "activation")}
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="loyalty_bonus">Thưởng điểm</option>
              <option value="activation">Kích hoạt (gate consent)</option>
            </select>
          </label>
          {actionType === "loyalty_bonus" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Số điểm thưởng</span>
              <input aria-label="Số điểm thưởng" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} className="input tabular" />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Mục đích (consent)</span>
              <select
                aria-label="Mục đích consent journey"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}
                className="h-9 rounded-md border border-border bg-surface px-2"
              >
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            disabled={createMut.isPending || !name.trim()}
            className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
          >
            Tạo journey
          </button>
        </div>
        {error && <p className="mt-2 text-error">Lỗi: {error}</p>}
      </form>

      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-subtle">
          Journeys
        </div>
        {journeys.isLoading && <p className="p-4 text-text-muted">Đang tải…</p>}
        {journeys.isError && <p className="p-4 text-error">Lỗi tải journeys.</p>}
        {journeys.data && journeys.data.length === 0 && (
          <p className="p-4 text-text-subtle">Chưa có journey nào.</p>
        )}
        <ul className="divide-y divide-border">
          {journeys.data?.map((j) => {
            const run = runs[j.journey_id];
            return (
              <li key={j.journey_id} data-testid={`journey-${j.journey_id}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{j.name}</div>
                    <div className="text-xs text-text-muted">
                      {j.action.type === "loyalty_bonus"
                        ? `Thưởng ${j.action.points} điểm`
                        : `Kích hoạt ${j.action.purpose}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => runMut.mutate(j.journey_id)}
                    disabled={runMut.isPending}
                    className="h-8 rounded-md border border-border bg-surface-alt px-3 disabled:opacity-40"
                  >
                    Chạy
                  </button>
                </div>
                {run && (
                  <div className="mt-2 rounded-md bg-surface-alt px-3 py-2 text-sm">
                    Đối tượng: <strong className="tabular">{run.total}</strong>
                    {typeof run.actionResult.credited === "number" && (
                      <> · Cộng điểm: <strong className="tabular">{run.actionResult.credited as number}</strong></>
                    )}
                    {typeof run.actionResult.allowedCount === "number" && (
                      <>
                        {" "}· Gửi: <strong className="tabular">{run.actionResult.allowedCount as number}</strong> ·
                        Chặn: <strong className="tabular">{run.actionResult.suppressedCount as number}</strong>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
