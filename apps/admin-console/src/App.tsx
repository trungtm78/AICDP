import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, UserRound, Gift, Database, ChartColumnBig, Target, Waypoints,
  Sparkles, BrainCircuit, ShieldCheck, Server, Search, Bell, LogOut, Command as CommandIcon,
  Sun, Moon, Plug, Gauge, type LucideIcon,
} from "lucide-react";
import { getToken, getName, getRole, clearSession } from "./lib/auth.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { CustomersScreen } from "./screens/CustomersScreen.js";
import { MastersScreen } from "./screens/MastersScreen.js";
import { LoyaltyScreen } from "./screens/LoyaltyScreen.js";
import { GovernanceScreen } from "./screens/GovernanceScreen.js";
import { AudiencesScreen } from "./screens/AudiencesScreen.js";
import { ControlTowerScreen } from "./screens/ControlTowerScreen.js";
import { JourneysScreen } from "./screens/JourneysScreen.js";
import { JourneyDetail } from "./screens/journey/JourneyDetail.js";
import { PlatformScreen } from "./screens/PlatformScreen.js";
import { AiGovernanceScreen } from "./screens/AiGovernanceScreen.js";
import { InsightsScreen } from "./screens/InsightsScreen.js";
import { AssistantScreen } from "./screens/AssistantScreen.js";
import { ConnectorsScreen } from "./screens/ConnectorsScreen.js";
import { PipelineCanvas } from "./screens/connector/PipelineCanvas.js";
import { PredictionsScreen } from "./screens/PredictionsScreen.js";
import { Logo, Kbd, CommandPalette, useTheme, type CommandItem } from "./ui/index.js";
import { cn } from "./ui/cn.js";

type NavItem = { to: string; label: string; icon: LucideIcon; kw: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Vận hành",
    items: [
      { to: "/control-tower", label: "Control Tower", icon: LayoutDashboard, kw: "tổng quan dashboard home" },
      { to: "/customers", label: "Customers", icon: UserRound, kw: "khách hàng 360 hồ sơ hành vi" },
      { to: "/loyalty", label: "Loyalty", icon: Gift, kw: "điểm thưởng tích điểm" },
      { to: "/data-ops", label: "Data Ops", icon: Database, kw: "master data brand store product" },
    ],
  },
  {
    label: "Phân tích",
    items: [
      { to: "/insights", label: "Phân tích chuyên sâu", icon: ChartColumnBig, kw: "insights doanh thu forecast vòng đời synergy" },
      { to: "/predictions", label: "Dự đoán", icon: Gauge, kw: "predictive ml churn clv propensity next purchase mô hình dự đoán" },
      { to: "/audiences", label: "Audiences", icon: Target, kw: "phân khúc segment kích hoạt" },
      { to: "/journeys", label: "Journeys", icon: Waypoints, kw: "hành trình automation" },
    ],
  },
  {
    label: "AI",
    items: [
      { to: "/assistant", label: "Trợ lý AI", icon: Sparkles, kw: "chat hỏi đáp generative llm" },
      { to: "/ai-governance", label: "AI & Governance", icon: BrainCircuit, kw: "cấu hình llm model audit usage" },
    ],
  },
  {
    label: "Tích hợp",
    items: [
      { to: "/connectors", label: "Kết nối", icon: Plug, kw: "connector pipeline etl rudderstack tích hợp nguồn đích zalo" },
    ],
  },
  {
    label: "Quản trị",
    items: [
      { to: "/governance", label: "Governance", icon: ShieldCheck, kw: "consent quyền riêng tư đồng ý" },
      { to: "/platform", label: "Platform", icon: Server, kw: "người dùng api key rbac" },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;

  return (
    <div className="flex h-full">
      <Sidebar onLogout={() => { clearSession(); setAuthed(false); }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/control-tower" replace />} />
            <Route path="/control-tower" element={<ControlTowerScreen />} />
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/predictions" element={<PredictionsScreen />} />
            <Route path="/customers" element={<CustomersScreen />} />
            <Route path="/audiences" element={<AudiencesScreen />} />
            <Route path="/loyalty" element={<LoyaltyScreen />} />
            <Route path="/journeys" element={<JourneysScreen />} />
            <Route path="/journeys/:id" element={<JourneyDetail />} />
            <Route path="/data-ops" element={<MastersScreen />} />
            <Route path="/governance" element={<GovernanceScreen />} />
            <Route path="/platform" element={<PlatformScreen />} />
            <Route path="/assistant" element={<AssistantScreen />} />
            <Route path="/ai-governance" element={<AiGovernanceScreen />} />
            <Route path="/connectors" element={<ConnectorsScreen />} />
            <Route path="/connectors/pipelines/:id" element={<PipelineCanvas />} />
            <Route path="*" element={<Placeholder />} />
          </Routes>
        </main>
      </div>
      <PaletteHost open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function Sidebar({ onLogout }: { onLogout: () => void }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-4 overflow-auto px-3 py-2">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-[0.7rem] font-bold uppercase tracking-wider text-text-muted">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                      cn(
                        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-accent-subtle text-accent"
                          : "text-text-muted hover:bg-surface-alt hover:text-text",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-text-subtle group-hover:text-text")} />
                        <span className="truncate">{it.label}</span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2.5 px-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-full brand-gradient text-xs font-bold text-white">
            {(getName() ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{getName() ?? "—"}</p>
            <p className="truncate text-xs uppercase tracking-wide text-text-subtle">{getRole() ?? ""}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
        >
          <LogOut className="size-4" /> Đăng xuất
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/90 px-6 backdrop-blur">
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-9 w-72 items-center gap-2 rounded-md border border-border bg-surface-alt px-3 text-sm text-text-subtle transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Tìm kiếm…</span>
        <span className="flex items-center gap-0.5">
          <Kbd><CommandIcon className="size-2.5" /></Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <button type="button" aria-label="Thông báo" className="grid size-9 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text">
          <Bell className="size-4" />
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
      title={dark ? "Chế độ sáng" : "Chế độ tối"}
      className="grid size-9 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function PaletteHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const items: CommandItem[] = FLAT.map((it) => {
    const Icon = it.icon;
    return {
      id: it.to,
      label: it.label,
      keywords: it.kw,
      icon: <Icon className="size-4" />,
      onSelect: () => navigate(it.to),
    };
  });
  return <CommandPalette open={open} onClose={onClose} items={items} />;
}

function Placeholder() {
  return (
    <section className="mx-auto max-w-[1100px] p-6">
      <h1 className="text-xl font-bold tracking-tight">Sắp ra mắt</h1>
      <p className="text-text-muted">Workspace này thuộc giai đoạn sau.</p>
    </section>
  );
}
