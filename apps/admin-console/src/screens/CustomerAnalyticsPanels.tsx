import {
  TrendingUp, CalendarClock, Wallet, Store as StoreIcon, Layers, Sparkles, Lightbulb, AlertTriangle, Gift, ShoppingCart,
} from "lucide-react";
import type { CustomerAnalytics, CustomerFeature } from "../lib/types.js";
import { fmtInt, fmtVnd, fmtVndFull, BRAND_LABEL, CAT_LABEL, customerTier, nextTier } from "../lib/format.js";
import { Panel, StatTile, Badge } from "../ui/index.js";
import { BarChart, Donut } from "../ui/charts/index.js";
import { vizPalette } from "../ui/charts/theme.js";

const DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const HOTELS = new Set(["sunrise_nha_trang", "starcity_nha_trang", "dusit_hanoi"]);
const FNB = new Set(["givral", "kem_trang_tien", "fuji"]);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

// ── Rule engine: hành động kinh doanh đề xuất từ hành vi + AI ──
interface BizAction { title: string; detail: string; tone: "urgent" | "opportunity" | "nurture"; icon: "alert" | "bulb" | "gift" | "cart" }

function recommendActions(a: CustomerAnalytics, feature: CustomerFeature, totalSpend: number): BizAction[] {
  const out: BizAction[] = [];
  const tier = customerTier(totalSpend);
  const brands = new Set(a.brandBreakdown.map((b) => b.brandId));

  // 0) GIỎ HÀNG bỏ quên / đang mở — cơ hội bán TỨC THÌ, ưu tiên cao nhất (không bỏ lỡ).
  const cart = a.openCarts[0];
  if (cart) {
    const brandLabel = BRAND_LABEL[cart.brandId] ?? cart.brandId;
    if (cart.status === "abandoned") {
      out.push({
        tone: "urgent", icon: "cart",
        title: `Giỏ hàng bỏ quên ${fmtVnd(cart.value)} tại ${brandLabel}`,
        detail: `${cart.itemCount} món (${cart.items.slice(0, 3).map((it) => it.name).join(", ")}${cart.items.length > 3 ? "…" : ""}) bỏ quên ${cart.ageHours}h trên ${cart.channel ?? "web"}. Gửi nhắc hoàn tất đơn kèm ưu đãi/free-ship NGAY để cứu doanh thu.`,
      });
    } else {
      out.push({
        tone: "opportunity", icon: "cart",
        title: `Đang có giỏ mở ${fmtVnd(cart.value)} tại ${brandLabel}`,
        detail: `${cart.itemCount} món đang trong giỏ — hỗ trợ chốt đơn (gợi ý sản phẩm kèm, nhắc ưu đãi) để tăng tỉ lệ chuyển đổi.`,
      });
    }
  }

  const usesHotel = [...brands].some((b) => HOTELS.has(b));
  const usesFnb = [...brands].some((b) => FNB.has(b));
  const churn = feature.churnRisk ?? 0;
  const lc = feature.lifecycleStage;
  const highValue = tier.key === "diamond" || tier.key === "gold";

  // 1) Giữ chân — nguy cơ rời bỏ (ưu tiên cao nhất, nhất là khách giá trị lớn)
  if (churn >= 0.5 || lc === "dormant" || lc === "churned") {
    out.push({
      tone: "urgent", icon: "alert",
      title: highValue ? `Giữ chân khách ${tier.label} có nguy cơ rời` : "Kéo lại khách đang rời xa",
      detail: `Nguy cơ rời ${Math.round(churn * 100)}%${lc === "dormant" ? " · đang ngủ đông" : lc === "churned" ? " · đã ngưng mua" : ""}. Gọi CSKH${highValue ? " chăm sóc riêng" : ""} + ưu đãi cá nhân hoá theo nhóm hàng ưa thích (${CAT_LABEL[feature.favoriteCategory ?? ""] ?? feature.favoriteCategory ?? "sản phẩm quen"}).`,
    });
  }

  // 2) Đúng chu kỳ mua — quá hạn hoặc sắp tới
  if (a.cadence.daysUntilNext !== null && a.cadence.avgIntervalDays) {
    if (a.cadence.daysUntilNext < -a.cadence.avgIntervalDays * 0.3) {
      out.push({
        tone: "urgent", icon: "alert",
        title: `Quá chu kỳ mua ~${Math.abs(a.cadence.daysUntilNext)} ngày`,
        detail: `Khách thường mua mỗi ${a.cadence.avgIntervalDays} ngày nhưng đã im lặng. Gửi nhắc + ưu đãi tái mua ngay để tránh mất khách.`,
      });
    } else if (a.cadence.daysUntilNext >= 0 && a.cadence.daysUntilNext <= 7) {
      out.push({
        tone: "opportunity", icon: "bulb",
        title: `Sắp đến chu kỳ mua (~${a.cadence.daysUntilNext} ngày)`,
        detail: `Thời điểm vàng: gửi ưu đãi/gợi ý đúng lúc để chốt đơn kế tiếp (dự kiến ${fmtDate(a.cadence.predictedNextPurchaseAt)}).`,
      });
    }
  }

  // 3) Cross-sell hệ sinh thái OCH
  if (usesFnb && !usesHotel && tier.key !== "bronze") {
    out.push({
      tone: "opportunity", icon: "bulb",
      title: "Bán chéo sang khối Khách sạn",
      detail: "Khách quen F&B nhưng chưa trải nghiệm nghỉ dưỡng OCH — mời gói staycation Sunrise/StarCity/Dusit kèm ưu đãi thành viên.",
    });
  }
  if (usesHotel && !usesFnb) {
    out.push({
      tone: "opportunity", icon: "bulb",
      title: "Bán chéo sang khối F&B",
      detail: "Khách lưu trú chưa mua F&B — tặng voucher Givral/Kem Tràng Tiền trong phòng & tại sảnh để mở rộng ví chi tiêu.",
    });
  }

  // 4) Đặc quyền cho khách giá trị cao đang hoạt động
  if (highValue && (lc === "active" || lc === "vip")) {
    const nt = nextTier(totalSpend);
    out.push({
      tone: "nurture", icon: "gift",
      title: `Chăm sóc đặc quyền khách ${tier.label}`,
      detail: nt
        ? `Còn ${fmtVnd(nt.min - totalSpend)} nữa để lên hạng ${nt.label} — gợi ý mục tiêu + quà nâng hạng, early access, ưu đãi sinh nhật.`
        : "Khách hạng cao nhất — duy trì bằng đặc quyền concierge, quà tri ân, mời sự kiện riêng.",
    });
  }

  // 5) Khách mới — nuôi dưỡng
  if (lc === "new") {
    out.push({ tone: "nurture", icon: "gift", title: "Onboarding khách mới", detail: "Gửi combo dùng thử + hướng dẫn tích điểm để tạo đơn thứ 2 (thời điểm quyết định giữ chân)." });
  }

  // 6) Đơn thương hiệu — khuyến khích đa thương hiệu
  if (a.brandBreakdown.length === 1 && tier.key !== "bronze" && !out.some((o) => o.title.includes("Bán chéo"))) {
    out.push({ tone: "opportunity", icon: "bulb", title: "Khuyến khích đa thương hiệu", detail: `Mới mua ${BRAND_LABEL[a.brandBreakdown[0]!.brandId] ?? a.brandBreakdown[0]!.brandId} — voucher cross-brand để tăng số thương hiệu & gắn kết.` });
  }

  const order = { urgent: 0, opportunity: 1, nurture: 2 };
  return out.sort((x, y) => order[x.tone] - order[y.tone]).slice(0, 5);
}

