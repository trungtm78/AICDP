import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plug, ArrowDownToLine, ArrowUpFromLine, Sparkles, Plus, Trash2, Play, Pause, Waypoints, Zap,
  Activity, Send, RefreshCw, KeyRound, FlaskConical,
} from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type Connector, type ConnectorTemplate, type Connection, type Pipeline, type ConnectionDataSummary } from "../lib/types.js";
import {
  PageHeader, Panel, Button, Badge, StatusPill, Field, Input, Select, Table, type Column,
  Drawer, SegmentedControl, useToast,
} from "../ui/index.js";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "error"> = {
  active: "success", paused: "warning", draft: "neutral", error: "error",
};

/** Workspace "Kết nối" — catalog RudderStack + kênh VN, mô hình dựng sẵn, custom connector, pipeline ETL. */
export function ConnectorsScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const catalog = useQuery({ queryKey: ["connector-catalog"], queryFn: api.getConnectorCatalog });
  const connections = useQuery({ queryKey: ["connections"], queryFn: api.listConnections });
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: api.listPipelines });

  const [dir, setDir] = useState<"source" | "destination">("source");
  const [connecting, setConnecting] = useState<Connector | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [ops, setOps] = useState<Connection | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["connections"] });
    void qc.invalidateQueries({ queryKey: ["pipelines"] });
  };

  const applyTpl = useMutation({
    mutationFn: (t: ConnectorTemplate) => api.applyConnectorTemplate(t.key),
    onSuccess: (res) => {
      invalidate();
      toast.push("Đã áp dụng mô hình", "success");
      if (res.kind === "pipeline") navigate(`/connectors/pipelines/${res.id}`);
    },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi áp dụng", "error"),
  });
  const connStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => api.setConnectionStatus(v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["connections"] }),
  });
  const connDelete = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["connections"] }),
  });
  const newPipeline = useMutation({
    mutationFn: () => api.createPipeline({ name: "Pipeline mới", kind: "event_stream" }),
    onSuccess: (p) => navigate(`/connectors/pipelines/${p.id}`),
  });

  const dirConnectors = (catalog.data?.connectors ?? []).filter((c) => c.direction === dir);
  const readyConnectors = dirConnectors.filter((c) => c.installStatus !== "planned");
  const plannedConnectors = dirConnectors.filter((c) => c.installStatus === "planned");
  const templates = catalog.data?.templates ?? [];

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <PageHeader
        title="Kết nối hệ thống"
        description="Kết nối OCH-CDP với các hệ thống bên ngoài theo hệ sinh thái RudderStack (200+ connector) + kênh Việt Nam. Áp dụng mô hình dựng sẵn hoặc dựng pipeline ETL kéo-thả."
        breadcrumb={["Tích hợp", "Kết nối"]}
      />

      {/* Mô hình dựng sẵn */}
      <Panel title="Mô hình kết nối dựng sẵn" icon={<Sparkles className="size-4" />} subtitle="Áp dụng nhanh — một chạm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.key} className="flex flex-col rounded-lg border border-border bg-surface p-3.5">
              <div className="mb-1 flex items-center gap-2">
                {t.kind === "pipeline" ? <Waypoints className="size-4 text-accent" /> : <Plug className="size-4 text-accent" />}
                <span className="text-sm font-semibold text-text">{t.name}</span>
              </div>
              <p className="mb-3 flex-1 text-xs text-text-muted">{t.blurb}</p>
              <Button size="sm" variant="secondary" onClick={() => applyTpl.mutate(t)} loading={applyTpl.isPending}>Áp dụng</Button>
            </div>
          ))}
        </div>
      </Panel>

      {/* Catalog connector */}
      <Panel
        title="Danh mục connector"
        icon={<Plug className="size-4" />}
        actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setShowCreate(true)}>Tạo connector mới</Button>}
      >
        <div className="mb-4">
          <SegmentedControl
            value={dir}
            onChange={(v) => setDir(v as "source" | "destination")}
            items={[
              { value: "source", label: "Nguồn (Sources)", icon: <ArrowDownToLine className="size-4" /> },
              { value: "destination", label: "Đích (Destinations)", icon: <ArrowUpFromLine className="size-4" /> },
            ]}
          />
        </div>
        <ConnectorGroup
          title="Đã setup — chạy thật"
          hint={`${readyConnectors.length} connector có tích hợp thật (gửi/nhận dữ liệu qua adapter).`}
          connectors={readyConnectors} onConnect={setConnecting} ready
        />
        {plannedConnectors.length > 0 && (
          <div className="mt-6">
            <ConnectorGroup
              title="Chưa setup — sắp có"
              hint={`${plannedConnectors.length} connector chưa cài adapter (lưu cấu hình được, thao tác thật báo 'chưa khả dụng' — không giả lập).`}
              connectors={plannedConnectors} onConnect={setConnecting} ready={false}
            />
          </div>
        )}
      </Panel>

      {/* Connections + Pipelines đang có */}
      <ConnectionsPanel connections={connections.data ?? []} loading={connections.isLoading}
        onToggle={(c) => connStatus.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })}
        onOps={setOps}
        onDelete={(id) => { if (window.confirm("Xoá kết nối này?")) connDelete.mutate(id); }} />

      <Panel title="Pipeline ETL (kéo-thả)" icon={<Waypoints className="size-4" />}
        subtitle="Dựng luồng Source → Transform → Destination bằng kéo-thả"
        actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => newPipeline.mutate()} loading={newPipeline.isPending}>Pipeline mới</Button>}
        bodyClassName="p-0">
        <PipelinesTable pipelines={pipelines.data ?? []} loading={pipelines.isLoading} onOpen={(p) => navigate(`/connectors/pipelines/${p.id}`)} />
      </Panel>

      {connecting && (
        <ConnectDrawer connector={connecting} onClose={() => setConnecting(null)} onSaved={() => { setConnecting(null); void qc.invalidateQueries({ queryKey: ["connections"] }); toast.push("Đã tạo kết nối", "success"); }} />
      )}
      {showCreate && (
        <CreateConnectorDrawer onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void qc.invalidateQueries({ queryKey: ["connector-catalog"] }); toast.push("Đã tạo connector tuỳ biến", "success"); }} />
      )}
      {ops && <OperationsDrawer connection={ops} onClose={() => setOps(null)} />}
    </div>
  );
}

