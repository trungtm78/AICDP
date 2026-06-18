import { useState } from "react";
import { api } from "../lib/api.js";
import { ApiError, type LoyaltyBalance } from "../lib/types.js";

interface ReservationRow {
  reservationId: string;
  points: number;
  status: "held" | "captured" | "released";
}

const newKey = () => crypto.randomUUID();

/** Loyalty — số dư (projection) + earn + reserve/capture/release theo reservation cụ thể. */
export function LoyaltyScreen() {
  const [occId, setOccId] = useState("");
  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [earnPoints, setEarnPoints] = useState("");
  const [reservePoints, setReservePoints] = useState("");
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function errMsg(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return err instanceof Error ? err.message : "Lỗi thao tác loyalty";
  }

  async function loadBalance() {
    if (!occId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setBalance(await api.getLoyaltyBalance(occId.trim()));
    } catch (err) {
      setBalance(null);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  function parsePts(v: string): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async function doEarn() {
    const pts = parsePts(earnPoints);
    if (!occId.trim() || pts === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.loyaltyEarn(occId.trim(), pts, newKey());
      setEarnPoints("");
      await loadBalance();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function doReserve() {
    const pts = parsePts(reservePoints);
    if (!occId.trim() || pts === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.loyaltyReserve(occId.trim(), pts, newKey());
      setReservations((rs) => [
        { reservationId: res.reservationId, points: pts, status: "held" },
        ...rs,
      ]);
      setReservePoints("");
      await loadBalance();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function settle(reservationId: string, mode: "capture" | "release") {
    setBusy(true);
    setError(null);
    try {
      if (mode === "capture") await api.loyaltyCapture(reservationId, newKey());
      else await api.loyaltyRelease(reservationId, newKey());
      setReservations((rs) =>
        rs.map((r) =>
          r.reservationId === reservationId
            ? { ...r, status: mode === "capture" ? "captured" : "released" }
            : r,
        ),
      );
      await loadBalance();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-[960px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Loyalty</h1>
        <p className="text-text-muted">
          Sổ điểm double-entry, balance là projection. Reserve→capture/release theo từng đơn giữ.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">OCC ID</span>
          <input
            aria-label="OCC ID"
            value={occId}
            onChange={(e) => setOccId(e.target.value)}
            placeholder="uuid khách hàng"
            className="input w-full font-mono"
          />
        </label>
        <button
          type="button"
          onClick={loadBalance}
          disabled={!occId.trim() || busy}
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          Xem số dư
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-error/40 bg-surface p-3 text-error">
          {error}
        </div>
      )}

      {balance && (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border bg-surface">
            <div className="p-4">
              <div className="text-xs uppercase tracking-wide text-text-subtle">Khả dụng</div>
              <div data-testid="bal-available" className="tabular text-2xl font-bold">
                {balance.available}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs uppercase tracking-wide text-text-subtle">Đang giữ</div>
              <div data-testid="bal-reserved" className="tabular text-2xl font-bold">
                {balance.reserved}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <ActionForm
              title="Cộng điểm (earn)"
              label="Số điểm cộng"
              value={earnPoints}
              onChange={setEarnPoints}
              button="Cộng điểm"
              onSubmit={doEarn}
              busy={busy}
            />
            <ActionForm
              title="Giữ điểm (reserve)"
              label="Số điểm giữ"
              value={reservePoints}
              onChange={setReservePoints}
              button="Giữ điểm"
              onSubmit={doReserve}
              busy={busy}
            />
          </div>

          {reservations.length > 0 && (
            <div className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-subtle">
                Đơn giữ trong phiên
              </div>
              <ul className="divide-y divide-border">
                {reservations.map((r) => (
                  <li
                    key={r.reservationId}
                    data-testid={`reservation-${r.reservationId}`}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-text-muted">
                      {r.reservationId}
                    </span>
                    <span className="tabular font-medium">{r.points}</span>
                    {r.status === "held" ? (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => settle(r.reservationId, "capture")}
                          disabled={busy}
                          className="h-8 rounded-md border border-border bg-surface-alt px-3 disabled:opacity-40"
                        >
                          Chốt
                        </button>
                        <button
                          type="button"
                          onClick={() => settle(r.reservationId, "release")}
                          disabled={busy}
                          className="h-8 rounded-md border border-border bg-surface-alt px-3 disabled:opacity-40"
                        >
                          Hủy
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {r.status === "captured" ? "đã chốt" : "đã hủy"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ActionForm(props: {
  title: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  button: string;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <div className="text-xs uppercase tracking-wide text-text-subtle">{props.title}</div>
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">{props.label}</span>
          <input
            aria-label={props.label}
            inputMode="numeric"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            className="input tabular"
          />
        </label>
        <button
          type="submit"
          disabled={props.busy || !props.value.trim()}
          className="h-9 rounded-md bg-accent px-4 font-medium text-accent-fg disabled:opacity-40"
        >
          {props.button}
        </button>
      </div>
    </form>
  );
}
