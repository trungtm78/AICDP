import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, Search, Database, Flame, Gauge, ShoppingBag, User } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type RtProfile, type RecommendationV2 } from "../lib/types.js";
import { fmtInt, LIFECYCLE_LABEL, BRAND_LABEL } from "../lib/format.js";
import { PageHeader, Panel, Field, Input, Button, Badge, StatTile, StatusPill, EmptyState, useToast } from "../ui/index.js";

/** Real-time Personalization — mô phỏng widget storefront gọi Profile + Reco API (Redis cache-aside). */
export function PersonalizationScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [occId, setOccId] = useState("");
  const [loaded, setLoaded] = useState<{ profile: RtProfile | null; reco: RecommendationV2[]; profileMeta: { cacheHit: boolean; latencyMs: number }; recoMeta: { cacheHit: boolean; latencyMs: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ["rt-status"], queryFn: api.rtStatus, refetchInterval: 8000 });

  const warm = useMutation({
    mutationFn: api.rtWarm,
    onSuccess: (r) => { toast.push(r.redisUp ? `Đã nạp cache ${r.warmed} khách` : "Redis không sẵn — bỏ qua warmer", r.redisUp ? "success" : "error"); void qc.invalidateQueries({ queryKey: ["rt-status"] }); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi warmer", "error"),
  });

  async function render() {
    if (!occId.trim()) return;
    setBusy(true);
    try {
      const id = occId.trim();
      const [p, r] = await Promise.all([api.rtProfile(id), api.rtReco(id)]);
      setLoaded({
        profile: p.data, reco: r.data,
        profileMeta: p.meta as unknown as { cacheHit: boolean; latencyMs: number },
        recoMeta: r.meta as unknown as { cacheHit: boolean; latencyMs: number },
      });
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : "Lỗi personalization", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1080px] p-6">
      <PageHeader
        title="Cá nhân hoá real-time"
        description="Profile API + Recommendation API độ trễ thấp (Redis cache-aside, tự fallback Postgres). Mô phỏng widget hiển thị trên web/app storefront."
        breadcrumb={["Tích hợp", "Personalization"]}
        badge={<Badge tone={status.data?.up ? "success" : "warning"} icon={<Database className="size-3" />}>{status.data?.up ? `Redis online · ${fmtInt(status.data.keys)} keys` : "Redis offline (fallback PG)"}</Badge>}
        actions={<Button size="sm" variant="secondary" icon={<Flame className="size-3.5" />} onClick={() => warm.mutate()} loading={warm.isPending}>Nạp cache (warm)</Button>}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[320px] flex-1" label="OCH ID khách (mô phỏng phiên storefront)">
            <Input value={occId} onChange={(e) => setOccId(e.target.value)} placeholder="uuid khách hàng" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button variant="primary" onClick={render} loading={busy} disabled={!occId.trim()} className="mb-[1px]" icon={<Zap className="size-4" />}>Hiển thị widget</Button>
        </div>
      </Panel>

      {loaded && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[380px_1fr]">
          {/* Panel latency + nguồn cache */}
          <div className="space-y-4">
            <Panel title="Độ trễ & nguồn" icon={<Gauge className="size-4" />}>
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Profile API" value={`${loaded.profileMeta.latencyMs} ms`} icon={<User className="size-4" />} hint={loaded.profileMeta.cacheHit ? "cache hit" : "từ PG (miss)"} />
                <StatTile label="Reco API" value={`${loaded.recoMeta.latencyMs} ms`} icon={<ShoppingBag className="size-4" />} hint={loaded.recoMeta.cacheHit ? "cache hit" : "từ PG (miss)"} />
              </div>
              <div className="mt-3 flex gap-2">
                <Badge tone={loaded.profileMeta.cacheHit ? "success" : "neutral"}>profile: {loaded.profileMeta.cacheHit ? "Redis" : "Postgres"}</Badge>
                <Badge tone={loaded.recoMeta.cacheHit ? "success" : "neutral"}>reco: {loaded.recoMeta.cacheHit ? "Redis" : "Postgres"}</Badge>
              </div>
              <p className="mt-2 text-xs text-text-subtle">Reco precomputed thật (market-basket + cross-brand); cache tối ưu độ trễ. Bấm lại để thấy cache hit.</p>
            </Panel>
          </div>

          {/* Widget storefront mô phỏng */}
          <Panel title="Widget storefront (mô phỏng)" icon={<ShoppingBag className="size-4" />} bodyClassName="p-0">
            <div className="border-b border-border bg-surface-alt p-4">
              {loaded.profile ? (
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl brand-gradient text-base font-bold text-white">{(loaded.profile.fullName ?? "?").slice(0, 1).toUpperCase()}</span>
                  <div>
                    <div className="font-semibold text-text">Chào {loaded.profile.fullName ?? "bạn"}!</div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {loaded.profile.lifecycleStage && <StatusPill tone="accent">{LIFECYCLE_LABEL[loaded.profile.lifecycleStage] ?? loaded.profile.lifecycleStage}</StatusPill>}
                      <span>{fmtInt(loaded.profile.loyaltyAvailable)} điểm</span>
                      {loaded.profile.propensity !== null && <span>· khả năng mua {Math.round(loaded.profile.propensity * 100)}%</span>}
                    </div>
                  </div>
                </div>
              ) : <p className="text-sm text-text-muted">Không tìm thấy hồ sơ khách.</p>}
            </div>
            <div className="p-4">
              <div className="mb-2 text-sm font-semibold text-text">Gợi ý cho bạn</div>
              {loaded.reco.length === 0 ? <EmptyState title="Chưa có gợi ý" /> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {loaded.reco.slice(0, 6).map((r) => (
                    <div key={r.itemKey} className="rounded-lg border border-border bg-surface p-3">
                      <div className="mb-1 grid h-16 place-items-center rounded bg-accent-subtle text-accent"><ShoppingBag className="size-6" /></div>
                      <div className="truncate text-sm font-medium text-text">{r.name ?? r.itemKey}</div>
                      <div className="flex items-center justify-between text-[11px] text-text-subtle">
                        <span>{BRAND_LABEL[r.brandId ?? ""] ?? r.brandId ?? ""}</span>
                        <Badge tone="neutral">{r.source}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
