import { useState } from "react";
import { api } from "../lib/api.js";
import { setSession } from "../lib/auth.js";
import { ApiError } from "../lib/types.js";
import { LogoMark, Field, Input, Button } from "../ui/index.js";

/** Đăng nhập admin-console -> nhận JWT, lưu phiên, vào hệ thống. */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username.trim(), password);
      setSession(res.token, res.role, res.name);
      onLoggedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sai tên đăng nhập hoặc mật khẩu."
          : err instanceof Error
            ? err.message
            : "Lỗi đăng nhập",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={52} className="mb-3" />
          <h1 className="text-lg font-bold tracking-tight text-text">
            OCC<span className="font-medium text-text-muted"> CDP</span>
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">Customer Data Platform · OCC Group</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <Field label="Tên đăng nhập">
            <Input aria-label="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Mật khẩu">
            <Input aria-label="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>

          {error && <p className="text-sm text-error">{error}</p>}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !username.trim() || !password} loading={busy}>
            {busy ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </form>
      </div>
    </div>
  );
}
