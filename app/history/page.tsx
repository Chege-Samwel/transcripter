import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getCurrentUser } from "../../lib/account";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <HistoryClient account={user} />
    </AppShell>
  );
}
