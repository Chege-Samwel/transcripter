import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  if (getSession()) redirect("/workspace");
  return (
    <Suspense fallback={<main className="auth-page"><div className="loading-state">Loading sign in</div></main>}>
      <LoginClient previewCredentials={process.env.NODE_ENV !== "production" && !process.env.AUTH_EMAIL} />
    </Suspense>
  );
}
