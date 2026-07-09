import { useState } from "react";
import { Coins, Gift, Lock, Check, X, Search } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type LoyaltyBalance } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Button, StatTile, StatusPill, EmptyState } from "../ui/index.js";

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
      setReservations((rs) => [{ reservationId: res.reservationId, points: pts, status: "held" }, ...rs]);
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
        rs.map((r) => (r.reservationId === reservationId ? { ...r, status: mode === "capture" ? "captured" : "released" } : r)),
      );
      await loadBalance();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] p-6">
      <PageHeader
        title="Loyalty"
        description="Sổ điểm double-entry, balance là projection. Reserve → capture/release theo từng đơn giữ."
        breadcrumb={["Vận hành", "Loyalty"]}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[280px] flex-1" label="OCC ID">
            <Input aria-label="OCC ID" value={occId} onChange={(e) => setOccId(e.target.value)} placeholder="uuid khách hàng" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button variant="primary" onClick={loadBalance} disabled={!occId.trim() || busy} loading={busy} className="mb-[1px]">Xem số dư</Button>
        </div>
      </Panel>

      {error && <div className="mt-4"><EmptyState tone="error" icon={<X className="size-6" />} title="Lỗi" description={error} /></div>}

      {balance && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <StatTile testid="bal-available" hero label="Điểm khả dụng" value={fmtInt(balance.available)} icon={<Coins className="size-4" />} />
            <StatTile testid="bal-reserved" label="Đang giữ" value={fmtInt(balance.reserved)} icon={<Lock className="size-4" />} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm title="Cộng điểm (earn)" icon={<Gift className="size-4" />} label="Số điểm cộng" value={earnPoints} onChange={setEarnPoints} button="Cộng điểm" onSubmit={doEarn} busy={busy} />
            <ActionForm title="Giữ điểm (reserve)" icon={<Lock className="size-4" />} label="Số điểm giữ" value={reservePoints} onChange={setReservePoints} button="Giữ điểm" onSubmit={doReserve} busy={busy} />
          </div>

          {reservations.length > 0 && (
            <Panel title="Đơn giữ trong phiên" icon={<Lock className="size-4" />} bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {reservations.map((r) => (
                  <li key={r.reservationId} data-testid={`reservation-${r.reservationId}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">{r.reservationId}</span>
                    <span className="tabular font-semibold text-text">{fmtInt(r.points)}</span>
                    {r.status === "held" ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="secondary" icon={<Check className="size-3.5" />} onClick={() => settle(r.reservationId, "capture")} disabled={busy}>Chốt</Button>
                        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => settle(r.reservationId, "release")} disabled={busy}>Hủy</Button>
                      </span>
                    ) : (
                      <StatusPill tone={r.status === "captured" ? "success" : "neutral"}>{r.status === "captured" ? "đã chốt" : "đã hủy"}</StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function ActionForm(props: {
  title: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  button: string;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}>
      <Panel title={props.title} icon={props.icon}>
        <div className="flex items-end gap-3">
          <Field className="flex-1" label={props.label}>
            <Input aria-label={props.label} inputMode="numeric" value={props.value} onChange={(e) => props.onChange(e.target.value)} className="tabular" />
          </Field>
          <Button type="submit" variant="primary" disabled={props.busy || !props.value.trim()} className="mb-[1px]">{props.button}</Button>
        </div>
      </Panel>
    </form>
  );
}