const ACTION_STYLE: Record<BizAction["tone"], { border: string; bg: string; text: string; label: string }> = {
  urgent: { border: "border-error-subtle", bg: "bg-error-subtle/40", text: "text-error", label: "Ưu tiên cao" },
  opportunity: { border: "border-accent-subtle", bg: "bg-accent-subtle/40", text: "text-accent", label: "Cơ hội" },
  nurture: { border: "border-success-subtle", bg: "bg-success-subtle/40", text: "text-success", label: "Nuôi dưỡng" },
};

/** Toàn bộ phân tích chuyên sâu Customer 360. */
export function CustomerDeepAnalytics({ analytics, feature, totalSpend }: { analytics: CustomerAnalytics; feature: CustomerFeature; totalSpend: number }) {
  const a = analytics;
  const tier = customerTier(totalSpend);
  const actions = recommendActions(a, feature, totalSpend);
  const palette = vizPalette();

  const monthly = a.monthlySpend.slice(-9).map((m) => ({ label: m.month.slice(2), value: m.spend }));
  const brandData = a.brandBreakdown.map((b, i) => ({ name: BRAND_LABEL[b.brandId] ?? b.brandId, value: b.spend, color: palette[i % palette.length]! }));
  const catData = a.categoryBreakdown.filter((c) => c.categoryId).slice(0, 6).map((c) => ({ label: CAT_LABEL[c.categoryId!] ?? c.categoryId!, value: c.spend }));
  const dowMax = Math.max(1, ...a.dow);

  return (
    <div className="space-y-5">
      {/* Hành động kinh doanh đề xuất — điểm nhấn */}
      {actions.length > 0 && (
        <Panel icon={<Lightbulb className="size-4" />} title="Hành động kinh doanh đề xuất" subtitle="Từ hành vi mua + AI (churn · nhịp mua · hệ sinh thái)">
          <div className="grid gap-3 sm:grid-cols-2">
            {actions.map((ac, i) => {
              const st = ACTION_STYLE[ac.tone];
              const Icon = ac.icon === "alert" ? AlertTriangle : ac.icon === "gift" ? Gift : ac.icon === "cart" ? ShoppingCart : Sparkles;
              return (
                <div key={i} className={`rounded-lg border ${st.border} ${st.bg} p-3.5`}>
                  <div className="mb-1 flex items-center gap-2">
                    <Icon className={`size-4 ${st.text}`} />
                    <span className="text-sm font-semibold text-text">{ac.title}</span>
                    <span className={`ml-auto rounded-full border ${st.border} px-2 py-0.5 text-[10px] font-semibold uppercase ${st.text}`}>{st.label}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-text-muted">{ac.detail}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Giỏ hàng đang mở / bỏ quên — cơ hội bán tức thì */}
      {a.openCarts.length > 0 && (
        <Panel icon={<ShoppingCart className="size-4" />} title="Giỏ hàng đang mở / bỏ quên"
          subtitle="Cơ hội thúc đẩy hoàn tất đơn — không bỏ lỡ doanh thu">
          <div className="space-y-3">
            {a.openCarts.map((cart) => (
              <div key={cart.cartId} className="rounded-lg border border-border bg-surface p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {cart.status === "abandoned"
                    ? <Badge tone="error">Bỏ quên {cart.ageHours}h</Badge>
                    : <Badge tone="warning">Đang mở</Badge>}
                  <span className="text-sm font-semibold text-text">{BRAND_LABEL[cart.brandId] ?? cart.brandId}</span>
                  <span className="text-xs text-text-subtle">· {cart.channel ?? "web"} · {cart.itemCount} món</span>
                  <span className="ml-auto text-base font-bold" style={{ color: "#b3372f" }}>{fmtVndFull(cart.value)}</span>
                </div>
                <ul className="space-y-0.5">
                  {cart.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between text-xs text-text-muted">
                      <span>{it.name} <span className="text-text-subtle">× {it.quantity}</span></span>
                      <span className="tabular">{fmtVnd(it.unit_price * it.quantity)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Giá trị khách hàng */}
      <Panel icon={<Wallet className="size-4" />} title="Giá trị khách hàng (CLV)" subtitle="Lịch sử & dự đoán">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Tổng chi tiêu (LTV)" value={fmtVndFull(a.summary.totalSpend)} icon={<Wallet className="size-4" />} />
          <StatTile label="CLV dự đoán (2 năm)" value={fmtVndFull(a.predictedClv)} icon={<TrendingUp className="size-4" />} />
          <StatTile label="Giá trị đơn TB (AOV)" value={fmtVndFull(a.summary.aov)} />
          <StatTile label="Hạng" value={tier.label} />
          <StatTile label="Số đơn" value={fmtInt(a.summary.orderCount)} />
          <StatTile label="Gắn bó" value={a.summary.tenureDays === null ? "—" : `${fmtInt(a.summary.tenureDays)} ngày`} />
          <StatTile label="Đơn đầu tiên" value={fmtDate(a.summary.firstOrderAt)} />
          <StatTile label="Đơn gần nhất" value={fmtDate(a.summary.lastOrderAt)} />
        </div>
      </Panel>

      {/* Nhịp mua & dự đoán */}
      <Panel icon={<CalendarClock className="size-4" />} title="Nhịp mua & dự đoán đơn kế tiếp" subtitle="Khoảng cách giữa các đơn (inter-purchase)">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Khoảng cách mua TB" value={a.cadence.avgIntervalDays === null ? "—" : `${a.cadence.avgIntervalDays} ngày`} icon={<CalendarClock className="size-4" />} />
          <StatTile label="Dự kiến đơn kế tiếp" value={fmtDate(a.cadence.predictedNextPurchaseAt)} />
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-text-subtle">Tình trạng chu kỳ</div>
            <div className="mt-1.5">
              {a.cadence.daysUntilNext === null ? <span className="text-sm text-text-muted">Chưa đủ dữ liệu</span>
                : a.cadence.daysUntilNext < 0 ? <Badge tone="error">Quá hạn {Math.abs(a.cadence.daysUntilNext)} ngày</Badge>
                : a.cadence.daysUntilNext <= 7 ? <Badge tone="warning">Sắp mua (~{a.cadence.daysUntilNext} ngày)</Badge>
                : <Badge tone="success">Còn ~{a.cadence.daysUntilNext} ngày</Badge>}
            </div>
          </div>
        </div>
      </Panel>

      {/* Xu hướng chi tiêu + ưa thích thương hiệu */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel icon={<TrendingUp className="size-4" />} title="Xu hướng chi tiêu theo tháng">
          {monthly.length > 0
            ? <BarChart data={monthly} horizontal={false} height={240} valueFormatter={(v) => fmtVnd(v)} color={tier.color} />
            : <p className="p-4 text-sm text-text-muted">Chưa đủ dữ liệu.</p>}
        </Panel>
        <Panel icon={<Layers className="size-4" />} title="Ưa thích thương hiệu" subtitle="Tỉ trọng chi tiêu">
          {brandData.length > 0
            ? <Donut data={brandData} height={240} valueFormatter={(v) => fmtVnd(v)} centerLabel={`${a.brandBreakdown.length} TH`} />
            : <p className="p-4 text-sm text-text-muted">Chưa đủ dữ liệu.</p>}
        </Panel>
      </div>

      {/* Nhóm hàng + cửa hàng + thời điểm */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel icon={<Layers className="size-4" />} title="Ưa thích nhóm hàng">
          {catData.length > 0
            ? <BarChart data={catData} height={Math.max(160, catData.length * 42)} valueFormatter={(v) => fmtVnd(v)} color="#c39851" />
            : <p className="p-4 text-sm text-text-muted">Chưa đủ dữ liệu.</p>}
        </Panel>
        <Panel icon={<StoreIcon className="size-4" />} title="Cửa hàng & thời điểm mua">
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">Cửa hàng thường đến</div>
            <ul className="space-y-1">
              {a.topStores.slice(0, 4).map((s) => (
                <li key={s.storeId} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-text-muted">{s.storeId}</span>
                  <span className="tabular">{fmtInt(s.orders)} đơn · {fmtVnd(s.spend)}</span>
                </li>
              ))}
              {a.topStores.length === 0 && <li className="text-sm text-text-muted">—</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">Theo thứ trong tuần</div>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {a.dow.map((c, i) => (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div className="w-full rounded-t" style={{ height: `${Math.max(4, (c / dowMax) * 48)}px`, backgroundColor: "#2e2e40" }} title={`${c} đơn`} />
                  <span className="text-[10px] text-text-subtle">{DOW[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
