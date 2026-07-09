import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { setSession } from "../lib/auth.js";
import { ApiError } from "../lib/types.js";
import { LogoMark, Field, Input, Button, BrandConvergence } from "../ui/index.js";

type AuthView = "login" | "forgot" | "sent" | "reset" | "done";

/** Đăng nhập admin-console -> nhận JWT, lưu phiên, vào hệ thống. Kèm luồng Quên mật khẩu. */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [view, setView] = useState<AuthView>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Quên mật khẩu
  const [forgotUser, setForgotUser] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null); // token demo (CORE_API_DEMO_RESET=1)
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  // Deep-link ?reset=<token> (dán link vào trình duyệt) → vào thẳng màn đặt lại.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("reset");
    if (t) {
      setResetToken(t);
      setView("reset");
    }
  }, []);

  function go(v: AuthView) {
    setError(null);
    setView(v);
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotUser.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestPasswordReset(forgotUser.trim());
      setResetToken(res.resetToken ?? null);
      setView("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi gửi yêu cầu");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetToken || newPw.length < 8 || newPw !== newPw2) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmPasswordReset(resetToken, newPw);
      setNewPw("");
      setNewPw2("");
      setView("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Lỗi đặt lại mật khẩu");
    } finally {
      setBusy(false);
    }
  }

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
          src="/och-tower.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        {/* Lớp phủ nhẹ (giữ ánh hoàng hôn của ảnh, chỉ đủ tối để chữ trắng đọc rõ) */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(170deg, rgba(27,27,46,0.62) 0%, rgba(35,33,52,0.48) 45%, rgba(46,46,64,0.62) 100%)",
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

          {view === "login" && (
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

              <div className="text-center">
                <button type="button" onClick={() => go("forgot")} className="text-sm text-text-muted underline-offset-2 hover:text-accent hover:underline">
                  Quên mật khẩu?
                </button>
              </div>
            </form>
          )}

          {view === "forgot" && (
            <form onSubmit={submitForgot} className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div>
                <h2 className="text-base font-semibold text-text">Quên mật khẩu</h2>
                <p className="mt-1 text-sm text-text-muted">Nhập tên đăng nhập — hướng dẫn đặt lại sẽ được gửi tới email đã đăng ký.</p>
              </div>
              <Field label="Tên đăng nhập">
                <Input aria-label="Tên đăng nhập quên mật khẩu" value={forgotUser} onChange={(e) => setForgotUser(e.target.value)} autoComplete="username" />
              </Field>
              {error && <p className="text-sm text-error">{error}</p>}
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !forgotUser.trim()} loading={busy}>
                {busy ? "Đang gửi…" : "Gửi hướng dẫn đặt lại"}
              </Button>
              <div className="text-center">
                <button type="button" onClick={() => go("login")} className="text-sm text-text-muted underline-offset-2 hover:text-accent hover:underline">
                  ← Về đăng nhập
                </button>
              </div>
            </form>
          )}

          {view === "sent" && (
            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div>
                <h2 className="text-base font-semibold text-text">Đã tiếp nhận yêu cầu</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi tới email đã đăng ký (hiệu lực 30 phút).
                </p>
              </div>
              {resetToken && (
                <div className="rounded-lg border border-gold-subtle bg-gold-subtle/60 p-3.5" data-testid="demo-reset-box">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-warning">Chế độ demo</div>
                  <p className="mb-2 text-xs text-text-muted">Môi trường demo không gửi email thật — bấm nút dưới để mở màn đặt lại.</p>
                  <Button size="sm" variant="secondary" onClick={() => go("reset")}>Mở màn đặt lại mật khẩu</Button>
                </div>
              )}
              <div className="text-center">
                <button type="button" onClick={() => go("login")} className="text-sm text-text-muted underline-offset-2 hover:text-accent hover:underline">
                  ← Về đăng nhập
                </button>
              </div>
            </div>
          )}

          {view === "reset" && (
            <form onSubmit={submitReset} className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div>
                <h2 className="text-base font-semibold text-text">Đặt lại mật khẩu</h2>
                <p className="mt-1 text-sm text-text-muted">Mật khẩu mới tối thiểu 8 ký tự.</p>
              </div>
              <Field label="Mật khẩu mới">
                <Input aria-label="Mật khẩu mới" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Nhập lại mật khẩu mới">
                <Input aria-label="Nhập lại mật khẩu mới" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" />
              </Field>
              {newPw && newPw.length < 8 && <p className="text-sm text-warning">Mật khẩu cần ít nhất 8 ký tự.</p>}
              {newPw2 && newPw !== newPw2 && <p className="text-sm text-warning">Hai mật khẩu chưa khớp.</p>}
              {error && <p className="text-sm text-error">{error}</p>}
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || newPw.length < 8 || newPw !== newPw2} loading={busy}>
                {busy ? "Đang đặt lại…" : "Đặt lại mật khẩu"}
              </Button>
              <div className="text-center">
                <button type="button" onClick={() => go("login")} className="text-sm text-text-muted underline-offset-2 hover:text-accent hover:underline">
                  ← Về đăng nhập
                </button>
              </div>
            </form>
          )}

          {view === "done" && (
            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm" data-testid="reset-done">
              <div>
                <h2 className="text-base font-semibold text-success">Đặt lại mật khẩu thành công</h2>
                <p className="mt-1 text-sm text-text-muted">Hãy đăng nhập bằng mật khẩu mới.</p>
              </div>
              <Button variant="primary" size="lg" className="w-full" onClick={() => go("login")}>Về đăng nhập</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
