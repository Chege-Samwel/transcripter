import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getSession } from "../../lib/auth";
import WorkspaceClient from "./WorkspaceClient";

export default function WorkspacePage() {
  const session = getSession();
  if (!session) redirect("/login");
  return <AppShell email={session.email}><WorkspaceClient /></AppShell>;
}
