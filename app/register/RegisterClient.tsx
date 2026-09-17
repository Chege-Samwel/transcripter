'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RegisterClient() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not create this account.");
      window.location.assign("/workspace");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create this account.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-atmosphere auth-atmosphere-one" />
      <div className="auth-atmosphere auth-atmosphere-two" />
      <section className="auth-panel">
        <div className="auth-brand"><span className="brand-symbol"><i /><i /><i /></span><span>transcripter</span></div>
        <div className="auth-copy">
          <p className="overline">CREATE ACCOUNT</p>
          <h1>Join the<br /><em>editorial room.</em></h1>
          <p>Registrations arrive as <strong>awaiting approval</strong>. You can sign in immediately and run a capped demo — full jobs unlock when an admin approves you.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we address you?" /></label>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
          <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat password" minLength={8} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? <><span className="spinner" />Creating account</> : <>Create demo access <span>→</span></>}</button>
        </form>
        <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
        <p className="auth-footnote">Status enum · awaiting_approval → approved</p>
      </section>
      <aside className="auth-aside">
        <div className="quote-mark">“</div>
        <blockquote>Until you are approved, the room stays on a 600-word demo. Nothing is booked until an admin says so.</blockquote>
        <div className="aside-rule"><span />TRANSCRIPTER / 02</div>
      </aside>
    </main>
  );
}
