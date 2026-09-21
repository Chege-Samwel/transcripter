'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useState } from "react";
import Icon from "./Icon";
import type { Account } from "../lib/types";

function statusLabel(user: Account) {
  if (user.role === "admin") return "Administrator";
  if (user.status === "approved") return "Approved editor";
  if (user.status === "suspended") return "Suspended";
  return "Awaiting approval · Demo";
}

export default function AppShell({ children, user }: { children: ReactNode; user: Account }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = (user.displayName || user.email).slice(0, 1).toUpperCase() || "E";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="product-shell">
      <button className={`mobile-scrim ${mobileOpen ? "visible" : ""}`} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
      <aside className={`product-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="product-brand">
          <span className="brand-symbol"><i /><i /><i /></span>
          <span>transcripter</span>
        </div>
        <div className="sidebar-workspace">
          <span className="sidebar-caption">WORKSPACE</span>
          <strong>Editorial room</strong>
          <span className="workspace-status">
            <i className={user.canBookJob ? "" : "demo"} />
            {user.canBookJob ? "Full jobs" : `Demo · ${user.demoWordCap} words`}
          </span>
        </div>
        <nav className="product-nav" aria-label="Main navigation">
          <span className="sidebar-caption">WORKSPACE</span>
          <Link className={pathname === "/workspace" ? "active" : ""} href="/workspace" onClick={() => setMobileOpen(false)}>
            <Icon name="edit" size={17} />
            <span>New transcript</span>
            <b>⌘ E</b>
          </Link>
          <Link className={pathname.startsWith("/history") || pathname.startsWith("/workspace/") ? "active" : ""} href="/history" onClick={() => setMobileOpen(false)}>
            <Icon name="history" size={17} />
            <span>History</span>
          </Link>
          <span className="sidebar-caption nav-section-caption">ACCOUNT</span>
          <Link className={pathname.startsWith("/settings") ? "active" : ""} href="/settings" onClick={() => setMobileOpen(false)}>
            <Icon name="settings" size={17} />
            <span>Guiding rules</span>
          </Link>
          {user.role === "admin" && (
            <Link className={pathname.startsWith("/admin") ? "active" : ""} href="/admin" onClick={() => setMobileOpen(false)}>
              <Icon name="users" size={17} />
              <span>Admin &amp; Models</span>
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-row">
            <span className="avatar">{initials}</span>
            <span className="account-copy">
              <strong>{user.email}</strong>
              <small>{statusLabel(user)}</small>
            </span>
            <button className="logout-button" onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="product-main">
        <header className="mobile-header">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Icon name="menu" size={21} />
          </button>
          <span className="product-brand compact">
            <span className="brand-symbol"><i /><i /><i /></span>
            <span>transcripter</span>
          </span>
          <span className="mobile-avatar">{initials}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
