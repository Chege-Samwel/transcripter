import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getCurrentUser } from "../../lib/account";
import WorkspaceClient from "./WorkspaceClient";

export default async function WorkspacePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <WorkspaceClient account={user} />
    </AppShell>
  );
}
