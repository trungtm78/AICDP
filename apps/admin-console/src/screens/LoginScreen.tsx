import { useState } from "react";
import { api } from "../lib/api.js";
import { setSession } from "../lib/auth.js";
import { ApiError } from "../lib/types.js";
import { LogoMark, Field, Input, Button, BrandConvergence } from "../ui/index.js";

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
    <div className="grid h-full lg:grid-cols-[1.15fr_1fr]">
      {/* Panel hero — ảnh di sản OCH (och.vn) phủ lớp navy→gold, ẩn trên mobile */}
      <aside className="relative hidden overflow-hidden lg:block">
        <img
          src="/och-hero.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        {/* Lớp phủ thương hiệu: navy đậm → gủ vàng nhạt (nhận diện OCH) */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(150deg, rgba(27,27,46,0.94) 0%, rgba(46,46,64,0.86) 45%, rgba(122,106,83,0.55) 100%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          {/* (Logo góc trái tạm bỏ — xử lý sau) */}
          <div />

          {/* Animation hội tụ thương hiệu — trọng tâm hero (nhiều thương hiệu → 1 OCH ID) */}
          <div className="flex flex-1 flex-col items-center justify-center py-6">
            <BrandConvergence />
            <div
              className="mt-4 max-w-md text-center"
              style={{ animation: "och-fade-up 0.7s ease-out 0.2s both" }}
            >
              <span className="mx-auto mb-4 block h-1 w-16 rounded-full" style={{ backgroundColor: "#c39851" }} />
              <h2 className="whitespace-nowrap text-[1.55rem] font-bold leading-tight tracking-tight text-white">
                Creating Legacy — Sharing Value
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/80">
                Sáu thương hiệu F&amp;B và khách sạn của One Capital Hospitality, hợp nhất về
                một mã khách hàng <span className="font-semibold text-white">OCH ID</span> duy nhất.
              </p>
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
            Customer Data Platform • Phát triển bởi AIPOWER
          </p>
        </div>
      </aside>

      {/* Panel form đăng nhập */}
      <div className="flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
            <LogoMark size={44} className="mb-3" />
            <h1 className="text-lg font-bold tracking-tight text-text">Customer Data Platform</h1>
            <p className="mt-0.5 text-sm text-text-muted">Đăng nhập hệ thống — One Capital Hospitality</p>
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
    </div>
  );
}
