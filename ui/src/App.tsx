import { ClipboardList, HandHeart, LayoutDashboard, Menu, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { HoursLog } from "./pages/HoursLog";
import { Opportunities } from "./pages/Opportunities";
import { AppContext, EntryDialog, type EntryDraft } from "./shared";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/hours", label: "Hours Log", icon: ClipboardList },
  { to: "/opportunities", label: "Opportunities", icon: Search },
];

export function App() {
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const { pathname } = useLocation();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const notify = useCallback((message: string) => setToast(message), []);
  const openEntry = useCallback((d?: EntryDraft) => setDraft(d ?? {}), []);
  const actions = useMemo(() => ({ version, refresh, notify, openEntry }), [version, refresh, notify, openEntry]);

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <AppContext.Provider value={actions}>
      <div className="shell">
        {drawer && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}
        <aside className={drawer ? "sidebar open" : "sidebar"} aria-label="Main">
          <div className="brand">
            <HandHeart size={26} aria-hidden="true" />
            <span>Volunteer Planner</span>
            <button type="button" className="icon-btn drawer-close" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={18} /></button>
          </div>
          <nav>
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <Icon size={18} aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
          <p className="side-note">Your records stay on this device.</p>
        </aside>
        <div className="main">
          <header className="topbar">
            <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu size={20} /></button>
            <h1>{NAV.find((n) => n.to === pathname)?.label ?? "Volunteer Planner"}</h1>
            <button type="button" className="btn primary" onClick={() => openEntry()}><Plus size={16} aria-hidden="true" /> Log hours</button>
          </header>
          <main className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/hours" element={<HoursLog />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {draft && <EntryDialog draft={draft} onClose={() => setDraft(null)} />}
      <div className="toast-region" aria-live="polite">{toast && <div className="toast">{toast}</div>}</div>
    </AppContext.Provider>
  );
}
