import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, KeyRound, UserPlus, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type Role, type UserSummary, type ApiKeySummary } from "../lib/types.js";
import { PageHeader, Panel, Field, Input, Select, Button, Badge, StatusPill, Table, type Column } from "../ui/index.js";

const ROLES: Role[] = ["admin", "data_steward", "marketer", "csr", "analyst", "compliance", "executive", "connector"];

/** Platform — quản trị user + API key (admin). */
export function PlatformScreen() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const keys = useQuery({ queryKey: ["apikeys"], queryFn: api.listApiKeys });
  const [error, setError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

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
    mutationFn: (v: { id: string; status: "active" | "disabled" }) => api.setUserStatus(v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi đổi trạng thái"),
  });

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

  const userCols: Column<UserSummary>[] = [
    { key: "username", header: "Username", cell: (r) => <span className="font-mono text-xs">{r.username}</span> },
    { key: "name", header: "Họ tên", cell: (r) => r.name },
    { key: "role", header: "Vai trò", cell: (r) => <Badge tone="neutral">{r.role}</Badge> },
    { key: "status", header: "Trạng thái", cell: (r) => <StatusPill tone={r.status === "active" ? "success" : "warning"}>{r.status}</StatusPill> },
    {
      key: "act", header: "", numeric: true,
      cell: (r) => (
        <Button size="sm" variant="secondary" onClick={() => statusMut.mutate({ id: r.id, status: r.status === "active" ? "disabled" : "active" })} disabled={statusMut.isPending}>
          {r.status === "active" ? "Vô hiệu" : "Kích hoạt"}
        </Button>
      ),
    },
  ];

  const keyCols: Column<ApiKeySummary>[] = [
    { key: "name", header: "Tên", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "role", header: "Vai trò", cell: (r) => <Badge tone="neutral">{r.role}</Badge> },
    { key: "status", header: "Trạng thái", cell: (r) => <StatusPill tone={r.status === "active" ? "success" : "warning"}>{r.status}</StatusPill> },
    {
      key: "act", header: "", numeric: true,
      cell: (r) => r.status === "active" ? (
        <Button size="sm" variant="ghost" onClick={() => revokeMut.mutate(r.id)} disabled={revokeMut.isPending}>Thu hồi</Button>
      ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-6">
      <PageHeader title="Platform" description="Quản trị người dùng và API key (chỉ admin)." breadcrumb={["Quản trị", "Platform"]} />

      {error && <div className="flex items-center gap-2 rounded-lg border border-error-subtle bg-error-subtle px-4 py-2.5 text-sm text-error"><ShieldAlert className="size-4" />{error}</div>}

      <Panel title="Người dùng" icon={<Users className="size-4" />}>
        <form onSubmit={(e) => { e.preventDefault(); if (u.username.trim() && u.password && u.name.trim()) createUserMut.mutate(); }} className="mb-4">
          <fieldset disabled={createUserMut.isPending} className="flex flex-wrap items-end gap-3">
            <Field className="w-40" label="Username"><Input aria-label="Username" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} /></Field>
            <Field className="w-40" label="Mật khẩu"><Input aria-label="Mật khẩu user" type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></Field>
            <Field className="w-40" label="Họ tên"><Input aria-label="Họ tên user" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
            <Field className="w-40" label="Vai trò">
              <Select aria-label="Vai trò user" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="primary" icon={<UserPlus className="size-4" />} loading={createUserMut.isPending} className="mb-[1px]">Tạo user</Button>
          </fieldset>
        </form>
        <Table columns={userCols} rows={users.data ?? []} rowKey={(r) => r.id} rowTestId={(r) => `user-${r.id}`}
          loading={users.isLoading} empty={{ title: "Chưa có người dùng" }} density="compact" />
      </Panel>

      <Panel title="API keys (service-to-service)" icon={<KeyRound className="size-4" />}>
        {newRawKey && (
          <div className="mb-4 rounded-lg border border-accent-subtle bg-accent-subtle/50 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">API key mới — sao chép ngay (chỉ hiện 1 lần)</div>
            <code data-testid="new-raw-key" className="break-all font-mono text-sm text-text">{newRawKey}</code>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (k.name.trim()) createKeyMut.mutate(); }} className="mb-4">
          <fieldset disabled={createKeyMut.isPending} className="flex flex-wrap items-end gap-3">
            <Field className="w-52" label="Tên API key"><Input aria-label="Tên API key" value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} /></Field>
            <Field className="w-40" label="Vai trò">
              <Select aria-label="Vai trò API key" value={k.role} onChange={(e) => setK({ ...k, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />} loading={createKeyMut.isPending} className="mb-[1px]">Tạo API key</Button>
          </fieldset>
        </form>
        <Table columns={keyCols} rows={keys.data ?? []} rowKey={(r) => r.id} rowTestId={(r) => `key-${r.id}`}
          loading={keys.isLoading} empty={{ title: "Chưa có API key" }} density="compact" />
      </Panel>
    </div>
  );
}
