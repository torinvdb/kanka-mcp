import { parse } from "node-html-parser";

export function stripHtml(html: string): string {
  if (!html) return "";
  const root = parse(html);
  return root
    .text.replace(/\s+/g, " ")
    .trim();
}

export function snippet(text: string, matchIndex: number, radius = 80): string {
  if (matchIndex < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
