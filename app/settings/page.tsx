import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { getSession } from "../../lib/auth";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  const session = getSession();
  if (!session) redirect("/login");
  return <AppShell email={session.email}><SettingsClient /></AppShell>;
}
