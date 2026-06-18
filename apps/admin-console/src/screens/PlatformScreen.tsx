import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ApiError, type Role } from "../lib/types.js";

const ROLES: Role[] = [
  "admin",
  "data_steward",
  "marketer",
  "csr",
  "analyst",
  "compliance",
  "executive",
  "connector",
];

/** Platform — quản trị user + API key (admin). Tạo/vô hiệu user, tạo/thu hồi key. */
export function PlatformScreen() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const keys = useQuery({ queryKey: ["apikeys"], queryFn: api.listApiKeys });
  const [error, setError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  // Tạo user
  const [u, setU] = useState({ username: "", password: "", name: "", role: "marketer" as Role });
  const createUserMut = useMutation({
    mutationFn: () => api.createUser(u.username.trim(), u.password, u.role, u.name.trim()),
    onSuccess: () => {
      setU({ username: "", password: "", name: "", role: "marketer" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi tạo user"),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "active" | "disabled" }) =>
      api.setUserStatus(v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi đổi trạng thái"),
  });

  // Tạo API key
  const [k, setK] = useState({ name: "", role: "connector" as Role });
  const createKeyMut = useMutation({
    mutationFn: () => api.createApiKey(k.name.trim(), k.role),
    onSuccess: (res) => {
      setNewRawKey(res.rawKey);
      setK({ name: "", role: "connector" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["apikeys"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi tạo key"),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["apikeys"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi thu hồi key"),
  });

  return (
    <section className="mx-auto max-w-[1100px] space-y-8 p-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Platform</h1>
        <p className="text-text-muted">Quản trị người dùng và API key (chỉ admin).</p>
      </header>

      {error && <div className="rounded-md border border-error/40 bg-surface p-3 text-error">{error}</div>}

      <Panel title="Người dùng">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (u.username.trim() && u.password && u.name.trim()) createUserMut.mutate();
          }}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <Field label="Username"><input aria-label="Username" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} className="input" /></Field>
          <Field label="Mật khẩu"><input aria-label="Mật khẩu user" type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} className="input" /></Field>
          <Field label="Họ tên"><input aria-label="Họ tên user" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} className="input" /></Field>
          <RoleSelect label="Vai trò user" value={u.role} onChange={(r) => setU({ ...u, role: r })} />
          <button type="submit" disabled={createUserMut.isPending} className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40">Tạo user</button>
        </form>

        {users.isLoading && <p className="text-text-muted">Đang tải…</p>}
        {users.isError && <p className="text-error">Lỗi tải users.</p>}
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-text-subtle">
              <th className="py-1">Username</th><th>Họ tên</th><th>Vai trò</th><th>Trạng thái</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((row) => (
              <tr key={row.id} data-testid={`user-${row.id}`} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs">{row.username}</td>
                <td>{row.name}</td>
                <td className="text-text-muted">{row.role}</td>
                <td className={row.status === "active" ? "text-success" : "text-warning"}>{row.status}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => statusMut.mutate({ id: row.id, status: row.status === "active" ? "disabled" : "active" })}
                    disabled={statusMut.isPending}
                    className="h-7 rounded-md border border-border px-2 text-xs disabled:opacity-40"
                  >
                    {row.status === "active" ? "Vô hiệu" : "Kích hoạt"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="API keys (service-to-service)">
        {newRawKey && (
          <div className="mb-4 rounded-md border border-accent/50 bg-accent/10 p-3">
            <div className="text-xs uppercase tracking-wide text-text-subtle">API key mới — sao chép ngay (chỉ hiện 1 lần)</div>
            <code data-testid="new-raw-key" className="font-mono text-sm break-all">{newRawKey}</code>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (k.name.trim()) createKeyMut.mutate();
          }}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <Field label="Tên API key"><input aria-label="Tên API key" value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} className="input" /></Field>
          <RoleSelect label="Vai trò API key" value={k.role} onChange={(r) => setK({ ...k, role: r })} />
          <button type="submit" disabled={createKeyMut.isPending} className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40">Tạo API key</button>
        </form>

        {keys.data && keys.data.length === 0 ? (
          <p className="text-text-subtle">Chưa có API key.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-text-subtle">
                <th className="py-1">Tên</th><th>Vai trò</th><th>Trạng thái</th><th></th>
              </tr>
            </thead>
            <tbody>
              {keys.data?.map((row) => (
                <tr key={row.id} data-testid={`key-${row.id}`} className="border-t border-border">
                  <td className="py-1.5">{row.name}</td>
                  <td className="text-text-muted">{row.role}</td>
                  <td className={row.status === "active" ? "text-success" : "text-warning"}>{row.status}</td>
                  <td className="text-right">
                    {row.status === "active" && (
                      <button type="button" onClick={() => revokeMut.mutate(row.id)} disabled={revokeMut.isPending} className="h-7 rounded-md border border-border px-2 text-xs disabled:opacity-40">Thu hồi</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3"><h2 className="font-semibold">{title}</h2></div>
      <div className="p-4">{children}</div>
    </div>
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

function RoleSelect({ label, value, onChange }: { label: string; value: Role; onChange: (r: Role) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Role)} className="h-9 rounded-md border border-border bg-surface px-2">
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </label>
  );
}
