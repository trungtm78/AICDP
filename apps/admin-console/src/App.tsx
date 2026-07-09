import { useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { getToken, getName, getRole, clearSession } from "./lib/auth.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { CustomersScreen } from "./screens/CustomersScreen.js";
import { MastersScreen } from "./screens/MastersScreen.js";
import { LoyaltyScreen } from "./screens/LoyaltyScreen.js";
import { GovernanceScreen } from "./screens/GovernanceScreen.js";
import { AudiencesScreen } from "./screens/AudiencesScreen.js";
import { ControlTowerScreen } from "./screens/ControlTowerScreen.js";
import { JourneysScreen } from "./screens/JourneysScreen.js";
import { PlatformScreen } from "./screens/PlatformScreen.js";
import { AiGovernanceScreen } from "./screens/AiGovernanceScreen.js";

// IA workspace (DESIGN.md). + AI & Governance (Phase A).
const NAV = [
  { to: "/control-tower", label: "Control Tower", ready: true },
  { to: "/customers", label: "Customers", ready: true },
  { to: "/audiences", label: "Audiences", ready: true },
  { to: "/journeys", label: "Journeys", ready: true },
  { to: "/loyalty", label: "Loyalty", ready: true },
  { to: "/data-ops", label: "Data Ops", ready: true },
  { to: "/governance", label: "Governance", ready: true },
  { to: "/platform", label: "Platform", ready: true },
  { to: "/ai-governance", label: "AI & Governance", ready: true },
];

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="brand-gradient inline-block h-6 w-6 rounded-lg" aria-hidden />
          <span className="text-[0.95rem] font-bold tracking-tight">OCC-CDP</span>
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
        <div className="mt-auto px-3 py-3">
          <div className="mb-2 px-1 text-xs text-text-subtle">
            {getName() ?? "—"} · <span className="uppercase">{getRole() ?? ""}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSession();
              setAuthed(false);
            }}
            className="w-full rounded-md border border-border px-3 py-1.5 text-left text-text-muted hover:bg-surface"
          >
            Đăng xuất
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/control-tower" replace />} />
          <Route path="/control-tower" element={<ControlTowerScreen />} />
          <Route path="/customers" element={<CustomersScreen />} />
          <Route path="/audiences" element={<AudiencesScreen />} />
          <Route path="/loyalty" element={<LoyaltyScreen />} />
          <Route path="/journeys" element={<JourneysScreen />} />
          <Route path="/data-ops" element={<MastersScreen />} />
          <Route path="/governance" element={<GovernanceScreen />} />
          <Route path="/platform" element={<PlatformScreen />} />
          <Route path="/ai-governance" element={<AiGovernanceScreen />} />
          <Route path="*" element={<Placeholder />} />
        </Routes>
      </main>
    </div>
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
