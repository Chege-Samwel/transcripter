"use client";

import { useState } from "react";
import Icon from "./Icon";

export default function CopyButton({ text, label = "Copy", className = "quiet-button" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("failed");
      window.setTimeout(() => setState("idle"), 2200);
    }
  }

  return (
    <button type="button" className={className} onClick={copy} disabled={!text} title={state === "failed" ? "Select the text and copy it manually" : label}>
      <Icon name="copy" size={14} />
      {state === "copied" ? "Copied" : state === "failed" ? "Select to copy" : label}
    </button>
  );
}
