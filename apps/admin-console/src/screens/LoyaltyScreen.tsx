import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Lock, Check, X, Search, Users, Trophy, History, Wallet, Layers, Ticket, Target, Scale } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type LoyaltyBalance, type LoyaltyMember, type LoyaltyLedgerEntry } from "../lib/types.js";
import { fmtInt, fmtDateTime } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Button, StatTile, StatusPill, EmptyState, Table, Drawer, Badge, Skeleton, Tabs, type Column } from "../ui/index.js";

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

      {/* Cấu hình chương trình (hạng/rule/reward) + nghĩa vụ điểm coalition */}
      <div className="mt-6">
        <ProgramLiabilityPanel />
      </div>

      {drill && <Member360Drawer member={drill} balance={balance} onClose={() => setDrill(null)} />}
    </div>
  );
}

/** Cấu hình chương trình coalition (hạng, earn-rule, reward) + nghĩa vụ điểm (IFRS15) — read-only overview. */
function ProgramLiabilityPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("tiers");
  const groups = useQuery({ queryKey: ["loyalty-tier-groups"], queryFn: () => api.getLoyaltyTierGroups() });
  const rules = useQuery({ queryKey: ["loyalty-earn-rules"], queryFn: () => api.getLoyaltyEarnRules() });
  const rewards = useQuery({ queryKey: ["loyalty-rewards"], queryFn: () => api.getLoyaltyRewards() });
  const liability = useQuery({ queryKey: ["loyalty-liability"], queryFn: () => api.getLoyaltyLiability() });
  const liabRows = liability.data ?? [];
  const totalDeferred = liabRows.reduce((s, r) => s + (r.deferredRevenue ?? 0), 0);
  const [busy, setBusy] = useState(false);
  const [rk, setRk] = useState(""); const [rname, setRname] = useState(""); const [rrate, setRrate] = useState("");
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);
  async function createRule() {
    if (!rk.trim() || !rname.trim() || !(Number(rrate) > 0)) return;
    setBusy(true); setCfgMsg(null);
    try { await api.loyaltyCreateEarnRule({ ruleKey: rk.trim(), name: rname.trim(), currencyCode: "OCC_POINT", ratePerUnit: Number(rrate) }); setRk(""); setRname(""); setRrate(""); void qc.invalidateQueries({ queryKey: ["loyalty-earn-rules"] }); setCfgMsg("Đã tạo/cập nhật quy tắc (append-only)"); }
    catch (e) { setCfgMsg(e instanceof ApiError ? e.message : "Lỗi tạo quy tắc"); }
    finally { setBusy(false); }
  }
  async function snapshot() {
    setBusy(true); setCfgMsg(null);
    try { await api.loyaltyLiabilitySnapshot(); void qc.invalidateQueries({ queryKey: ["loyalty-liability"] }); setCfgMsg("Đã chốt snapshot nghĩa vụ điểm"); }
    catch (e) { setCfgMsg(e instanceof ApiError ? e.message : "Lỗi chốt snapshot"); }
    finally { setBusy(false); }
  }
  return (
    <Panel title="Chương trình & Nghĩa vụ điểm (coalition)" icon={<Trophy className="size-4" />} subtitle="Hạng · quy tắc tích · ưu đãi · nghĩa vụ điểm IFRS15 theo pháp nhân" bodyClassName="p-0">
      <Tabs className="px-4 pt-3" value={tab} onChange={setTab} items={[
        { value: "tiers", label: "Hạng", icon: <Layers className="size-4" /> },
        { value: "rules", label: "Quy tắc tích", icon: <Target className="size-4" /> },
        { value: "rewards", label: "Ưu đãi", icon: <Gift className="size-4" /> },
        { value: "liability", label: "Nghĩa vụ điểm", icon: <Scale className="size-4" /> },
      ]} />
      <div className="p-4">
        {cfgMsg && <div className="mb-3 rounded-md bg-accent/10 px-3 py-2 text-xs text-accent">{cfgMsg}</div>}
        {tab === "rules" && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted/40 p-2">
            <Field className="w-32" label="Mã quy tắc"><Input aria-label="Mã quy tắc" value={rk} onChange={(e) => setRk(e.target.value)} /></Field>
            <Field className="min-w-[140px] flex-1" label="Tên"><Input aria-label="Tên quy tắc" value={rname} onChange={(e) => setRname(e.target.value)} /></Field>
            <Field className="w-32" label="Điểm/1đ (rate)"><Input aria-label="Rate" inputMode="decimal" value={rrate} onChange={(e) => setRrate(e.target.value)} className="tabular" /></Field>
            <Button variant="secondary" className="mb-[1px]" disabled={busy} onClick={createRule}>Tạo quy tắc</Button>
          </div>
        )}
        {tab === "liability" && (
          <div className="mb-3"><Button variant="secondary" disabled={busy} onClick={snapshot} icon={<Scale className="size-4" />}>Chốt snapshot nghĩa vụ điểm</Button></div>
        )}
        {tab === "tiers" && (
          <div className="space-y-3">
            {(groups.data ?? []).map((g) => (
              <div key={g.id}>
                <div className="mb-1 text-xs font-semibold text-text-muted">{g.name} · {g.qualifyMetric} · review {g.reviewMonths} tháng ({g.reviewCycle})</div>
                <div className="flex flex-wrap gap-2">
                  {g.tiers.map((t) => (<Badge key={t.id} tone={t.level === 0 ? "neutral" : "success"}>{t.name} · ngưỡng {fmtInt(t.threshold)}</Badge>))}
                </div>
              </div>
            ))}
            {(groups.data ?? []).length === 0 && <EmptyState title="Chưa có nhóm hạng" />}
          </div>
        )}
        {tab === "rules" && (
          <ul className="divide-y divide-border text-sm">
            {(rules.data ?? []).map((r) => (
              <li key={r.ruleKey} className="flex items-center justify-between py-2">
                <span className="text-text">{r.name} <span className="text-text-subtle">({r.brandId ?? "mọi brand"}/{r.channel ?? "mọi kênh"})</span></span>
                <span className="tabular text-text-muted">{r.ratePerUnit}×{r.multiplier} → {r.currencyCode}{r.qualifying ? "" : " (non-qual)"}</span>
              </li>
            ))}
            {(rules.data ?? []).length === 0 && <EmptyState title="Chưa có quy tắc tích điểm" />}
          </ul>
        )}
        {tab === "rewards" && (
          <ul className="divide-y divide-border text-sm">
            {(rewards.data ?? []).map((r) => (
              <li key={r.code} className="flex items-center justify-between py-2">
                <span className="text-text">{r.name} <span className="text-text-subtle">{r.redeemableAtBrandId ? `@${r.redeemableAtBrandId}` : "· mọi brand"}</span></span>
                <span className="tabular text-accent">{fmtInt(r.costPoints)} {r.currencyCode}</span>
              </li>
            ))}
            {(rewards.data ?? []).length === 0 && <EmptyState title="Chưa có ưu đãi" />}
          </ul>
        )}
        {tab === "liability" && (
          <div className="space-y-3">
            <StatTile hero label="Deferred revenue (nghĩa vụ điểm dự kiến)" value={fmtInt(Math.round(totalDeferred))} icon={<Scale className="size-4" />} />
            <ul className="divide-y divide-border text-sm">
              {liabRows.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span className="text-text">{r.companyCode ?? "(chưa gắn pháp nhân)"} · {r.currencyCode}</span>
                  <span className="tabular text-text-muted">{fmtInt(r.outstandingPoints)}đ × {r.unitValue} · breakage {Math.round(r.breakageRate * 100)}% → {fmtInt(Math.round(r.deferredRevenue))}</span>
                </li>
              ))}
              {liabRows.length === 0 && <EmptyState title="Chưa có snapshot nghĩa vụ (chốt tại /liability/snapshot)" />}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Member-360 loyalty: ví đa-currency + hạng + voucher + challenge + stored-value + lịch sử điểm. */
