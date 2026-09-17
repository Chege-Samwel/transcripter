import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getCurrentUser } from "../../lib/account";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/workspace");
  return (
    <AppShell user={user}>
      <AdminClient account={user} />
    </AppShell>
  );
}
