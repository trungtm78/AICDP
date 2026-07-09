import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Store, Package, Plus } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type Brand, type Store as StoreT, type Product } from "../lib/types.js";
import { PageHeader, Panel, Field, Input, Select, Button, Badge, Table, type Column } from "../ui/index.js";

/** Data Ops · Master Data — Brands / Stores / Products. Data 100% từ core-api. */
export function MastersScreen() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <PageHeader
        title="Master Data"
        description="Thương hiệu, cửa hàng, sản phẩm chuẩn OCC (xuyên thương hiệu)."
        breadcrumb={["Vận hành", "Data Ops"]}
      />
      <BrandsPanel />
      <StoresPanel />
      <ProductsPanel />
    </div>
  );
}

function BrandsPanel() {
  const q = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  const columns: Column<Brand>[] = [
    { key: "id", header: "Mã", cell: (b) => <span className="font-mono text-xs text-text-muted">{b.brand_id}</span>, width: "180px" },
    { key: "name", header: "Tên", cell: (b) => <span className="font-medium">{b.name}</span> },
    { key: "industry", header: "Ngành", cell: (b) => b.industry ?? "—" },
    { key: "status", header: "Trạng thái", cell: (b) => <Badge tone={b.status === "active" ? "success" : "neutral"}>{b.status}</Badge>, width: "140px" },
  ];
  return (
    <Panel title="Thương hiệu" icon={<Building2 className="size-4" />} bodyClassName="p-0">
      <Table columns={columns} rows={q.data ?? []} rowKey={(b) => b.brand_id} loading={q.isLoading}
        empty={{ title: "Chưa có thương hiệu" }} className="rounded-none border-0 shadow-none" density="compact" />
    </Panel>
  );
}

function StoresPanel() {
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => api.listStores() });
  const [form, setForm] = useState({ store_id: "", brand_id: "", name: "", city: "" });
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.createStore({
        store_id: form.store_id.trim(),
        brand_id: form.brand_id,
        name: form.name.trim(),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
      }),
    onSuccess: () => {
      setForm({ store_id: "", brand_id: "", name: "", city: "" });
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi tạo cửa hàng"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.store_id.trim() || !form.brand_id || !form.name.trim()) return;
    mut.mutate();
  }

  const brandName = (id: string) => brands.data?.find((b) => b.brand_id === id)?.name ?? id;
  const columns: Column<StoreT>[] = [
    { key: "id", header: "Mã", cell: (s) => <span className="font-mono text-xs text-text-muted">{s.store_id}</span>, width: "160px" },
    { key: "name", header: "Tên", cell: (s) => <span className="font-medium">{s.name}</span> },
    { key: "brand", header: "Thương hiệu", cell: (s) => brandName(s.brand_id) },
    { key: "city", header: "Thành phố", cell: (s) => s.city ?? "—", width: "160px" },
  ];

  return (
    <Panel title="Cửa hàng" icon={<Store className="size-4" />}>
      <form onSubmit={submit} className="mb-4">
        <fieldset disabled={mut.isPending} className="flex flex-wrap items-end gap-3">
          <Field className="w-36" label="Mã cửa hàng"><Input aria-label="Mã cửa hàng" value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} /></Field>
          <Field className="w-44" label="Thương hiệu">
            <Select aria-label="Thương hiệu của cửa hàng" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
              <option value="">— chọn —</option>
              {brands.data?.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field className="w-44" label="Tên cửa hàng"><Input aria-label="Tên cửa hàng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field className="w-36" label="Thành phố"><Input aria-label="Thành phố" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Button type="submit" variant="primary" icon={<Plus className="size-4" />} className="mb-[1px]">Thêm cửa hàng</Button>
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
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.createProduct({
        product_master_id: form.product_master_id.trim(),
        name: form.name.trim(),
        ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
      }),
    onSuccess: () => {
      setForm({ product_master_id: "", name: "", unit: "" });
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Lỗi tạo sản phẩm"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.product_master_id.trim() || !form.name.trim()) return;
    mut.mutate();
  }

  const columns: Column<Product>[] = [
    { key: "id", header: "Mã", cell: (p) => <span className="font-mono text-xs text-text-muted">{p.product_master_id}</span>, width: "200px" },
    { key: "name", header: "Tên", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "unit", header: "Đơn vị", cell: (p) => p.unit ?? "—", width: "140px" },
  ];

  return (
    <Panel title="Sản phẩm" icon={<Package className="size-4" />}>
      <form onSubmit={submit} className="mb-4">
        <fieldset disabled={mut.isPending} className="flex flex-wrap items-end gap-3">
          <Field className="w-44" label="Mã sản phẩm"><Input aria-label="Mã sản phẩm" value={form.product_master_id} onChange={(e) => setForm({ ...form, product_master_id: e.target.value })} /></Field>
          <Field className="w-44" label="Tên sản phẩm"><Input aria-label="Tên sản phẩm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field className="w-32" label="Đơn vị"><Input aria-label="Đơn vị sản phẩm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
          <Button type="submit" variant="primary" icon={<Plus className="size-4" />} className="mb-[1px]">Thêm sản phẩm</Button>
        </fieldset>
      </form>
      {err && <p className="mb-2 text-sm text-error">Lỗi: {err}</p>}
      {products.isError && <p className="mb-2 text-sm text-error">Lỗi tải sản phẩm.</p>}
      <Table columns={columns} rows={products.data ?? []} rowKey={(p) => p.product_master_id} loading={products.isLoading}
        empty={{ title: "Chưa có sản phẩm" }} density="compact" />
    </Panel>
  );
}
