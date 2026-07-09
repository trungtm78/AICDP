import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Gift, Lock, Check, X, Search, Users, Trophy, History } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type LoyaltyBalance, type LoyaltyMember, type LoyaltyLedgerEntry } from "../lib/types.js";
import { fmtInt, fmtDateTime } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Button, StatTile, StatusPill, EmptyState, Table, Drawer, Badge, Skeleton, type Column } from "../ui/index.js";

const TXN_LABEL: Record<string, string> = {
  earn: "Cộng điểm", reserve: "Giữ điểm", capture: "Chốt tiêu", release: "Hoàn giữ", adjust: "Điều chỉnh",
};
const TXN_TONE: Record<string, "success" | "warning" | "neutral"> = {
  earn: "success", reserve: "warning", capture: "neutral", release: "neutral", adjust: "neutral",
};

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
  const [drill, setDrill] = useState<LoyaltyMember | null>(null);

  function errMsg(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return err instanceof Error ? err.message : "Lỗi thao tác loyalty";
  }

  const members = useQuery({ queryKey: ["loyalty-members"], queryFn: api.listLoyaltyMembers });

  async function loadBalance(id: string = occId) {
    if (!id.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setBalance(await api.getLoyaltyBalance(id.trim()));
    } catch (err) {
      setBalance(null);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  function openMember(m: LoyaltyMember) {
    setOccId(m.occId);
    setReservations([]);
    setDrill(m);
    void loadBalance(m.occId);
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

      {/* Tổng quan chương trình điểm */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Thành viên có điểm" value={fmtInt(Number(members.data?.meta.total ?? 0))} icon={<Users className="size-4" />} />
        <StatTile label="Tổng điểm khả dụng" value={fmtInt(Number(members.data?.meta.totalPoints ?? 0))} icon={<Coins className="size-4" />} />
        <StatTile label="Top thành viên" value={fmtInt(members.data?.data?.[0]?.available ?? 0)} icon={<Trophy className="size-4" />} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[280px] flex-1" label="OCH ID">
            <Input aria-label="OCH ID" value={occId} onChange={(e) => setOccId(e.target.value)} placeholder="uuid khách hàng" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button variant="primary" onClick={() => loadBalance()} disabled={!occId.trim() || busy} loading={busy} className="mb-[1px]">Xem số dư</Button>
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

      {/* Danh sách thành viên tích điểm — luôn hiển thị (click để xem lịch sử điểm) */}
      <div className="mt-6">
        <LoyaltyMembers members={members.data?.data ?? []} loading={members.isLoading} onOpen={openMember} />
      </div>

      {drill && <LedgerDrawer member={drill} balance={balance} onClose={() => setDrill(null)} />}
    </div>
  );
}

/** Drill-down: lịch sử điểm của một thành viên (số dư + dòng ledger luỹ kế). */
function LedgerDrawer({ member, balance, onClose }: { member: LoyaltyMember; balance: LoyaltyBalance | null; onClose: () => void }) {
  const ledger = useQuery({
    queryKey: ["loyalty-ledger", member.occId],
    queryFn: () => api.getLoyaltyLedger(member.occId),
  });
  const columns: Column<LoyaltyLedgerEntry>[] = [
    {
      key: "type", header: "Loại", width: "104px",
      cell: (r) => <Badge tone={TXN_TONE[r.type] ?? "neutral"}>{TXN_LABEL[r.type] ?? r.type}</Badge>,
    },
    {
      key: "delta", header: "Điểm", numeric: true, width: "96px",
      cell: (r) => <span className={`font-semibold tabular ${r.pointsDelta >= 0 ? "text-accent" : "text-error"}`}>{r.pointsDelta >= 0 ? "+" : ""}{fmtInt(r.pointsDelta)}</span>,
    },
    { key: "after", header: "Số dư sau", numeric: true, width: "104px", cell: (r) => <span className="tabular text-text-muted">{fmtInt(r.availableAfter)}</span> },
    { key: "at", header: "Thời gian", cell: (r) => <span className="tabular text-xs text-text-subtle">{fmtDateTime(r.createdAt)}</span>, width: "104px" },
  ];
  return (
    <Drawer open onClose={onClose} title={`Lịch sử điểm — ${member.fullName ?? "(chưa có tên)"}`}
      description={member.occId}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Điểm khả dụng" value={fmtInt(balance?.available ?? member.available)} icon={<Coins className="size-4" />} />
          <StatTile label="Tổng đã tích" value={fmtInt(member.totalEarned)} icon={<Trophy className="size-4" />} />
        </div>
        <Panel title="Dòng sổ điểm" icon={<History className="size-4" />} subtitle="Mới nhất trước, kèm số dư khả dụng sau mỗi giao dịch" bodyClassName="p-0">
          {ledger.isLoading ? (
            <div className="p-4"><Skeleton className="h-40 w-full" /></div>
          ) : (
            <Table columns={columns} rows={ledger.data ?? []} rowKey={(r, i) => `${r.txnId}-${i}`}
              empty={{ title: "Chưa có giao dịch điểm" }} density="compact" />
          )}
        </Panel>
      </div>
    </Drawer>
  );
}

function LoyaltyMembers({ members, loading, onOpen }: { members: LoyaltyMember[]; loading: boolean; onOpen: (m: LoyaltyMember) => void }) {
  const columns: Column<LoyaltyMember>[] = [
    {
      key: "rank", header: "#", width: "48px",
      cell: (_m, i) => <span className="tabular text-xs font-semibold text-text-subtle">{i + 1}</span>,
    },
    {
      key: "name", header: "Khách hàng",
      cell: (m) => (
        <div>
          <div className="font-medium text-text">{m.fullName ?? "(chưa có tên)"}</div>
          <div className="font-mono text-[11px] text-text-subtle">{m.occId}</div>
        </div>
      ),
    },
    { key: "earned", header: "Đã tích", numeric: true, cell: (m) => fmtInt(m.totalEarned), width: "120px" },
    { key: "available", header: "Khả dụng", numeric: true, cell: (m) => <span className="font-semibold text-accent">{fmtInt(m.available)}</span>, width: "120px" },
  ];
  return (
    <Panel title="Thành viên tích điểm" icon={<Trophy className="size-4" />} subtitle="Bảng xếp hạng theo điểm khả dụng — bấm để xem số dư & thao tác" bodyClassName="p-0">
      <Table columns={columns} rows={members} rowKey={(m) => m.occId} loading={loading}
        onRowClick={onOpen} empty={{ title: "Chưa có thành viên tích điểm" }} density="compact" />
    </Panel>
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
