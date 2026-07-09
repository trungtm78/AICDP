import { useCallback, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, ArrowDownToLine, Wand2, ArrowUpFromLine, Save, Plus, Trash2, Play, Pause } from "lucide-react";
import { api } from "../../lib/api.js";
import { ApiError, type Connector, type PipelineDefinition, type PipelineNode as PNode } from "../../lib/types.js";
import { PageHeader, Button, Drawer, Field, Select, Badge, StatusPill, useToast, Skeleton } from "../../ui/index.js";

type PType = "source" | "transform" | "destination";
type NData = { ptype: PType; config: Record<string, unknown>; label: string; catalog: Connector[] };

const ICON: Record<PType, React.ReactNode> = {
  source: <ArrowDownToLine className="size-4" />, transform: <Wand2 className="size-4" />, destination: <ArrowUpFromLine className="size-4" />,
};
const TYPE_LABEL: Record<PType, string> = { source: "Nguồn", transform: "Biến đổi", destination: "Đích" };
const TRANSFORMS = [
  { value: "normalize", label: "Chuẩn hoá định danh" },
  { value: "consent_filter", label: "Lọc theo consent" },
  { value: "mapping", label: "Ánh xạ trường" },
  { value: "enrich", label: "Làm giàu (hạng, CLV)" },
  { value: "dedupe", label: "Khử trùng lặp" },
  { value: "audience", label: "Dựng audience" },
];

function summary(d: NData): string {
  if (d.ptype === "transform") return TRANSFORMS.find((t) => t.value === d.config.kind)?.label ?? "biến đổi";
  const ck = d.config.connectorKey as string | undefined;
  return d.catalog.find((c) => c.key === ck)?.name ?? "chưa chọn connector";
}

function PNodeView({ data, selected }: NodeProps) {
  const d = data as NData;
  const tone = d.ptype === "source" ? "border-l-accent" : d.ptype === "destination" ? "border-l-gold" : "border-l-border-strong";
  return (
    <div className={`w-48 rounded-lg border border-l-4 bg-surface px-3 py-2 shadow-sm ${tone} ${selected ? "border-accent" : "border-border"}`}>
      {d.ptype !== "source" && <Handle type="target" position={Position.Left} className="!size-2 !border-border-strong !bg-surface" />}
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded bg-accent-subtle text-accent">{ICON[d.ptype]}</span>
        <span className="text-sm font-semibold text-text">{d.label}</span>
      </div>
      <div className="mt-1 truncate text-xs text-text-muted">{summary(d)}</div>
      {d.ptype !== "destination" && <Handle type="source" position={Position.Right} className="!size-2 !border-border-strong !bg-surface" />}
    </div>
  );
}

const nodeTypes = { pnode: PNodeView };

