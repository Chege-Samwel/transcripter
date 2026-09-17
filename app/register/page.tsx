import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import RegisterClient from "./RegisterClient";

export default function RegisterPage() {
  if (getSession()) redirect("/workspace");
  return <RegisterClient />;
}
