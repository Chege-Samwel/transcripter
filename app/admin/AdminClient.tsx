'use client';

import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import ProceedingOverlay from "../../components/ProceedingOverlay";
import { requestJson } from "../../lib/http";
import type { Account, UserStatus } from "../../lib/types";

type ListedUser = Account & { createdAt?: string; approvedAt?: string | null; approvedBy?: string | null };

export default function AdminClient({ account }: { account: Account }) {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(true);
  const [overlay, setOverlay] = useState<{ open: boolean; title: string; detail: string; busy: boolean; error?: string }>({
    open: false,
    title: "",
    detail: "",
    busy: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await requestJson<{ users?: ListedUser[]; configured?: boolean; message?: string; error?: string }>("/api/admin/users");
      if (cancelled) return;
      setUsers(Array.isArray(data.users) ? data.users : []);
      setConfigured(data.configured !== false);
      if (data.message) setMessage(data.message);
      setReady(true);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function setStatus(email: string, status: UserStatus) {
    setOverlay({ open: true, title: "Updating account status", detail: `${email} → ${status}`, busy: true });
    const { ok, data } = await requestJson<{ users?: ListedUser[]; error?: string }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, status }),
    });
    if (!ok) {
      setOverlay({ open: true, title: "Status was not updated", detail: data.error || "The change did not save.", busy: false, error: data.error || "The change did not save." });
      return;
    }
    setUsers(Array.isArray(data.users) ? data.users : []);
    setOverlay({ open: false, title: "", detail: "", busy: false });
    setMessage(`${email} is now ${status.replace("_", " ")}.`);
  }

  if (!ready) return <main className="workspace-page"><div className="loading-state"><span className="spinner dark" />Loading approvals</div></main>;

  const awaiting = users.filter((user) => user.status === "awaiting_approval").length;

  return (
    <main className="workspace-page">
      <header className="page-header">
        <div>
          <p className="overline">APPROVALS</p>
          <h1>Let people in.</h1>
          <p className="page-subtitle">Registrations arrive as <code>awaiting_approval</code>. Approved editors can book a full job. Everyone else stays on a {account.demoWordCap}-word demo.</p>
        </div>
      </header>
      {message && <div className="workspace-notice info"><Icon name="spark" size={16} /><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}
      {!configured && <div className="workspace-notice info"><Icon name="lock" size={16} /><span>Set DATABASE_URL so registrations persist. The bootstrap admin from AUTH_EMAIL can still sign in.</span></div>}
      <section className="admin-summary">
        <div className="card"><strong>{awaiting}</strong><span>Awaiting approval</span></div>
        <div className="card"><strong>{users.filter((user) => user.status === "approved").length}</strong><span>Approved</span></div>
        <div className="card"><strong>{users.filter((user) => user.status === "suspended").length}</strong><span>Suspended</span></div>
      </section>
      <section className="history-list">
        {users.length === 0 ? (
          <div className="empty-history card">
            <p className="overline">NO REGISTRATIONS</p>
            <h2>Waiting on the first signup.</h2>
            <p>When someone creates an account it lands here with status awaiting_approval.</p>
          </div>
        ) : users.map((user) => (
          <article className="history-row card" key={user.email}>
            <div>
              <div className="history-title-row">
                <h2>{user.displayName || user.email}</h2>
                <span className={`badge ${user.status}`}>{user.status.replace("_", " ")}</span>
                <span className="badge">{user.role}</span>
              </div>
              <p>{user.email}{user.approvedBy ? ` · approved by ${user.approvedBy}` : ""}</p>
            </div>
            <div className="history-actions">
              {user.status !== "approved" && <button type="button" className="primary-button" onClick={() => void setStatus(user.email, "approved")}>Approve</button>}
              {user.status !== "awaiting_approval" && user.email !== account.email && <button type="button" className="quiet-button" onClick={() => void setStatus(user.email, "awaiting_approval")}>Return to awaiting</button>}
              {user.status !== "suspended" && user.email !== account.email && <button type="button" className="quiet-button" onClick={() => void setStatus(user.email, "suspended")}>Suspend</button>}
            </div>
          </article>
        ))}
      </section>
      <ProceedingOverlay
        open={overlay.open}
        title={overlay.title}
        subtitle={overlay.detail}
        percent={overlay.busy ? 55 : overlay.error ? 100 : 100}
        busy={overlay.busy}
        error={overlay.error ? { message: overlay.error, retryable: true } : null}
        log={[{ id: "status", text: overlay.detail || "Updating status enum", tone: overlay.error ? "error" : overlay.busy ? "running" : "success" }]}
        onClose={() => setOverlay({ open: false, title: "", detail: "", busy: false })}
      />
    </main>
  );
}