function Inner({ pipelineId }: { pipelineId: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const catalogQ = useQuery({ queryKey: ["connector-catalog"], queryFn: api.getConnectorCatalog });
  const pipeQ = useQuery({ queryKey: ["pipeline", pipelineId], queryFn: () => api.getPipeline(pipelineId) });

  const catalog = catalogQ.data?.connectors ?? [];
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string>("draft");

  // Nạp definition lần đầu
  useMemo(() => {
    if (!pipeQ.data || loaded) return;
    const def = pipeQ.data.definition;
    setNodes(def.nodes.map((n) => ({
      id: n.id, type: "pnode", position: n.pos ?? { x: 100, y: 100 },
      data: { ptype: n.type, config: n.config ?? {}, label: TYPE_LABEL[n.type], catalog },
    })));
    setEdges(def.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, markerEnd: { type: MarkerType.ArrowClosed } })));
    setStatus(pipeQ.data.status);
    setLoaded(true);
  }, [pipeQ.data, loaded, catalog, setNodes, setEdges]);

  const editable = status !== "active";
  const onConnect = useCallback((c: Connection) => editable && setEdges((eds) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, eds)), [editable, setEdges]);

  function addNode(ptype: PType) {
    const id = `${ptype}_${Math.round(nodes.length * 7 + 3)}`;
    const x = ptype === "source" ? 60 : ptype === "transform" ? 340 : 620;
    const y = 120 + nodes.filter((n) => (n.data as NData).ptype === ptype).length * 110;
    setNodes((ns) => ns.concat({ id, type: "pnode", position: { x, y }, data: { ptype, config: {}, label: TYPE_LABEL[ptype], catalog } }));
  }
  function patch(cfg: Record<string, unknown>) {
    setNodes((ns) => ns.map((n) => n.id === selId ? { ...n, data: { ...(n.data as NData), config: { ...(n.data as NData).config, ...cfg } } } : n));
  }
  function removeSelected() {
    setNodes((ns) => ns.filter((n) => n.id !== selId));
    setEdges((es) => es.filter((e) => e.source !== selId && e.target !== selId));
    setSelId(null);
  }

  function toDefinition(): PipelineDefinition {
    return {
      nodes: nodes.map((n) => { const d = n.data as NData; return { id: n.id, type: d.ptype, config: d.config, pos: { x: Math.round(n.position.x), y: Math.round(n.position.y) } } as PNode; }),
      edges: edges.map((e) => ({ from: e.source, to: e.target })),
    };
  }

  const saveMut = useMutation({
    mutationFn: () => api.savePipeline(pipelineId, { definition: toDefinition() }),
    onSuccess: () => toast.push("Đã lưu pipeline", "success"),
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi lưu", "error"),
  });
  const statusMut = useMutation({
    mutationFn: (s: string) => api.setPipelineStatus(pipelineId, s),
    onSuccess: (r) => { setStatus(r.status); toast.push(r.status === "active" ? "Pipeline đã kích hoạt" : "Đã cập nhật", "success"); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi", "error"),
  });

  const selNode = nodes.find((n) => n.id === selId);
  const selData = selNode?.data as NData | undefined;

  if (pipeQ.isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 pt-4">
        <button type="button" onClick={() => navigate("/connectors")} className="mb-1 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-accent">
          <ArrowLeft className="size-4" /> Về Kết nối
        </button>
        <PageHeader title={pipeQ.data?.name ?? "Pipeline"} description="Kéo-thả Nguồn → Biến đổi → Đích. Lưu rồi Kích hoạt để đưa vào vận hành."
          actions={
            <div className="flex items-center gap-2">
              <StatusPill tone={status === "active" ? "success" : status === "paused" ? "warning" : "neutral"}>{status}</StatusPill>
              {editable
                ? <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => { saveMut.mutate(); statusMut.mutate("active"); }} loading={statusMut.isPending}>Kích hoạt</Button>
                : <Button size="sm" variant="secondary" icon={<Pause className="size-3.5" />} onClick={() => statusMut.mutate("paused")} loading={statusMut.isPending}>Tạm dừng</Button>}
              <Button size="sm" variant="secondary" icon={<Save className="size-3.5" />} onClick={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!editable}>Lưu</Button>
            </div>
          } />
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-surface-alt px-6 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Thêm bước:</span>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => addNode("source")} disabled={!editable}>Nguồn</Button>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => addNode("transform")} disabled={!editable}>Biến đổi</Button>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => addNode("destination")} disabled={!editable}>Đích</Button>
        {!editable && <Badge tone="warning">Đang chạy — chỉ đọc (Tạm dừng để sửa)</Badge>}
      </div>

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => setSelId(n.id)}
          nodesDraggable={editable} nodesConnectable={editable} elementsSelectable
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>

      {selData && (
        <Drawer open onClose={() => setSelId(null)} title={`Cấu hình — ${selData.label}`}
          footer={editable ? <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={removeSelected}>Xoá bước này</Button> : undefined}>
          <div className="space-y-4">
            {selData.ptype === "transform" ? (
              <Field label="Loại biến đổi">
                <Select disabled={!editable} value={(selData.config.kind as string) ?? "normalize"} onChange={(e) => patch({ kind: e.target.value })}>
                  {TRANSFORMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label={selData.ptype === "source" ? "Chọn nguồn (connector)" : "Chọn đích (connector)"}>
                <Select disabled={!editable} value={(selData.config.connectorKey as string) ?? ""} onChange={(e) => patch({ connectorKey: e.target.value })}>
                  <option value="">— chọn —</option>
                  {catalog.filter((c) => c.direction === (selData.ptype === "source" ? "source" : "destination")).map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <p className="text-xs text-text-subtle">Kéo từ chấm bên phải của node này sang node kế để nối bước.</p>
          </div>
        </Drawer>
      )}
    </div>
  );
}

export function PipelineCanvas() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <ReactFlowProvider>
      <Inner pipelineId={id} />
    </ReactFlowProvider>
  );
}
