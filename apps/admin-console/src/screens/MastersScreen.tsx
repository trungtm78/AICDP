import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Store, Package, Plus, Pencil, Trash2, X, BarChart3 } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type Brand, type Store as StoreT, type Product } from "../lib/types.js";
import { fmtInt, fmtVndFull } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Select, Button, Badge, StatTile, Drawer, Skeleton, Table, type Column } from "../ui/index.js";

/** Data Ops · Master Data — Brands / Stores / Products (đầy đủ CRUD). Data 100% từ core-api. */
export function MastersScreen() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <PageHeader
        title="Master Data"
        description="Thương hiệu, cửa hàng, sản phẩm chuẩn hợp nhất (xuyên thương hiệu). Thêm · Sửa · Xoá."
        breadcrumb={["Vận hành", "Data Ops"]}
      />
      <BrandsPanel />
      <StoresPanel />
      <ProductsPanel />
    </div>
  );
}

/** Nút hành động trên mỗi dòng (Sửa / Xoá). */
function RowActions({ onEdit, onDelete, deleting }: { onEdit: () => void; onDelete: () => void; deleting: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit}>Sửa</Button>
      <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onDelete} disabled={deleting}>Xoá</Button>
    </div>
  );
}

function BrandsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  const [form, setForm] = useState({ brand_id: "", name: "", industry: "", brand_accent: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [detail, setDetail] = useState<Brand | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setForm({ brand_id: "", name: "", industry: "", brand_accent: "" }); setEditing(null); setErr(null); };
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["brands"] }); };

  const mut = useMutation({
    mutationFn: () =>
      editing
        ? api.updateBrand(editing, {
            ...(form.name.trim() ? { name: form.name.trim() } : {}),
            ...(form.industry.trim() ? { industry: form.industry.trim() } : {}),
            ...(form.brand_accent.trim() ? { brand_accent: form.brand_accent.trim() } : {}),
          })
        : api.createBrand({
            brand_id: form.brand_id.trim(),
            name: form.name.trim(),
            ...(form.industry.trim() ? { industry: form.industry.trim() } : {}),
            ...(form.brand_accent.trim() ? { brand_accent: form.brand_accent.trim() } : {}),
          }),
    onSuccess: () => { reset(); invalidate(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi lưu thương hiệu"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteBrand(id),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi xoá thương hiệu"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || (!editing && !form.brand_id.trim())) return;
    mut.mutate();
  }
  function edit(b: Brand) {
    setEditing(b.brand_id);
    setForm({ brand_id: b.brand_id, name: b.name, industry: b.industry ?? "", brand_accent: b.brand_accent ?? "" });
    setErr(null);
  }

  const columns: Column<Brand>[] = [
    { key: "id", header: "Mã", cell: (b) => <span className="font-mono text-xs text-text-muted">{b.brand_id}</span>, width: "170px" },
    { key: "name", header: "Tên", cell: (b) => <span className="font-medium">{b.name}</span> },
    { key: "industry", header: "Ngành", cell: (b) => b.industry ?? "—" },
    { key: "accent", header: "Màu", cell: (b) => b.brand_accent ? <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded" style={{ backgroundColor: b.brand_accent }} /><span className="font-mono text-xs">{b.brand_accent}</span></span> : "—", width: "120px" },
    { key: "status", header: "Trạng thái", cell: (b) => <Badge tone={b.status === "active" ? "success" : "neutral"}>{b.status}</Badge>, width: "110px" },
    { key: "act", header: "", numeric: true, width: "210px", cell: (b) => (
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" icon={<BarChart3 className="size-3.5" />} onClick={() => setDetail(b)}>Chi tiết</Button>
        <RowActions onEdit={() => edit(b)} onDelete={() => { if (window.confirm(`Xoá thương hiệu "${b.name}"?`)) del.mutate(b.brand_id); }} deleting={del.isPending} />
      </div>
    ) },
  ];

  return (
    <Panel title="Thương hiệu" icon={<Building2 className="size-4" />}>
      <form onSubmit={submit} className="mb-4">
        <fieldset disabled={mut.isPending} className="flex flex-wrap items-end gap-3">
          <Field className="w-40" label="Mã thương hiệu">
            <Input aria-label="Mã thương hiệu" value={form.brand_id} disabled={!!editing} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} />
          </Field>
          <Field className="w-44" label="Tên"><Input aria-label="Tên thương hiệu" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field className="w-36" label="Ngành"><Input aria-label="Ngành thương hiệu" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
          <Field className="w-32" label="Màu (hex)"><Input aria-label="Màu thương hiệu" value={form.brand_accent} onChange={(e) => setForm({ ...form, brand_accent: e.target.value })} placeholder="#C39851" /></Field>
          <Button type="submit" variant="primary" icon={editing ? <Pencil className="size-4" /> : <Plus className="size-4" />} className="mb-[1px]">{editing ? "Lưu" : "Thêm thương hiệu"}</Button>
          {editing && <Button type="button" variant="ghost" icon={<X className="size-4" />} onClick={reset} className="mb-[1px]">Huỷ</Button>}
        </fieldset>
      </form>
      {err && <p className="mb-2 text-sm text-error">Lỗi: {err}</p>}
      <Table columns={columns} rows={q.data ?? []} rowKey={(b) => b.brand_id} loading={q.isLoading}
        empty={{ title: "Chưa có thương hiệu" }} density="compact" />
      {detail && <BrandDetailDrawer brand={detail} onClose={() => setDetail(null)} />}
    </Panel>
  );
}

/** Drill-down: brand + cửa hàng kèm doanh thu/đơn. */
function BrandDetailDrawer({ brand, onClose }: { brand: Brand; onClose: () => void }) {
  const dq = useQuery({ queryKey: ["brand-detail", brand.brand_id], queryFn: () => api.getBrandDetail(brand.brand_id) });
  const d = dq.data;
  const cols: Column<{ name: string; city: string | null; orders: number; revenue: number }>[] = [
    { key: "name", header: "Cửa hàng", cell: (s) => <span className="font-medium text-text">{s.name}</span> },
    { key: "city", header: "Thành phố", cell: (s) => s.city ?? "—", width: "130px" },
    { key: "orders", header: "Đơn", numeric: true, width: "90px", cell: (s) => fmtInt(s.orders) },
    { key: "revenue", header: "Doanh thu", numeric: true, width: "150px", cell: (s) => <span className="font-semibold">{fmtVndFull(s.revenue)}</span> },
  ];
  return (
    <Drawer open onClose={onClose} title={brand.name} description={`${brand.industry ?? "—"} · ${brand.brand_id}`}>
      {dq.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !d ? (
        <EmptyStateInline />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Cửa hàng" value={fmtInt(d.stores.length)} icon={<Store className="size-4" />} />
            <StatTile label="Tổng đơn" value={fmtInt(d.totalOrders)} icon={<Package className="size-4" />} />
            <StatTile label="Doanh thu" value={fmtVndFull(d.totalRevenue)} icon={<BarChart3 className="size-4" />} />
          </div>
          <Panel title="Cửa hàng theo doanh thu" icon={<Store className="size-4" />} bodyClassName="p-0">
            <Table columns={cols} rows={d.stores} rowKey={(s) => s.store_id}
              empty={{ title: "Thương hiệu chưa có cửa hàng" }} density="compact" />
          </Panel>
        </div>
      )}
    </Drawer>
  );
}

function EmptyStateInline() {
  return <p className="p-4 text-sm text-text-muted">Không tải được chi tiết thương hiệu.</p>;
}

function StoresPanel() {
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => api.listStores() });
  const [form, setForm] = useState({ store_id: "", brand_id: "", name: "", city: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setForm({ store_id: "", brand_id: "", name: "", city: "" }); setEditing(null); setErr(null); };
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["stores"] }); };

  const mut = useMutation({
    mutationFn: () =>
      editing
        ? api.updateStore(editing, {
            brand_id: form.brand_id,
            name: form.name.trim(),
            ...(form.city.trim() ? { city: form.city.trim() } : {}),
          })
        : api.createStore({
            store_id: form.store_id.trim(),
            brand_id: form.brand_id,
            name: form.name.trim(),
            ...(form.city.trim() ? { city: form.city.trim() } : {}),
          }),
    onSuccess: () => { reset(); invalidate(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi lưu cửa hàng"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteStore(id),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi xoá cửa hàng"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if ((!editing && !form.store_id.trim()) || !form.brand_id || !form.name.trim()) return;
    mut.mutate();
  }
  function edit(s: StoreT) {
    setEditing(s.store_id);
    setForm({ store_id: s.store_id, brand_id: s.brand_id, name: s.name, city: s.city ?? "" });
    setErr(null);
  }

  const brandName = (id: string) => brands.data?.find((b) => b.brand_id === id)?.name ?? id;
  const columns: Column<StoreT>[] = [
    { key: "id", header: "Mã", cell: (s) => <span className="font-mono text-xs text-text-muted">{s.store_id}</span>, width: "150px" },
    { key: "name", header: "Tên", cell: (s) => <span className="font-medium">{s.name}</span> },
    { key: "brand", header: "Thương hiệu", cell: (s) => brandName(s.brand_id) },
    { key: "city", header: "Thành phố", cell: (s) => s.city ?? "—", width: "140px" },
    { key: "act", header: "", numeric: true, width: "150px", cell: (s) => <RowActions onEdit={() => edit(s)} onDelete={() => { if (window.confirm(`Xoá cửa hàng "${s.name}"?`)) del.mutate(s.store_id); }} deleting={del.isPending} /> },
  ];

  return (
    <Panel title="Cửa hàng" icon={<Store className="size-4" />}>
      <form onSubmit={submit} className="mb-4">
        <fieldset disabled={mut.isPending} className="flex flex-wrap items-end gap-3">
          <Field className="w-36" label="Mã cửa hàng"><Input aria-label="Mã cửa hàng" value={form.store_id} disabled={!!editing} onChange={(e) => setForm({ ...form, store_id: e.target.value })} /></Field>
          <Field className="w-44" label="Thương hiệu">
            <Select aria-label="Thương hiệu của cửa hàng" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
              <option value="">— chọn —</option>
              {brands.data?.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field className="w-44" label="Tên cửa hàng"><Input aria-label="Tên cửa hàng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field className="w-36" label="Thành phố"><Input aria-label="Thành phố" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Button type="submit" variant="primary" icon={editing ? <Pencil className="size-4" /> : <Plus className="size-4" />} className="mb-[1px]">{editing ? "Lưu" : "Thêm cửa hàng"}</Button>
          {editing && <Button type="button" variant="ghost" icon={<X className="size-4" />} onClick={reset} className="mb-[1px]">Huỷ</Button>}
        </fieldset>
      </form>
      {err && <p className="mb-2 text-sm text-error">Lỗi: {err}</p>}
      {stores.isError && <p className="mb-2 text-sm text-error">Lỗi tải cửa hàng.</p>}
      <Table columns={columns} rows={stores.data ?? []} rowKey={(s) => s.store_id} loading={stores.isLoading}
        empty={{ title: "Chưa có cửa hàng" }} density="compact" />
    </Panel>
  );
}

function ProductsPanel() {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: api.listProducts });
  const [form, setForm] = useState({ product_master_id: "", name: "", unit: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setForm({ product_master_id: "", name: "", unit: "" }); setEditing(null); setErr(null); };
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["products"] }); };

  const mut = useMutation({
    mutationFn: () =>
      editing
        ? api.updateProduct(editing, { name: form.name.trim(), ...(form.unit.trim() ? { unit: form.unit.trim() } : {}) })
        : api.createProduct({ product_master_id: form.product_master_id.trim(), name: form.name.trim(), ...(form.unit.trim() ? { unit: form.unit.trim() } : {}) }),
    onSuccess: () => { reset(); invalidate(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi lưu sản phẩm"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi xoá sản phẩm"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if ((!editing && !form.product_master_id.trim()) || !form.name.trim()) return;
    mut.mutate();
  }
  function edit(p: Product) {
    setEditing(p.product_master_id);
    setForm({ product_master_id: p.product_master_id, name: p.name, unit: p.unit ?? "" });
    setErr(null);
  }

  const columns: Column<Product>[] = [
    { key: "id", header: "Mã", cell: (p) => <span className="font-mono text-xs text-text-muted">{p.product_master_id}</span>, width: "190px" },
    { key: "name", header: "Tên", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "unit", header: "Đơn vị", cell: (p) => p.unit ?? "—", width: "120px" },
    { key: "act", header: "", numeric: true, width: "150px", cell: (p) => <RowActions onEdit={() => edit(p)} onDelete={() => { if (window.confirm(`Xoá sản phẩm "${p.name}"?`)) del.mutate(p.product_master_id); }} deleting={del.isPending} /> },
  ];

  return (
    <Panel title="Sản phẩm" icon={<Package className="size-4" />}>
      <form onSubmit={submit} className="mb-4">
        <fieldset disabled={mut.isPending} className="flex flex-wrap items-end gap-3">
          <Field className="w-44" label="Mã sản phẩm"><Input aria-label="Mã sản phẩm" value={form.product_master_id} disabled={!!editing} onChange={(e) => setForm({ ...form, product_master_id: e.target.value })} /></Field>
          <Field className="w-44" label="Tên sản phẩm"><Input aria-label="Tên sản phẩm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field className="w-32" label="Đơn vị"><Input aria-label="Đơn vị sản phẩm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
          <Button type="submit" variant="primary" icon={editing ? <Pencil className="size-4" /> : <Plus className="size-4" />} className="mb-[1px]">{editing ? "Lưu" : "Thêm sản phẩm"}</Button>
          {editing && <Button type="button" variant="ghost" icon={<X className="size-4" />} onClick={reset} className="mb-[1px]">Huỷ</Button>}
        </fieldset>
      </form>
      {err && <p className="mb-2 text-sm text-error">Lỗi: {err}</p>}
      {products.isError && <p className="mb-2 text-sm text-error">Lỗi tải sản phẩm.</p>}
      <Table columns={columns} rows={products.data ?? []} rowKey={(p) => p.product_master_id} loading={products.isLoading}
        empty={{ title: "Chưa có sản phẩm" }} density="compact" />
    </Panel>
  );
}
