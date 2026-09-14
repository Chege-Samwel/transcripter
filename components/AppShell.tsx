'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useState } from "react";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "edit") return <svg {...common}><path {...stroke} d="m4 16.5-.8 3.8 3.8-.8L18.7 7.8a2.7 2.7 0 0 0-3.8-3.8L4 16.5Z" /><path {...stroke} d="m13.5 5.5 5 5" /></svg>;
  if (name === "settings") return <svg {...common}><path {...stroke} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path {...stroke} d="m19.2 14.8.1.2a1.7 1.7 0 0 1-2.4 2.4l-.2-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.2.1a1.7 1.7 0 0 1-2.4-2.4l.1-.2A1.7 1.7 0 0 0 5.9 12a1.7 1.7 0 0 0-1.7-1.7 1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.5-2.7l-.1-.2a1.7 1.7 0 0 1 2.4-2.4l.2.1A1.7 1.7 0 0 0 11.1.5h.2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.2-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.2A1.7 1.7 0 0 0 21.6 7h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.5 2.7l-.1.2Z" /></svg>;
  if (name === "logout") return <svg {...common}><path {...stroke} d="M10 4H5.5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1H10M15 16l4-4-4-4M19 12H9" /></svg>;
  if (name === "menu") return <svg {...common}><path {...stroke} d="M4 7h16M4 12h16M4 17h16" /></svg>;
  return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
}

export default function AppShell({ children, email }: { children: ReactNode; email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = email.slice(0, 1).toUpperCase() || "E";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return <div className="product-shell">
    <button className={`mobile-scrim ${mobileOpen ? "visible" : ""}`} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
    <aside className={`product-sidebar ${mobileOpen ? "open" : ""}`}>
      <div className="product-brand"><span className="brand-symbol"><i /><i /><i /></span><span>transcripter</span></div>
      <div className="sidebar-workspace"><span className="sidebar-caption">WORKSPACE</span><strong>Editorial room</strong><span className="workspace-status"><i />Private</span></div>
      <nav className="product-nav" aria-label="Main navigation">
        <span className="sidebar-caption">WORKSPACE</span>
        <Link className={pathname.startsWith("/workspace") ? "active" : ""} href="/workspace" onClick={() => setMobileOpen(false)}><Icon name="edit" size={17} /><span>New edit</span><b>⌘ E</b></Link>
        <span className="sidebar-caption nav-section-caption">ACCOUNT</span>
        <Link className={pathname.startsWith("/settings") ? "active" : ""} href="/settings" onClick={() => setMobileOpen(false)}><Icon name="settings" size={17} /><span>Settings</span></Link>
      </nav>
      <div className="sidebar-bottom"><div className="account-row"><span className="avatar">{initials}</span><span className="account-copy"><strong>{email}</strong><small>Administrator</small></span><button className="logout-button" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" size={16} /></button></div></div>
    </aside>
    <div className="product-main"><header className="mobile-header"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icon name="menu" size={21} /></button><span className="product-brand compact"><span className="brand-symbol"><i /><i /><i /></span><span>transcripter</span></span><span className="mobile-avatar">{initials}</span></header>{children}</div>
  </div>;
}
