import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Waypoints, Play, Plus, Gift, Send } from "lucide-react";
import { api } from "../lib/api.js";
import {
  ApiError,
  type ConsentPurpose,
  type JourneyAction,
  type JourneyRunResult,
} from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Select, Button, Badge, EmptyState } from "../ui/index.js";

const PURPOSES: ConsentPurpose[] = ["marketing_email", "marketing_sms", "marketing_zalo", "personalization", "data_sharing"];

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
      setName(""); setMinSpend(""); setPoints(""); setError(null);
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
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        title="Journeys"
        description="Điều phối: chọn đối tượng (segment) rồi thực thi hành động (thưởng điểm / kích hoạt gate-consent)."
        breadcrumb={["Phân tích", "Journeys"]}
      />

      <form onSubmit={submit}>
        <Panel title="Tạo journey" icon={<Plus className="size-4" />}>
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-[200px] flex-1" label="Tên journey"><Input aria-label="Tên journey" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field className="w-44" label="Chi tiêu tối thiểu (VND)"><Input aria-label="Chi tiêu tối thiểu" inputMode="numeric" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} className="tabular" /></Field>
            <Field className="w-52" label="Hành động">
              <Select aria-label="Loại hành động" value={actionType} onChange={(e) => setActionType(e.target.value as "loyalty_bonus" | "activation")}>
                <option value="loyalty_bonus">Thưởng điểm</option>
                <option value="activation">Kích hoạt (gate consent)</option>
              </Select>
            </Field>
            {actionType === "loyalty_bonus" ? (
              <Field className="w-36" label="Số điểm thưởng"><Input aria-label="Số điểm thưởng" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} className="tabular" /></Field>
            ) : (
              <Field className="w-52" label="Mục đích (consent)">
                <Select aria-label="Mục đích consent journey" value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
                  {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
            )}
            <Button type="submit" variant="primary" disabled={createMut.isPending || !name.trim()} loading={createMut.isPending} className="mb-[1px]">Tạo journey</Button>
          </div>
          {error && <p className="mt-2 text-sm text-error">Lỗi: {error}</p>}
        </Panel>
      </form>

      <Panel className="mt-5" title="Danh sách journey" icon={<Waypoints className="size-4" />} bodyClassName="p-0">
        {journeys.isLoading && <p className="p-4 text-sm text-text-muted">Đang tải…</p>}
        {!journeys.isLoading && (journeys.data?.length ?? 0) === 0 && (
          <EmptyState className="rounded-none border-0" icon={<Waypoints className="size-6" />} title="Chưa có journey nào" description="Tạo journey đầu tiên ở trên." />
        )}
        <ul className="divide-y divide-border">
          {journeys.data?.map((j) => {
            const run = runs[j.journey_id];
            return (
              <li key={j.journey_id} data-testid={`journey-${j.journey_id}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-lg bg-accent-subtle text-accent">
                      {j.action.type === "loyalty_bonus" ? <Gift className="size-4" /> : <Send className="size-4" />}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-text">{j.name}</div>
                      <div className="text-xs text-text-muted">
                        {j.action.type === "loyalty_bonus" ? `Thưởng ${j.action.points} điểm` : `Kích hoạt ${j.action.purpose}`}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Play className="size-3.5" />} onClick={() => runMut.mutate(j.journey_id)} disabled={runMut.isPending}>Chạy</Button>
                </div>
                {run && (
                  <div className="mt-2 flex flex-wrap gap-2 rounded-md bg-surface-alt px-3 py-2 text-xs">
                    <Badge tone="neutral">Đối tượng: {fmtInt(run.total)}</Badge>
                    {typeof run.actionResult.credited === "number" && <Badge tone="success">Cộng điểm: {fmtInt(run.actionResult.credited as number)}</Badge>}
                    {typeof run.actionResult.allowedCount === "number" && <Badge tone="success">Gửi: {fmtInt(run.actionResult.allowedCount as number)}</Badge>}
                    {typeof run.actionResult.suppressedCount === "number" && <Badge tone="warning">Chặn: {fmtInt(run.actionResult.suppressedCount as number)}</Badge>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
