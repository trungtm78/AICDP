import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ApiError } from "../lib/types.js";

/** Data Ops · Master Data — Brands / Stores / Products. Data 100% từ core-api. */
export function MastersScreen() {
  return (
    <section className="mx-auto max-w-[1200px] space-y-8 p-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Master Data</h1>
        <p className="text-text-muted">Thương hiệu, cửa hàng, sản phẩm chuẩn OCC (xuyên thương hiệu).</p>
      </header>
      <BrandsPanel />
      <StoresPanel />
      <ProductsPanel />
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function BrandsPanel() {
  const q = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  return (
    <Panel title="Thương hiệu">
      {q.isLoading && <p className="text-text-muted">Đang tải…</p>}
      {q.isError && <p className="text-error">Lỗi tải thương hiệu.</p>}
      {q.data && q.data.length === 0 && <p className="text-text-subtle">Chưa có thương hiệu.</p>}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-text-subtle">
              <th className="py-1">Mã</th>
              <th className="py-1">Tên</th>
              <th className="py-1">Ngành</th>
              <th className="py-1">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((b) => (
              <tr key={b.brand_id} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs">{b.brand_id}</td>
                <td className="py-1.5">{b.name}</td>
                <td className="py-1.5 text-text-muted">{b.industry ?? "—"}</td>
                <td className="py-1.5">{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

  return (
    <Panel title="Cửa hàng">
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3">
        <fieldset disabled={mut.isPending} className="contents">
        <Field label="Mã cửa hàng">
          <input
            aria-label="Mã cửa hàng"
            value={form.store_id}
            onChange={(e) => setForm({ ...form, store_id: e.target.value })}
            className="input"
          />
        </Field>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Thương hiệu</span>
          <select
            aria-label="Thương hiệu của cửa hàng"
            value={form.brand_id}
            onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
            className="h-9 rounded-md border border-border bg-surface px-2"
          >
            <option value="">— chọn —</option>
            {brands.data?.map((b) => (
              <option key={b.brand_id} value={b.brand_id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Tên cửa hàng">
          <input
            aria-label="Tên cửa hàng"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Thành phố">
          <input
            aria-label="Thành phố"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="input"
          />
        </Field>
        <button
          type="submit"
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          Thêm cửa hàng
        </button>
        </fieldset>
      </form>
      {err && <p className="mb-2 text-error">Lỗi: {err}</p>}
      {stores.isLoading && <p className="text-text-muted">Đang tải…</p>}
      {stores.isError && <p className="text-error">Lỗi tải cửa hàng.</p>}
      {stores.data && stores.data.length === 0 ? (
        <p className="text-text-subtle">Chưa có cửa hàng.</p>
      ) : (
        <ul className="divide-y divide-border">
          {stores.data?.map((s) => (
            <li key={s.store_id} className="flex justify-between py-1.5">
              <span>
                <span className="font-mono text-xs text-text-muted">{s.store_id}</span> · {s.name}
              </span>
              <span className="text-text-muted">{s.city ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
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

  return (
    <Panel title="Sản phẩm">
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3">
        <fieldset disabled={mut.isPending} className="contents">
        <Field label="Mã sản phẩm">
          <input
            aria-label="Mã sản phẩm"
            value={form.product_master_id}
            onChange={(e) => setForm({ ...form, product_master_id: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Tên sản phẩm">
          <input
            aria-label="Tên sản phẩm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Đơn vị">
          <input
            aria-label="Đơn vị sản phẩm"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            className="input"
          />
        </Field>
        <button
          type="submit"
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          Thêm sản phẩm
        </button>
        </fieldset>
      </form>
      {err && <p className="mb-2 text-error">Lỗi: {err}</p>}
      {products.isLoading && <p className="text-text-muted">Đang tải…</p>}
      {products.isError && <p className="text-error">Lỗi tải sản phẩm.</p>}
      {products.data && products.data.length === 0 ? (
        <p className="text-text-subtle">Chưa có sản phẩm.</p>
      ) : (
        <ul className="divide-y divide-border">
          {products.data?.map((p) => (
            <li key={p.product_master_id} className="flex justify-between py-1.5">
              <span>
                <span className="font-mono text-xs text-text-muted">{p.product_master_id}</span> ·{" "}
                {p.name}
              </span>
              <span className="text-text-muted">{p.unit ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </label>
  );
}
