import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation } from "@tanstack/react-query";
import { LogIn, Clock, GitBranch, Zap, Flag, Save, Plus } from "lucide-react";
import { api } from "../../lib/api.js";
import { ApiError, type JourneyRow, type JNodeType, type JNode, type JEdge, type JTrigger } from "../../lib/types.js";
import { Button, Drawer, Field, Input, Select, Badge, useToast } from "../../ui/index.js";

type NData = { jtype: JNodeType; config: Record<string, unknown>; label: string };

const ICON: Record<JNodeType, React.ReactNode> = {
  entry: <LogIn className="size-4" />, wait: <Clock className="size-4" />, condition: <GitBranch className="size-4" />,
  action: <Zap className="size-4" />, exit: <Flag className="size-4" />,
};

function nodeSummary(jtype: JNodeType, c: Record<string, unknown>): string {
  if (jtype === "entry") return c.trigger === "event" ? `sự kiện: ${c.eventName ?? "?"}` : c.trigger === "segment" ? "phân khúc" : "thủ công";
  if (jtype === "wait") return `chờ ${c.delayMinutes ?? "?"} phút`;
  if (jtype === "condition") { const p = c.predicate as { kind?: string } | undefined; return p?.kind ?? "điều kiện"; }
  if (jtype === "action") return c.kind === "loyalty_bonus" ? `+${c.points ?? "?"} điểm` : `activation ${c.purpose ?? ""}`;
  return "kết thúc";
}

/** Custom node: 1 kiểu render theo data.jtype, handles trái (target) / phải (source). */
function JFlowNode({ data, selected }: NodeProps) {
  const d = data as NData;
  return (
    <div className={`w-44 rounded-lg border bg-surface px-3 py-2 shadow-sm transition-colors ${selected ? "border-accent" : "border-border"}`}>
      {d.jtype !== "entry" && <Handle type="target" position={Position.Left} className="!size-2 !border-border-strong !bg-surface" />}
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded bg-accent-subtle text-accent">{ICON[d.jtype]}</span>
        <span className="text-sm font-semibold text-text">{d.label}</span>
      </div>
      <div className="mt-1 truncate text-xs text-text-muted">{nodeSummary(d.jtype, d.config)}</div>
      {d.jtype === "condition" ? (
        <>
          <Handle type="source" id="yes" position={Position.Right} style={{ top: "38%" }} className="!size-2 !bg-success" />
          <Handle type="source" id="no" position={Position.Right} style={{ top: "70%" }} className="!size-2 !bg-error" />
        </>
      ) : d.jtype !== "exit" ? (
        <Handle type="source" position={Position.Right} className="!size-2 !border-border-strong !bg-surface" />
      ) : null}
    </div>
  );
}

const nodeTypes = { jnode: JFlowNode };
const TYPE_LABEL: Record<JNodeType, string> = { entry: "Vào", wait: "Chờ", condition: "Điều kiện", action: "Hành động", exit: "Kết thúc" };

