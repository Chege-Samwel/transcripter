import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcripter — Workflow Studio",
  description: "A batch-safe transcript editing workflow with model fallbacks, traceable runs, and portable handoffs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
