import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, LogOut, History, UserPlus } from "lucide-react";
import { api } from "../../lib/api.js";
import { ApiError, type JourneyParticipant } from "../../lib/types.js";
import { fmtDateTime } from "../../lib/format.js";
import { Panel, Table, type Column, Button, StatusPill, Badge, Drawer, Field, Textarea, Skeleton, SegmentedControl, useToast } from "../../ui/index.js";

const STEP_TONE: Record<string, "success" | "neutral" | "error"> = { done: "success", skipped: "neutral", failed: "error" };
const NODE_LABEL: Record<string, string> = { entry: "Vào", wait: "Chờ", condition: "Điều kiện", action: "Hành động", exit: "Hoàn thành" };

const STATUS_TONE = { active: "info", completed: "success", exited: "neutral", failed: "error" } as const;
const FILTERS = [
  { value: "", label: "Tất cả" },
  { value: "active", label: "Đang chạy" },
  { value: "completed", label: "Hoàn thành" },
  { value: "failed", label: "Lỗi" },
];

export function JourneyParticipants({ journeyId }: { journeyId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [histPid, setHistPid] = useState<JourneyParticipant | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollRaw, setEnrollRaw] = useState("");

  const q = useQuery({
    queryKey: ["journey-participants", journeyId, status],
    queryFn: () => api.jParticipants(journeyId, { ...(status ? { status } : {}), limit: 100 }),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["journey-participants", journeyId] });
  }

  const tickMut = useMutation({
    mutationFn: () => api.jTick(200),
    onSuccess: (r) => { toast.push(`Đã xử lý ${r.processed} bước`, "info"); refresh(); },
    onError: () => toast.push("Lỗi chạy tick", "error"),
  });
  const retryMut = useMutation({ mutationFn: (pid: string) => api.jRetry(journeyId, pid), onSuccess: refresh });
  const exitMut = useMutation({ mutationFn: (pid: string) => api.jForceExit(journeyId, pid), onSuccess: refresh });
  const enrollMut = useMutation({
    mutationFn: (occIds: string[]) => api.jEnroll(journeyId, { occIds }),
    onSuccess: (r) => { toast.push(`Đã thêm ${r.enrolled} người vào journey`, "success"); setEnrollOpen(false); setEnrollRaw(""); refresh(); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi enroll", "error"),
  });
  function doEnroll() {
    const occIds = enrollRaw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (occIds.length === 0) { toast.push("Nhập ít nhất 1 OCH ID", "error"); return; }
    enrollMut.mutate(occIds);
  }

  const columns: Column<JourneyParticipant>[] = [
    { key: "occ", header: "OCC", cell: (p) => <span className="font-mono text-xs text-text-muted">{p.occ_id.slice(0, 8)}…</span>, width: "120px" },
    { key: "status", header: "Trạng thái", cell: (p) => <StatusPill tone={STATUS_TONE[p.status]}>{p.status}</StatusPill>, width: "130px" },
    { key: "node", header: "Node hiện tại", cell: (p) => <span className="font-mono text-xs">{p.current_node_id ?? "—"}</span> },
    { key: "attempts", header: "Thử lại", numeric: true, cell: (p) => p.attempts, width: "90px" },
    { key: "reason", header: "Lý do rời", cell: (p) => p.exit_reason ?? "—" },
    {
      key: "act", header: "", numeric: true, width: "160px",
      cell: (p) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistPid(p)}>Lịch sử</Button>
          {p.status === "failed" && <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => retryMut.mutate(p.id)}>Thử lại</Button>}
          {(p.status === "active" || p.status === "failed") && <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => exitMut.mutate(p.id)}>Cho rời</Button>}
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Người tham gia"
      subtitle={`${q.data?.meta.total ?? 0} người`}
      actions={
        <div className="flex items-center gap-2">
          <SegmentedControl items={FILTERS} value={status} onChange={setStatus} />
          <Button size="sm" variant="secondary" icon={<UserPlus className="size-3.5" />} onClick={() => setEnrollOpen(true)}>Thêm người</Button>
          <Button size="sm" variant="secondary" icon={<Play className="size-3.5" />} onClick={() => tickMut.mutate()} loading={tickMut.isPending}>Chạy engine</Button>
        </div>
      }
      bodyClassName="p-0"
    >
      <Table columns={columns} rows={q.data?.data ?? []} rowKey={(p) => p.id} loading={q.isLoading}
        empty={{ title: "Chưa có người tham gia", description: "Kích hoạt journey hoặc enroll thủ công." }}
        className="rounded-none border-0 shadow-none" density="compact" />
      {histPid && <ParticipantHistoryDrawer journeyId={journeyId} participant={histPid} onClose={() => setHistPid(null)} />}

      <Drawer open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Thêm người vào journey"
        description="Nhập danh sách OCH ID (mỗi dòng hoặc phân tách bằng dấu phẩy). Dành cho journey trigger thủ công."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnrollOpen(false)}>Huỷ</Button>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={doEnroll} loading={enrollMut.isPending}>Thêm vào journey</Button>
          </div>
        }>
        <Field label="Danh sách OCH ID">
          <Textarea aria-label="Danh sách OCH ID" rows={8} value={enrollRaw} onChange={(e) => setEnrollRaw(e.target.value)}
            placeholder={"11111111-1111-1111-1111-111111111111\n22222222-2222-2222-2222-222222222222"} className="font-mono text-xs" />
        </Field>
      </Drawer>
    </Panel>
  );
}

/** Drill-down: timeline các bước một participant đã đi qua. */
function ParticipantHistoryDrawer({ journeyId, participant, onClose }: { journeyId: string; participant: JourneyParticipant; onClose: () => void }) {
  const hq = useQuery({
    queryKey: ["participant-history", journeyId, participant.id],
    queryFn: () => api.jParticipantHistory(journeyId, participant.id),
  });
  return (
    <Drawer open onClose={onClose} title="Hành trình của khách" description={participant.occ_id}>
      {hq.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !hq.data || hq.data.length === 0 ? (
        <p className="p-2 text-sm text-text-muted">Khách chưa đi qua bước nào.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {hq.data.map((s, i) => (
            <li key={`${s.nodeId}-${i}`} className="relative">
              <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-surface bg-accent" />
              <div className="flex items-center gap-2">
                <span className="font-medium text-text">{NODE_LABEL[s.nodeType] ?? s.nodeType}</span>
                <span className="font-mono text-xs text-text-subtle">{s.nodeId}</span>
                <Badge tone={STEP_TONE[s.status] ?? "neutral"}>{s.status}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-text-subtle">{fmtDateTime(s.ranAt)}</div>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
