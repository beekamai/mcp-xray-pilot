/*
 * Shared types for the mcp-xray-pilot server.
 *
 * Topic        — one cached docs page from xtls.github.io
 * FetchResult  — result of online/offline retrieval
 * Validation*  — structural-validate output
 * Lint*        — best-practice lint output
 */

export type Category =
  | "basic"
  | "features"
  | "inbounds"
  | "outbounds"
  | "transports";

export interface TopicMeta {
  /* "transports/xhttp", "inbounds/vless", … */
  slug: string;
  /* Pretty title extracted from first markdown H1 / fallback to slug. */
  title: string;
  category: Category;
  /* Pretty website URL (xtls.github.io) — for users to share. */
  url: string;
  /* Raw source URL the markdown was fetched from. Optional for legacy entries. */
  source_url?: string;
  /* ISO timestamp of last successful fetch. */
  fetched_at: string;
  /* Filename within data/docs/ (without extension is fine). */
  file: string;
}

export interface Topic extends TopicMeta {
  /* Markdown body (without YAML frontmatter). */
  markdown: string;
}

export interface FetchResult {
  topic: Topic;
  source: "network" | "offline";
  /* Set if a network attempt failed and we fell back. */
  warning?: string;
}

export type Severity = "error" | "warn" | "info";

export interface ValidationIssue {
  /* Stable machine id ("missing_inbounds", "bad_json", …). */
  id: string;
  severity: Severity;
  message: string;
  /* Optional JSON-pointer-ish path: "/inbounds/0/port". */
  where?: string;
}

export interface LintIssue extends ValidationIssue {
  /* Lint rule id this issue came from. */
  rule: string;
}

export type LintRule = (config: unknown) => LintIssue[];

export interface SearchHit {
  slug: string;
  title: string;
  category: Category;
  score: number;
  /* Short ~240-char snippet around the best match. */
  snippet: string;
}
