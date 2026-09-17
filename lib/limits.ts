export const DEFAULT_DEMO_WORD_CAP = 600;

export function demoWordCap() {
  const raw = typeof process !== "undefined" ? Number(process.env.DEMO_WORD_CAP) : Number.NaN;
  if (Number.isFinite(raw) && raw >= 50) return Math.min(100_000, Math.round(raw));
  return DEFAULT_DEMO_WORD_CAP;
}

export function countWords(text: string) {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function capToWords(text: string, cap: number) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { text: "", words: 0, truncated: false };
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= cap) return { text: trimmed, words: words.length, truncated: false };
  return { text: words.slice(0, cap).join(" "), words: cap, truncated: true };
}
