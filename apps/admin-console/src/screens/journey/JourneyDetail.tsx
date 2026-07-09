import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Rocket, Play, Pause, CircleCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { ApiError } from "../../lib/types.js";
import { PageHeader, Button, StatusPill, Tabs, Skeleton, EmptyState, useToast } from "../../ui/index.js";
import { JourneyCanvas } from "./JourneyCanvas.js";
import { JourneyParticipants } from "./JourneyParticipants.js";
import { JourneyReportView } from "./JourneyReportView.js";

const STATUS_TONE = { draft: "neutral", active: "success", paused: "warning", archived: "neutral" } as const;

export function JourneyDetail() {
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const tab = sp.get("tab") ?? "build";

  const jq = useQuery({ queryKey: ["journey", id], queryFn: () => api.jGetJourney(id), enabled: !!id });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["journey", id] });
    void qc.invalidateQueries({ queryKey: ["journeys"] });
  }

  const publishMut = useMutation({
    mutationFn: () => api.jPublish(id),
    onSuccess: (r) => { toast.push(`Đã publish version ${r.version}`, "success"); invalidate(); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi publish", "error"),
  });
  const activateMut = useMutation({
    mutationFn: () => api.jActivate(id),
    onSuccess: () => { toast.push("Journey đã kích hoạt (bắt đầu enroll)", "success"); invalidate(); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi activate", "error"),
  });
  const pauseMut = useMutation({
    mutationFn: () => api.jPause(id),
    onSuccess: () => { toast.push("Đã tạm dừng", "info"); invalidate(); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi pause", "error"),
  });

  if (jq.isLoading) return <div className="mx-auto max-w-[1280px] p-6"><Skeleton className="h-8 w-64" /><Skeleton className="mt-4 h-[60vh] w-full" /></div>;
  const j = jq.data;
  if (!j) return <div className="mx-auto max-w-[1280px] p-6"><EmptyState title="Không tìm thấy journey" action={<Button onClick={() => nav("/journeys")}>Về danh sách</Button>} /></div>;

  const canPublish = j.status === "draft" || j.status === "paused";
  const canActivate = j.published_version !== null && (j.status === "draft" || j.status === "paused");

  return (
    <div className="mx-auto flex h-full max-w-[1360px] flex-col p-6">
      <PageHeader
        title={j.name}
        breadcrumb={["Phân tích", "Journeys", j.name]}
        badge={<StatusPill tone={STATUS_TONE[j.status]}>{j.status}</StatusPill>}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => nav("/journeys")}>Danh sách</Button>
            {canPublish && <Button size="sm" variant="secondary" icon={<Rocket className="size-4" />} onClick={() => publishMut.mutate()} loading={publishMut.isPending}>Publish</Button>}
            {canActivate && <Button size="sm" variant="primary" icon={<Play className="size-4" />} onClick={() => activateMut.mutate()} loading={activateMut.isPending}>Kích hoạt</Button>}
            {j.status === "active" && <Button size="sm" variant="secondary" icon={<Pause className="size-4" />} onClick={() => pauseMut.mutate()} loading={pauseMut.isPending}>Tạm dừng</Button>}
            {j.published_version !== null && <StatusPill tone="accent" icon={<CircleCheck className="size-3" />}>v{j.published_version}</StatusPill>}
          </div>
        }
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => setSp(v === "build" ? {} : { tab: v })}
        items={[
          { value: "build", label: "Thiết kế" },
          { value: "participants", label: "Người tham gia" },
          { value: "report", label: "Báo cáo" },
        ]}
      />

      <div className="min-h-0 flex-1">
        {tab === "build" && <JourneyCanvas key={j.journey_id} journey={j} onSaved={invalidate} />}
        {tab === "participants" && <JourneyParticipants journeyId={id} />}
        {tab === "report" && <JourneyReportView journeyId={id} />}
      </div>
    </div>
  );
}
