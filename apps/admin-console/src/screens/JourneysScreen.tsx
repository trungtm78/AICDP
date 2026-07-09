import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Waypoints, Plus, ChartColumnBig, PenLine } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type JTrigger, type JourneySummary } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import {
  PageHeader, Panel, Button, Table, type Column, Badge, StatusPill, EmptyState,
  Modal, Field, Input, Select, useToast,
} from "../ui/index.js";

const STATUS_TONE = { draft: "neutral", active: "success", paused: "warning", archived: "neutral" } as const;
const TRIGGER_LABEL: Record<string, string> = { event: "Sự kiện", segment: "Phân khúc", manual: "Thủ công" };

/** Journeys — danh sách + tạo draft. Sửa/publish/report ở màn chi tiết (/journeys/:id). */
export function JourneysScreen() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const journeys = useQuery({ queryKey: ["journeys"], queryFn: api.jListJourneys });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<JTrigger>("manual");

  const createMut = useMutation({
    mutationFn: () => api.jCreateJourney({ name: name.trim(), triggerType: trigger, triggerConfig: {}, definition: emptyDefinition() }),
    onSuccess: (j) => {
      setOpen(false);
      setName("");
      void qc.invalidateQueries({ queryKey: ["journeys"] });
      nav(`/journeys/${j.journey_id}`);
    },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi tạo journey", "error"),
  });

  const columns: Column<JourneySummary>[] = [
    { key: "name", header: "Tên", cell: (j) => <span className="font-medium text-text">{j.name}</span> },
    { key: "status", header: "Trạng thái", cell: (j) => <StatusPill tone={STATUS_TONE[j.status]}>{j.status}</StatusPill>, width: "130px" },
    { key: "trigger", header: "Kích hoạt", cell: (j) => <Badge tone="neutral">{TRIGGER_LABEL[j.trigger_type ?? ""] ?? "—"}</Badge>, width: "130px" },
    { key: "participants", header: "Đã vào", numeric: true, cell: (j) => fmtInt(j.participants), width: "100px" },
    { key: "completed", header: "Hoàn thành", numeric: true, cell: (j) => fmtInt(j.completed), width: "110px" },
    {
      key: "act", header: "", numeric: true, width: "180px",
      cell: (j) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<ChartColumnBig className="size-3.5" />} onClick={() => nav(`/journeys/${j.journey_id}?tab=report`)}>Report</Button>
          <Button size="sm" variant="secondary" icon={<PenLine className="size-3.5" />} onClick={() => nav(`/journeys/${j.journey_id}`)}>Mở</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1120px] p-6">
      <PageHeader
        title="Journeys"
        description="Tự động hóa đa bước: trigger → điều kiện → hành động, kèm báo cáo hiệu suất."
        breadcrumb={["Phân tích", "Journeys"]}
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Tạo journey</Button>}
      />

      <Panel bodyClassName="p-0">
        {!journeys.isLoading && (journeys.data?.length ?? 0) === 0 ? (
          <EmptyState className="rounded-none border-0" icon={<Waypoints className="size-6" />} title="Chưa có journey" description="Tạo journey đầu tiên và dựng luồng trên canvas." action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Tạo journey</Button>} />
        ) : (
          <Table columns={columns} rows={journeys.data ?? []} rowKey={(j) => j.journey_id} loading={journeys.isLoading}
            onRowClick={(j) => nav(`/journeys/${j.journey_id}`)} className="rounded-none border-0 shadow-none" />
        )}
      </Panel>

      <Modal open={open} onClose={() => setOpen(false)} title="Tạo journey mới"
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Hủy</Button>
          <Button variant="primary" onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!name.trim()}>Tạo & mở canvas</Button>
        </>}>
        <div className="space-y-3">
          <Field label="Tên journey"><Input aria-label="Tên journey" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="vd Chào mừng khách mới" /></Field>
          <Field label="Cách đưa khách vào (trigger)">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as JTrigger)}>
              <option value="manual">Thủ công / phân khúc chạy tay</option>
              <option value="event">Sự kiện (vd sau khi mua hàng)</option>
              <option value="segment">Phân khúc (quét định kỳ)</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function emptyDefinition() {
  return {
    nodes: [
      { id: "entry", type: "entry" as const, config: { trigger: "manual" }, pos: { x: 80, y: 160 } },
      { id: "exit", type: "exit" as const, pos: { x: 520, y: 160 } },
    ],
    edges: [{ from: "entry", to: "exit" }],
  };
}
