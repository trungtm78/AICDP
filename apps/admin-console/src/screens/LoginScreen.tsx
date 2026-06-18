import { useState } from "react";
import { api } from "../lib/api.js";
import { setSession } from "../lib/auth.js";
import { ApiError } from "../lib/types.js";

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
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={submit}
        className="w-[360px] rounded-lg border border-border bg-surface p-6 shadow-sm"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" aria-hidden />
          <span className="font-bold tracking-tight">OCC-CDP</span>
        </div>
        <h1 className="mb-4 text-lg font-bold">Đăng nhập</h1>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-text-muted">Tên đăng nhập</span>
          <input
            aria-label="Tên đăng nhập"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input w-full"
            autoComplete="username"
          />
        </label>
        <label className="mb-4 flex flex-col gap-1">
          <span className="text-xs text-text-muted">Mật khẩu</span>
          <input
            aria-label="Mật khẩu"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full"
            autoComplete="current-password"
          />
        </label>

        {error && <p className="mb-3 text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="h-9 w-full rounded-md bg-accent font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
