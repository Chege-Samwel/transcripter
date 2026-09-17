'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginClient({ previewCredentials }: { previewCredentials: boolean }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(previewCredentials ? "editor@local.test" : "");
  const [password, setPassword] = useState(previewCredentials ? "local-preview-only" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not sign in.");
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
      const session = (await sessionResponse.json()) as { authenticated?: boolean };
      if (!session.authenticated) throw new Error("The session cookie was not accepted. Check the workspace domain and try again.");
      const next = searchParams.get("next");
      window.location.assign(next?.startsWith("/") ? next : "/workspace");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
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
          <p className="overline">EDITORIAL WORKSPACE</p>
          <h1>Make the source<br /><em>publishable.</em></h1>
          <p>Sign in to start a new transcript, open history, or wait on a demo while your registration is approved.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required /></label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? <><span className="spinner" />Signing in</> : <>Open workspace <span>→</span></>}</button>
        </form>
        <p className="auth-switch">No account yet? <Link href="/register">Create one</Link> — new registrations wait for approval and start on a 600-word demo.</p>
        {previewCredentials && <p className="preview-note">Local preview access is prefilled. Configure <code>AUTH_EMAIL</code> and <code>AUTH_PASSWORD_HASH</code> before production.</p>}
        <p className="auth-footnote">Private workspace · Sessions expire after 8 hours</p>
      </section>
      <aside className="auth-aside">
        <div className="quote-mark">“</div>
        <blockquote>Good editing does not make a voice generic. It makes the intended meaning impossible to miss.</blockquote>
        <div className="aside-rule"><span />TRANSCRIPTER / 01</div>
      </aside>
    </main>
  );
}