function toFlow(def: JourneyRow["definition"]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (def?.nodes ?? []).map((n) => ({
    id: n.id, type: "jnode",
    position: n.pos ?? { x: 100, y: 100 },
    data: { jtype: n.type, config: n.config ?? {}, label: TYPE_LABEL[n.type] } satisfies NData,
  }));
  const edges: Edge[] = (def?.edges ?? []).map((e, i) => ({
    id: `e${i}`, source: e.from, target: e.to,
    ...(e.branch ? { sourceHandle: e.branch } : {}),
    label: e.branch, markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return { nodes, edges };
}

function toDefinition(nodes: Node[], edges: Edge[]): { nodes: JNode[]; edges: JEdge[] } {
  return {
    nodes: nodes.map((n) => {
      const d = n.data as NData;
      return { id: n.id, type: d.jtype, config: d.config, pos: { x: Math.round(n.position.x), y: Math.round(n.position.y) } };
    }),
    edges: edges.map((e) => ({ from: e.source, to: e.target, ...(e.sourceHandle === "yes" || e.sourceHandle === "no" ? { branch: e.sourceHandle } : {}) })),
  };
}

function Inner({ journey, onSaved }: { journey: JourneyRow; onSaved: () => void }) {
  const toast = useToast();
  const init = useMemo(() => toFlow(journey.definition), [journey.definition]);
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges);
  const [selId, setSelId] = useState<string | null>(null);
  const editable = journey.status === "draft" || journey.status === "paused";

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, label: c.sourceHandle ?? undefined, markerEnd: { type: MarkerType.ArrowClosed } }, eds)), [setEdges]);

  const addNode = useCallback((jtype: JNodeType) => {
    const id = `${jtype}-${Math.random().toString(36).slice(2, 7)}`;
    const config = jtype === "wait" ? { delayMinutes: 60 }
      : jtype === "condition" ? { predicate: { kind: "lifecycle", equals: "vip" } }
      : jtype === "action" ? { kind: "loyalty_bonus", points: 100 } : {};
    setNodes((ns) => ns.concat({ id, type: "jnode", position: { x: 260, y: 60 + ns.length * 30 }, data: { jtype, config, label: TYPE_LABEL[jtype] } }));
  }, [setNodes]);

  const patchConfig = useCallback((patch: Record<string, unknown>) => {
    setNodes((ns) => ns.map((n) => (n.id === selId ? { ...n, data: { ...(n.data as NData), config: { ...(n.data as NData).config, ...patch } } } : n)));
  }, [selId, setNodes]);

  const saveMut = useMutation({
    mutationFn: () => {
      // Definition là NGUỒN SỰ THẬT: đồng bộ trigger_type/trigger_config từ entry node
      // để backend trigger-scan (event/segment) nhận đúng journey.
      const entry = nodes.find((n) => (n.data as NData).jtype === "entry");
      const ec = ((entry?.data as NData | undefined)?.config ?? {}) as { trigger?: JTrigger; eventName?: string };
      const triggerType = ec.trigger ?? "manual";
      const triggerConfig = triggerType === "event" && ec.eventName ? { eventName: ec.eventName } : {};
      return api.jSaveJourney(journey.journey_id, { definition: toDefinition(nodes, edges), triggerType, triggerConfig });
    },
    onSuccess: () => { toast.push("Đã lưu luồng", "success"); onSaved(); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi lưu", "error"),
  });

  const sel = nodes.find((n) => n.id === selId);

  return (
    <div className="flex h-full min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-surface-alt">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Thêm bước:</span>
          {(["wait", "condition", "action", "exit"] as JNodeType[]).map((t) => (
            <Button key={t} size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => addNode(t)} disabled={!editable}>{TYPE_LABEL[t]}</Button>
          ))}
        </div>
        <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} onClick={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!editable}>Lưu luồng</Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelId(n.id)}
          nodesConnectable={editable} nodesDraggable={editable} elementsSelectable
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-border)" gap={18} />
          <Controls showInteractive={false} />
          <MiniMap pannable className="!bg-surface" maskColor="rgb(0 0 0 / 0.15)" />
        </ReactFlow>
      </div>

      <Drawer open={!!sel} onClose={() => setSelId(null)} title={sel ? `Cấu hình: ${TYPE_LABEL[(sel.data as NData).jtype]}` : ""}
        footer={<Button variant="primary" onClick={() => setSelId(null)}>Xong</Button>}>
        {sel && <ConfigForm jtype={(sel.data as NData).jtype} config={(sel.data as NData).config} onChange={patchConfig} editable={editable} />}
      </Drawer>
    </div>
  );
}

