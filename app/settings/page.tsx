import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getCurrentUser } from "../../lib/account";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <SettingsClient account={user} />
    </AppShell>
  );
}
