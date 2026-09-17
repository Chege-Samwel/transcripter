export type IconName =
  | "edit"
  | "settings"
  | "logout"
  | "menu"
  | "upload"
  | "file"
  | "play"
  | "arrow"
  | "check"
  | "alert"
  | "copy"
  | "download"
  | "refresh"
  | "external"
  | "chevron"
  | "x"
  | "spark"
  | "activity"
  | "layers"
  | "plus"
  | "lock"
  | "history"
  | "users"
  | "book"
  | "pause";

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "edit") return <svg {...common}><path {...stroke} d="m4 16.5-.8 3.8 3.8-.8L18.7 7.8a2.7 2.7 0 0 0-3.8-3.8L4 16.5Z" /><path {...stroke} d="m13.5 5.5 5 5" /></svg>;
  if (name === "settings") return <svg {...common}><path {...stroke} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path {...stroke} d="m19.2 14.8.1.2a1.7 1.7 0 0 1-2.4 2.4l-.2-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.2.1a1.7 1.7 0 0 1-2.4-2.4l.1-.2A1.7 1.7 0 0 0 5.9 12a1.7 1.7 0 0 0-1.7-1.7 1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.5-2.7l-.1-.2a1.7 1.7 0 0 1 2.4-2.4l.2.1A1.7 1.7 0 0 0 11.1.5h.2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.2-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.2A1.7 1.7 0 0 0 21.6 7h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.5 2.7l-.1.2Z" /></svg>;
  if (name === "logout") return <svg {...common}><path {...stroke} d="M10 4H5.5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1H10M15 16l4-4-4-4M19 12H9" /></svg>;
  if (name === "menu") return <svg {...common}><path {...stroke} d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "upload") return <svg {...common}><path {...stroke} d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5" /></svg>;
  if (name === "file") return <svg {...common}><path {...stroke} d="M6 3.5h8l4 4v13H6v-17Z" /><path {...stroke} d="M14 3.5v4h4M9 12h6M9 15.5h6" /></svg>;
  if (name === "play") return <svg {...common}><path d="M8.5 5.5v13l10-6.5-10-6.5Z" fill="currentColor" /></svg>;
  if (name === "arrow") return <svg {...common}><path {...stroke} d="M5 12h13M13 6l6 6-6 6" /></svg>;
  if (name === "check") return <svg {...common}><path {...stroke} d="m5 12 4 4L19 6" /></svg>;
  if (name === "alert") return <svg {...common}><path {...stroke} d="M12 4 21 20H3L12 4Z" /><path {...stroke} d="M12 9v5M12 17.5h.01" /></svg>;
  if (name === "copy") return <svg {...common}><rect {...stroke} x="8" y="8" width="11" height="12" rx="1.5" /><path {...stroke} d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" /></svg>;
  if (name === "download") return <svg {...common}><path {...stroke} d="M12 4v12M8 12l4 4 4-4M5 20h14" /></svg>;
  if (name === "refresh") return <svg {...common}><path {...stroke} d="M20 11a8 8 0 0 0-14.5-4.7L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.7L20 16m0 4v-4h-4" /></svg>;
  if (name === "external") return <svg {...common}><path {...stroke} d="M14 5h5v5M19 5l-8 8M19 13v5.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5H11" /></svg>;
  if (name === "chevron") return <svg {...common}><path {...stroke} d="m9 6 6 6-6 6" /></svg>;
  if (name === "x") return <svg {...common}><path {...stroke} d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "spark") return <svg {...common}><path {...stroke} d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /></svg>;
  if (name === "activity") return <svg {...common}><path {...stroke} d="M3 12h4l2.1-6 4.2 12 2.1-6H21" /></svg>;
  if (name === "layers") return <svg {...common}><path {...stroke} d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" /><path {...stroke} d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" /></svg>;
  if (name === "plus") return <svg {...common}><path {...stroke} d="M12 5v14M5 12h14" /></svg>;
  if (name === "lock") return <svg {...common}><rect {...stroke} x="5" y="10" width="14" height="10" rx="2" /><path {...stroke} d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "history") return <svg {...common}><path {...stroke} d="M4 12a8 8 0 1 0 2.3-5.7L4 8" /><path {...stroke} d="M4 4v4h4M12 8v5l3 2" /></svg>;
  if (name === "users") return <svg {...common}><path {...stroke} d="M16 19v-1.2A3.8 3.8 0 0 0 12.2 14H7.8A3.8 3.8 0 0 0 4 17.8V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.2A3.8 3.8 0 0 0 17 14.1M16 5.1a3 3 0 0 1 0 5.8" /></svg>;
  if (name === "book") return <svg {...common}><path {...stroke} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path {...stroke} d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  if (name === "pause") return <svg {...common}><path {...stroke} d="M8 6v12M16 6v12" /></svg>;
  return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
}