function Member360Drawer({ member, balance, onClose }: { member: LoyaltyMember; balance: LoyaltyBalance | null; onClose: () => void }) {
  const occ = member.occId;
  const wallets = useQuery({ queryKey: ["loyalty-wallets", occ], queryFn: () => api.getLoyaltyWallets(occ) });
  const tiers = useQuery({ queryKey: ["loyalty-mtiers", occ], queryFn: () => api.getMemberTiers(occ) });
  const vouchers = useQuery({ queryKey: ["loyalty-vouchers", occ], queryFn: () => api.getMemberVouchers(occ) });
  const challenges = useQuery({ queryKey: ["loyalty-challenges", occ], queryFn: () => api.getChallengeProgress(occ) });
  const sv = useQuery({ queryKey: ["loyalty-sv", occ], queryFn: () => api.getStoredValueBalance(occ) });
  const ledger = useQuery({
    queryKey: ["loyalty-ledger", occ],
    queryFn: () => api.getLoyaltyLedger(occ),
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
    <Drawer open onClose={onClose} title={`Member-360 — ${member.fullName ?? "(chưa có tên)"}`}
      description={member.occId}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Điểm khả dụng" value={fmtInt(balance?.available ?? member.available)} icon={<Coins className="size-4" />} />
          <StatTile label="Tổng đã tích" value={fmtInt(member.totalEarned)} icon={<Trophy className="size-4" />} />
          <StatTile label="Ví tiền (stored-value)" value={fmtInt(sv.data?.balance ?? 0)} icon={<Wallet className="size-4" />} />
        </div>

        {/* Ví đa-currency + Hạng */}
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Ví điểm (đa loại)" icon={<Wallet className="size-4" />} bodyClassName="p-0">
            <ul className="divide-y divide-border text-sm">
              {(wallets.data ?? []).map((w) => (
                <li key={w.currencyId} className="flex items-center justify-between px-4 py-2">
                  <span className="text-text">{w.currencyName} <span className="text-text-subtle">({w.currencyCode})</span></span>
                  <span className="tabular font-semibold text-accent">{fmtInt(w.available)}{w.reserved > 0 ? ` · giữ ${fmtInt(w.reserved)}` : ""}</span>
                </li>
              ))}
              {(wallets.data ?? []).length === 0 && <li className="px-4 py-3 text-xs text-text-subtle">Chưa có ví điểm</li>}
            </ul>
          </Panel>
          <Panel title="Hạng thành viên" icon={<Layers className="size-4" />} bodyClassName="p-0">
            <ul className="divide-y divide-border text-sm">
              {(tiers.data ?? []).map((t) => (
                <li key={t.tierGroupCode} className="flex items-center justify-between px-4 py-2">
                  <span className="text-text">{t.tierGroupCode}</span>
                  <span className="flex items-center gap-2"><Badge tone={t.level >= 2 ? "success" : "neutral"}>{t.tierName}</Badge><span className="tabular text-text-subtle">{fmtInt(t.qualifyingValue)}</span></span>
                </li>
              ))}
              {(tiers.data ?? []).length === 0 && <li className="px-4 py-3 text-xs text-text-subtle">Chưa xếp hạng</li>}
            </ul>
          </Panel>
        </div>

        {/* Voucher + Challenge */}
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Voucher" icon={<Ticket className="size-4" />} bodyClassName="p-0">
            <ul className="divide-y divide-border text-sm">
              {(vouchers.data ?? []).map((v) => (
                <li key={v.code} className="flex items-center justify-between px-4 py-2">
                  <span className="font-mono text-xs text-text">{v.code}</span>
                  <span className="flex items-center gap-2">
                    <StatusPill tone={v.state === "active" ? "success" : "neutral"}>{v.state}</StatusPill>
                    <span className="tabular text-text-subtle">{v.remainingValue != null ? fmtInt(v.remainingValue) : (v.value != null ? `${v.value}${v.valueType === "PERCENT" ? "%" : ""}` : "")}</span>
                  </span>
                </li>
              ))}
              {(vouchers.data ?? []).length === 0 && <li className="px-4 py-3 text-xs text-text-subtle">Chưa có voucher</li>}
            </ul>
          </Panel>
          <Panel title="Challenge / Gamification" icon={<Target className="size-4" />} bodyClassName="p-0">
            <ul className="divide-y divide-border text-sm">
              {(challenges.data ?? []).map((c, i) => (
                <li key={`${c.challengeCode}-${c.cycle}-${i}`} className="flex items-center justify-between px-4 py-2">
                  <span className="text-text">{c.challengeCode} <span className="text-text-subtle">#{c.cycle}</span></span>
                  <span className="flex items-center gap-2">
                    {c.completedAt ? <Badge tone="success">hoàn thành +{fmtInt(c.rewardPoints)}</Badge> : <span className="tabular text-text-subtle">{fmtInt(c.progress)}/{fmtInt(c.target)}</span>}
                  </span>
                </li>
              ))}
              {(challenges.data ?? []).length === 0 && <li className="px-4 py-3 text-xs text-text-subtle">Chưa tham gia challenge</li>}
            </ul>
          </Panel>
        </div>

        <MemberOps occId={occ} />

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

/** Thao tác vận hành khách (loyalty_ops): điều chỉnh điểm, đổi thưởng, nạp ví, phát thẻ, xếp hạng lại. */
function MemberOps({ occId }: { occId: string }) {
  const qc = useQueryClient();
  const rewards = useQuery({ queryKey: ["loyalty-rewards"], queryFn: () => api.getLoyaltyRewards() });
  const [adjustPts, setAdjustPts] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [topupAmt, setTopupAmt] = useState("");
  const [rewardCode, setRewardCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const key = () => crypto.randomUUID();
  function refresh() {
    for (const k of ["loyalty-wallets", "loyalty-mtiers", "loyalty-vouchers", "loyalty-sv", "loyalty-ledger"]) void qc.invalidateQueries({ queryKey: [k, occId] });
    void qc.invalidateQueries({ queryKey: ["loyalty-members"] });
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { const t = await fn(); setMsg({ ok: true, text: t }); refresh(); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Lỗi thao tác" }); }
    finally { setBusy(false); }
  }
  const adjInt = Number(adjustPts);
  return (
    <Panel title="Thao tác vận hành" icon={<Coins className="size-4" />} subtitle="Điều chỉnh điểm · đổi thưởng · nạp ví · phát thẻ · xếp hạng lại">
      <div className="space-y-3">
        {msg && <div className={`rounded-md px-3 py-2 text-xs ${msg.ok ? "bg-accent/10 text-accent" : "bg-error/10 text-error"}`}>{msg.text}</div>}
        {/* Điều chỉnh điểm (± có lý do) */}
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-28" label="Điều chỉnh (±)"><Input aria-label="Điều chỉnh điểm" inputMode="numeric" value={adjustPts} onChange={(e) => setAdjustPts(e.target.value)} className="tabular" /></Field>
          <Field className="min-w-[160px] flex-1" label="Lý do"><Input aria-label="Lý do điều chỉnh" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} /></Field>
          <Button variant="secondary" className="mb-[1px]" disabled={busy || !Number.isInteger(adjInt) || adjInt === 0 || !adjustReason.trim()}
            onClick={() => run(async () => { await api.loyaltyAdjust(occId, adjInt, undefined, adjustReason.trim(), key()); setAdjustPts(""); setAdjustReason(""); return `Đã điều chỉnh ${adjInt > 0 ? "+" : ""}${adjInt} điểm`; })}>Điều chỉnh</Button>
        </div>
        {/* Đổi thưởng */}
        <div className="flex flex-wrap items-end gap-2">
          <Field className="min-w-[200px] flex-1" label="Đổi thưởng (reward)">
            <select aria-label="Chọn reward" value={rewardCode} onChange={(e) => setRewardCode(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text">
              <option value="">— chọn ưu đãi —</option>
              {(rewards.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.name} ({r.costPoints} {r.currencyCode})</option>)}
            </select>
          </Field>
          <Button variant="secondary" className="mb-[1px]" disabled={busy || !rewardCode}
            onClick={() => run(async () => { const r = await api.loyaltyRedeemReward(occId, rewardCode, key()); return `Đã đổi ${rewardCode}${r.voucherCode ? ` → voucher ${r.voucherCode}` : ""}`; })}>Đổi</Button>
        </div>
        {/* Nạp ví + phát thẻ + xếp hạng */}
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-32" label="Nạp ví (VND)"><Input aria-label="Nạp ví" inputMode="numeric" value={topupAmt} onChange={(e) => setTopupAmt(e.target.value)} className="tabular" /></Field>
          <Button variant="secondary" className="mb-[1px]" disabled={busy || !(Number(topupAmt) > 0)}
            onClick={() => run(async () => { const r = await api.loyaltyTopUp(occId, Number(topupAmt), key()); setTopupAmt(""); return `Ví: ${fmtInt(r.balance)}đ`; })}>Nạp</Button>
          <Button variant="ghost" className="mb-[1px]" disabled={busy}
            onClick={() => run(async () => { const c = await api.loyaltyIssueCard(occId); return `Thẻ: ${c.cardNo}`; })}>Phát thẻ</Button>
          <Button variant="ghost" className="mb-[1px]" disabled={busy}
            onClick={() => run(async () => { await api.loyaltyRecomputeTier(occId); return "Đã tính lại hạng"; })}>Xếp hạng lại</Button>
        </div>
      </div>
    </Panel>
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