/** Nhóm connector (Đã setup / Chưa setup) — thẻ kèm nhãn trạng thái tích hợp. */
function ConnectorGroup({ title, hint, connectors, onConnect, ready }: {
  title: string; hint: string; connectors: Connector[]; onConnect: (c: Connector) => void; ready: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">{title}</span>
        <Badge tone={ready ? "success" : "neutral"}>{ready ? "Sẵn sàng" : "Sắp có"}</Badge>
        <span className="text-xs text-text-subtle">{hint}</span>
      </div>
      {connectors.length === 0 ? (
        <p className="text-xs text-text-subtle">Không có connector nào trong nhóm này.</p>
      ) : (
        <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${ready ? "" : "opacity-80"}`}>
          {connectors.map((c) => (
            <div key={c.key} className="flex flex-col rounded-lg border border-border bg-surface p-3.5" data-testid={`connector-${c.key}`}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-text">{c.name}</span>
                {c.vn && <Badge tone="warning">VN</Badge>}
                {c.isCustom && <Badge tone="accent">Tuỳ biến</Badge>}
                {!ready && <Badge tone="neutral">Chưa setup</Badge>}
              </div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-text-subtle">{c.category}</div>
              <p className="mb-3 flex-1 text-xs text-text-muted">{c.blurb}</p>
              <Button size="sm" variant="secondary" onClick={() => onConnect(c)}>Kết nối</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionsPanel({ connections, loading, onToggle, onOps, onDelete }: { connections: Connection[]; loading: boolean; onToggle: (c: Connection) => void; onOps: (c: Connection) => void; onDelete: (id: string) => void }) {
  const columns: Column<Connection>[] = [
    { key: "name", header: "Tên kết nối", cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "dir", header: "Hướng", width: "110px", cell: (c) => c.direction === "source" ? <Badge tone="neutral">Nguồn</Badge> : <Badge tone="accent">Đích</Badge> },
    { key: "connector", header: "Connector", cell: (c) => <span className="text-text-muted">{c.connectorName}</span> },
    { key: "status", header: "Trạng thái", width: "120px", cell: (c) => <StatusPill tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</StatusPill> },
    {
      key: "act", header: "", numeric: true, width: "300px",
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" icon={<Activity className="size-3.5" />} onClick={() => onOps(c)}>Vận hành</Button>
          <Button size="sm" variant="ghost" icon={c.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={() => onToggle(c)}>
            {c.status === "active" ? "Tạm dừng" : "Kích hoạt"}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(c.id)}>Xoá</Button>
        </div>
      ),
    },
  ];
  return (
    <Panel title="Kết nối đang cấu hình" icon={<Zap className="size-4" />} subtitle={`${connections.length} kết nối`} bodyClassName="p-0">
      <Table columns={columns} rows={connections} rowKey={(c) => c.id} loading={loading}
        empty={{ title: "Chưa có kết nối", description: "Áp dụng mô hình dựng sẵn hoặc kết nối từ danh mục." }} density="compact" />
    </Panel>
  );
}

function PipelinesTable({ pipelines, loading, onOpen }: { pipelines: Pipeline[]; loading: boolean; onOpen: (p: Pipeline) => void }) {
  const KIND: Record<string, string> = { event_stream: "Event stream", etl: "ETL", reverse_etl: "Reverse-ETL" };
  const columns: Column<Pipeline>[] = [
    { key: "name", header: "Tên pipeline", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "kind", header: "Loại", width: "140px", cell: (p) => <Badge tone="neutral">{KIND[p.kind] ?? p.kind}</Badge> },
    { key: "nodes", header: "Bước", numeric: true, width: "80px", cell: (p) => p.definition.nodes.length },
    { key: "status", header: "Trạng thái", width: "120px", cell: (p) => <StatusPill tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</StatusPill> },
  ];
  return (
    <Table columns={columns} rows={pipelines} rowKey={(p) => p.id} loading={loading} onRowClick={onOpen}
      empty={{ title: "Chưa có pipeline", description: "Bấm 'Pipeline mới' để dựng luồng ETL kéo-thả." }} density="compact" />
  );
}

// Nhãn VN cho loại data (event_type) chảy qua connection.
const DATA_LABEL: Record<string, string> = {
  order_completed: "Doanh thu / Đơn", identify: "Khách / Định danh", payment: "Thanh toán",
};
function buildDataChips(ds: ConnectionDataSummary): Array<{ label: string; value: number; tone: "success" | "error" | "neutral" | "accent" }> {
  const chips: Array<{ label: string; value: number; tone: "success" | "error" | "neutral" | "accent" }> = [];
  for (const [type, n] of Object.entries(ds.events.byType)) chips.push({ label: DATA_LABEL[type] ?? type, value: n, tone: "accent" });
  if (ds.deliveries.total > 0) chips.push({ label: "Tin đã gửi", value: ds.deliveries.sent, tone: "success" });
  const errs = ds.events.rejected + ds.deliveries.failed;
  if (errs > 0) chips.push({ label: "Lỗi", value: errs, tone: "error" });
  if (ds.deliveries.skipped > 0) chips.push({ label: "Bỏ qua (thiếu liên hệ)", value: ds.deliveries.skipped, tone: "neutral" });
  return chips;
}
const opErr = (toast: ReturnType<typeof useToast>) => (e: unknown) => toast.push(e instanceof ApiError ? e.message : "Lỗi thao tác", "error");

/** Drawer VẬN HÀNH connection: loại data đang chảy (data-summary) + test/test-send/pull/token + nhật ký. */
function OperationsDrawer({ connection: c, onClose }: { connection: Connection; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isSource = c.direction === "source";
  const summary = useQuery({ queryKey: ["conn-summary", c.id], queryFn: () => api.connectionDataSummary(c.id) });
  const events = useQuery({ queryKey: ["conn-events", c.id], queryFn: () => api.connectionEvents(c.id), enabled: isSource });
  const deliveries = useQuery({ queryKey: ["conn-deliveries", c.id], queryFn: () => api.connectionDeliveries(c.id), enabled: !isSource });
  const [token, setToken] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["conn-summary", c.id] });
    void qc.invalidateQueries({ queryKey: ["conn-events", c.id] });
    void qc.invalidateQueries({ queryKey: ["conn-deliveries", c.id] });
  };
  const testMut = useMutation({ mutationFn: () => api.testConnection(c.id), onSuccess: (r) => toast.push(r.ok ? "Kết nối OK (active)" : `Lỗi: ${r.error ?? "thất bại"}`, r.ok ? "success" : "error"), onError: opErr(toast) });
  const testSendMut = useMutation({ mutationFn: () => api.testSendConnection(c.id), onSuccess: (r) => { toast.push(`Test-send: ${r.status}`, r.status === "sent" ? "success" : "warning"); refresh(); }, onError: opErr(toast) });
  const pullMut = useMutation({ mutationFn: () => api.pullConnection(c.id), onSuccess: (r) => { toast.push(`Pull: ${r.ingested} nạp · ${r.rejected} lỗi (${r.pulled} kéo)`, "success"); refresh(); }, onError: opErr(toast) });
  const tokenMut = useMutation({ mutationFn: () => api.issueInboundToken(c.id), onSuccess: (r) => setToken(r.token), onError: opErr(toast) });

  const chips = summary.data ? buildDataChips(summary.data) : [];
  return (
    <Drawer open onClose={onClose} title={`Vận hành — ${c.name}`} description={`${c.connectorName} · ${isSource ? "Nguồn" : "Đích"}`}>
      <div className="space-y-5">
        {/* Loại data đang chảy */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">Loại dữ liệu đang chảy</h4>
          {summary.isLoading ? <p className="text-sm text-text-muted">Đang tải…</p>
            : chips.length === 0 ? <p className="text-sm text-text-muted" data-testid="ops-nodata">Chưa có dữ liệu chảy qua kết nối này.</p>
            : (
              <div className="flex flex-wrap gap-2" data-testid="ops-datachips">
                {chips.map((ch) => (
                  <div key={ch.label} className="rounded-lg border border-border bg-surface px-3 py-1.5">
                    <div className="text-[11px] text-text-subtle">{ch.label}</div>
                    <div className="text-sm font-semibold text-text">{ch.value.toLocaleString("vi-VN")}</div>
                  </div>
                ))}
              </div>
            )}
        </section>

        {/* Thao tác thật */}
        <section className="flex flex-wrap gap-2">
          {c.direction === "destination" && (
            <>
              <Button size="sm" variant="secondary" icon={<FlaskConical className="size-3.5" />} onClick={() => testMut.mutate()} loading={testMut.isPending}>Kiểm tra</Button>
              <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => testSendMut.mutate()} loading={testSendMut.isPending}>Gửi thử</Button>
            </>
          )}
          {isSource && (
            <>
              <Button size="sm" variant="secondary" icon={<KeyRound className="size-3.5" />} onClick={() => tokenMut.mutate()} loading={tokenMut.isPending}>Cấp token cổng vào</Button>
              <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} onClick={() => pullMut.mutate()} loading={pullMut.isPending}>Kéo dữ liệu (pull)</Button>
            </>
          )}
        </section>

        {token && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="mb-1 text-xs font-semibold text-warning">Token cổng vào (chỉ hiện 1 lần — lưu ngay):</p>
            <code className="break-all text-xs text-text" data-testid="ops-token">{token}</code>
          </div>
        )}

        {/* Nhật ký */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">{isSource ? "Sự kiện nhận gần đây" : "Lượt gửi gần đây"}</h4>
          {isSource ? (
            <LogList rows={(events.data ?? []).map((e) => ({ id: e.id, a: e.eventType, b: e.status, err: e.error }))} loading={events.isLoading} />
          ) : (
            <LogList rows={(deliveries.data ?? []).map((d) => ({ id: d.id, a: `${d.channel}${d.recipient ? ` · ${d.recipient}` : ""}`, b: d.status, err: d.error }))} loading={deliveries.isLoading} />
          )}
        </section>
      </div>
    </Drawer>
  );
}

function LogList({ rows, loading }: { rows: Array<{ id: string; a: string; b: string; err: string | null }>; loading: boolean }) {
  if (loading) return <p className="text-sm text-text-muted">Đang tải…</p>;
  if (rows.length === 0) return <p className="text-sm text-text-muted">Chưa có bản ghi.</p>;
  const tone = (s: string) => (s === "ingested" || s === "sent" ? "success" : s === "rejected" || s === "failed" ? "error" : "neutral");
  return (
    <div className="space-y-1" data-testid="ops-log">
      {rows.slice(0, 20).map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2.5 py-1.5 text-xs">
          <span className="truncate text-text-muted">{r.a}</span>
          <Badge tone={tone(r.b)}>{r.b}</Badge>
        </div>
      ))}
    </div>
  );
}

/** Drawer cấu hình 1 connector → tạo connection. */
function ConnectDrawer({ connector, onClose, onSaved }: { connector: Connector; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(connector.name);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => api.createConnection({ name: name.trim(), direction: connector.direction, connectorKey: connector.key, config }),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi tạo kết nối"),
  });
  return (
    <Drawer open onClose={onClose} title={`Kết nối — ${connector.name}`} description={connector.blurb}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Huỷ</Button><Button variant="primary" onClick={() => mut.mutate()} loading={mut.isPending} disabled={!name.trim()}>Lưu kết nối</Button></div>}>
      <div className="space-y-4">
        <Field label="Tên kết nối"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {connector.configFields.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder}
              value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
          </Field>
        ))}
        {err && <p className="text-sm text-error">{err}</p>}
        <p className="text-xs text-text-subtle">Field bí mật được mã hoá at-rest (AES-256-GCM) và luôn hiển thị dạng mask. Sau khi lưu, dùng "Vận hành" để test/gửi thử/kéo dữ liệu và xem loại data đang chảy.</p>
      </div>
    </Drawer>
  );
}

/** Drawer tạo connector tuỳ biến cho hệ thống ngoài bất kỳ. */
function CreateConnectorDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ key: "", name: "", direction: "source" as "source" | "destination", category: "Tuỳ biến", transport: "rest" as string });
  const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => api.createConnector({
      key: f.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      name: f.name.trim(), direction: f.direction, category: f.category.trim() || "Tuỳ biến", transport: f.transport,
      configSchema: [{ key: "endpoint", label: "Endpoint / URL", type: "url" }, { key: "apiKey", label: "API key", type: "password", secret: true }],
      blurb: "Connector tuỳ biến do OCH tạo.",
    }),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi tạo connector"),
  });
  return (
    <Drawer open onClose={onClose} title="Tạo connector tuỳ biến" description="Kết nối với hệ thống bên ngoài bất kỳ (REST / Webhook / Database)."
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Huỷ</Button><Button variant="primary" onClick={() => mut.mutate()} loading={mut.isPending} disabled={!f.key.trim() || !f.name.trim()}>Tạo connector</Button></div>}>
      <div className="space-y-4">
        <Field label="Mã (key)"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="vd erp_noi_bo" /></Field>
        <Field label="Tên hiển thị"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ERP nội bộ" /></Field>
        <Field label="Hướng">
          <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as "source" | "destination" })}>
            <option value="source">Nguồn (Source)</option>
            <option value="destination">Đích (Destination)</option>
          </Select>
        </Field>
        <Field label="Giao thức (transport)">
          <Select value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value })}>
            <option value="rest">REST API</option>
            <option value="webhook">Webhook</option>
            <option value="database">Database</option>
            <option value="warehouse">Warehouse</option>
            <option value="sdk">SDK</option>
          </Select>
        </Field>
        <Field label="Nhóm (category)"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        {err && <p className="text-sm text-error">{err}</p>}
      </div>
    </Drawer>
  );
}
