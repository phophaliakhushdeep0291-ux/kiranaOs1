import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Receipt, Users, LogOut } from "lucide-react";
import { logout } from "../lib/api";

const nav = [
  { to: "/",          label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/billing",   label: "Billing",   icon: Receipt,         testid: "nav-billing"   },
  { to: "/customers", label: "Customers", icon: Users,           testid: "nav-customers" },
];

export default function AppShell() {
  const navigate = useNavigate();
  async function doLogout() {
    await logout();
    navigate("/login");
  }
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:flex-col w-56 border-r border-slate-200 bg-white">
        <div className="px-4 py-5 border-b border-slate-200">
          <div className="font-semibold text-lg">KiranaOS</div>
          <div className="text-xs text-slate-500">Shop dashboard</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive ? "bg-violet-50 text-violet-700 font-medium" : "text-slate-700 hover:bg-slate-100"}`
              }
            >
              <n.icon size={16} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={doLogout} className="m-2 btn btn-ghost justify-center" data-testid="logout-btn">
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-slate-200 bg-white flex justify-around py-2 z-20">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            data-testid={`${n.testid}-mobile`}
            className={({ isActive }) => `flex flex-col items-center text-xs ${isActive ? "text-violet-700" : "text-slate-500"}`}
          >
            <n.icon size={20} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
