/*
 * Small helpers shared across modules:
 *   - buildFrontmatter()/parseFrontmatter() — YAML frontmatter for cached docs.
 *   - fileNameFor()/slugify()/snippet() — self-explanatory.
 *
 * Note: HTML→markdown conversion was removed in v0.2 — docs are now fetched
 * as raw markdown from XTLS/Xray-docs-next.
 */

import type { Category, TopicMeta } from "./types.js";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Compose the final on-disk filename for a TopicMeta. */
export function fileNameFor(category: Category, slug: string): string {
  return `${category}__${slug.replace(/\//g, "_")}.md`;
}

export function buildFrontmatter(meta: TopicMeta): string {
  const lines = [
    "---",
    `url: ${meta.url}`,
  ];
  if (meta.source_url) lines.push(`source_url: ${meta.source_url}`);
  lines.push(
    `title: ${escapeYaml(meta.title)}`,
    `category: ${meta.category}`,
    `slug: ${meta.slug}`,
    `fetched_at: ${meta.fetched_at}`,
    "---",
    "",
  );
  return lines.join("\n");
}

export function parseFrontmatter(raw: string): {
  meta: Partial<TopicMeta>;
  body: string;
} {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (m) meta[m[1]] = unquoteYaml(m[2]);
  }
  return { meta: meta as Partial<TopicMeta>, body };
}

function escapeYaml(s: string): string {
  if (/[:#\n"']/.test(s)) return JSON.stringify(s);
  return s;
}

function unquoteYaml(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/* Build a ~maxLen-char excerpt around the first occurrence of `query`. */
export function snippet(text: string, query: string, maxLen = 240): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = q ? lower.indexOf(q) : -1;
  let start = 0;
  let end = Math.min(text.length, maxLen);
  if (idx >= 0) {
    start = Math.max(0, idx - Math.floor(maxLen / 3));
    end = Math.min(text.length, start + maxLen);
  }
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}