function ConfigForm({ jtype, config, onChange, editable }: { jtype: JNodeType; config: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void; editable: boolean }) {
  const dis = !editable;
  if (jtype === "entry") {
    const trig = (config.trigger as string) ?? "manual";
    return (
      <div className="space-y-3">
        <Field label="Trigger"><Select disabled={dis} value={trig} onChange={(e) => onChange({ trigger: e.target.value })}>
          <option value="manual">Thủ công</option><option value="event">Sự kiện</option><option value="segment">Phân khúc</option>
        </Select></Field>
        {trig === "event" && <Field label="Tên sự kiện"><Input disabled={dis} value={(config.eventName as string) ?? "order_completed"} onChange={(e) => onChange({ eventName: e.target.value })} /></Field>}
        {trig === "segment" && <Field label="Chi tiêu tối thiểu (VND)"><Input disabled={dis} inputMode="numeric" value={String((config.segment as { minSpend?: number })?.minSpend ?? "")} onChange={(e) => onChange({ segment: { ...(config.segment as object), minSpend: Number(e.target.value) || undefined } })} /></Field>}
      </div>
    );
  }
  if (jtype === "wait") {
    return <Field label="Chờ (phút)"><Input disabled={dis} inputMode="numeric" value={String(config.delayMinutes ?? 60)} onChange={(e) => onChange({ delayMinutes: Number(e.target.value) })} /></Field>;
  }
  if (jtype === "condition") {
    const p = (config.predicate as { kind?: string; equals?: string; value?: number; purpose?: string }) ?? { kind: "lifecycle" };
    return (
      <div className="space-y-3">
        <Field label="Loại điều kiện"><Select disabled={dis} value={p.kind} onChange={(e) => onChange({ predicate: { kind: e.target.value } })}>
          <option value="lifecycle">Vòng đời = …</option><option value="churnRiskGte">Churn risk ≥ …</option>
          <option value="propensityGte">Xu hướng mua ≥ …</option><option value="loyaltyMinGte">Điểm ≥ …</option>
          <option value="favoriteCategory">Nhóm hàng ưa thích = …</option><option value="consentGranted">Đã đồng ý purpose …</option>
        </Select></Field>
        {(p.kind === "lifecycle" || p.kind === "favoriteCategory") && <Field label="Giá trị"><Input disabled={dis} value={p.equals ?? ""} onChange={(e) => onChange({ predicate: { ...p, equals: e.target.value } })} /></Field>}
        {(p.kind === "churnRiskGte" || p.kind === "propensityGte" || p.kind === "loyaltyMinGte") && <Field label="Ngưỡng"><Input disabled={dis} inputMode="numeric" value={String(p.value ?? "")} onChange={(e) => onChange({ predicate: { ...p, value: Number(e.target.value) } })} /></Field>}
        {p.kind === "consentGranted" && <Field label="Purpose"><Input disabled={dis} value={p.purpose ?? "marketing_email"} onChange={(e) => onChange({ predicate: { ...p, purpose: e.target.value } })} /></Field>}
      </div>
    );
  }
  if (jtype === "action") {
    const kind = (config.kind as string) ?? "loyalty_bonus";
    return (
      <div className="space-y-3">
        <Field label="Hành động"><Select disabled={dis} value={kind} onChange={(e) => onChange({ kind: e.target.value })}>
          <option value="loyalty_bonus">Thưởng điểm</option><option value="activation">Kích hoạt (gate consent)</option>
        </Select></Field>
        {kind === "loyalty_bonus" ? (
          <Field label="Số điểm"><Input disabled={dis} inputMode="numeric" value={String(config.points ?? 100)} onChange={(e) => onChange({ points: Number(e.target.value) })} /></Field>
        ) : (
          <>
            <Field label="Purpose"><Input disabled={dis} value={(config.purpose as string) ?? "marketing_email"} onChange={(e) => onChange({ purpose: e.target.value })} /></Field>
            <Field label="Kênh"><Input disabled={dis} value={(config.channel as string) ?? "email"} onChange={(e) => onChange({ channel: e.target.value })} /></Field>
            <Field label="Destination"><Input disabled={dis} value={(config.destination as string) ?? "rudderstack"} onChange={(e) => onChange({ destination: e.target.value })} /></Field>
          </>
        )}
      </div>
    );
  }
  return <p className="text-sm text-text-muted">Node kết thúc — không cần cấu hình.</p>;
}

export function JourneyCanvas(props: { journey: JourneyRow; onSaved: () => void }) {
  if (!props.journey.definition) return <Badge tone="warning">Journey chưa có definition.</Badge>;
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
