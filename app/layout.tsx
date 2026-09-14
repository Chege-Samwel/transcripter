import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcripter — Editorial workspace",
  description: "A private, controlled workspace for turning transcripts into publishable edits.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
