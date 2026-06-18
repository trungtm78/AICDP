import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { CustomersScreen } from "./screens/CustomersScreen.js";
import { MastersScreen } from "./screens/MastersScreen.js";
import { LoyaltyScreen } from "./screens/LoyaltyScreen.js";

// IA 8 workspace (DESIGN.md). GĐ1 hiện thực: Customers + Data Ops; còn lại placeholder.
const NAV = [
  { to: "/control-tower", label: "Control Tower", ready: true },
  { to: "/customers", label: "Customers", ready: true },
  { to: "/audiences", label: "Audiences", ready: false },
  { to: "/journeys", label: "Journeys", ready: false },
  { to: "/loyalty", label: "Loyalty", ready: true },
  { to: "/data-ops", label: "Data Ops", ready: true },
  { to: "/governance", label: "Governance", ready: false },
  { to: "/platform", label: "Platform", ready: false },
];

export function App() {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" aria-hidden />
          <span className="font-bold tracking-tight">OCC-CDP</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                [
                  "flex items-center justify-between rounded-md px-3 py-1.5",
                  isActive ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-surface",
                  n.ready ? "" : "opacity-50",
                ].join(" ")
              }
            >
              <span>{n.label}</span>
              {!n.ready && <span className="text-[0.625rem] uppercase">Sắp có</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-4 py-3 text-xs text-text-subtle">
          <kbd className="rounded border border-border px-1">Ctrl</kbd> +{" "}
          <kbd className="rounded border border-border px-1">K</kbd> lệnh nhanh
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/control-tower" replace />} />
          <Route path="/control-tower" element={<ControlTower />} />
          <Route path="/customers" element={<CustomersScreen />} />
          <Route path="/loyalty" element={<LoyaltyScreen />} />
          <Route path="/data-ops" element={<MastersScreen />} />
          <Route path="*" element={<Placeholder />} />
        </Routes>
      </main>
    </div>
  );
}

function ControlTower() {
  return (
    <section className="mx-auto max-w-[1100px] p-6">
      <h1 className="text-xl font-bold tracking-tight">Control Tower</h1>
      <p className="text-text-muted">
        Tổng quan realtime 5 thương hiệu (đang phát triển). Vào <strong>Customers</strong> để tra cứu
        khách, <strong>Data Ops</strong> để quản trị master data.
      </p>
    </section>
  );
}

function Placeholder() {
  return (
    <section className="mx-auto max-w-[1100px] p-6">
      <h1 className="text-xl font-bold tracking-tight">Sắp ra mắt</h1>
      <p className="text-text-muted">Workspace này thuộc giai đoạn sau.</p>
    </section>
  );
}
