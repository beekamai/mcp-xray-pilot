/*
 * Online + offline docs fetcher.
 *
 * Source switched to raw markdown in XTLS/Xray-docs-next (v0.2+):
 *   raw_url = https://raw.githubusercontent.com/XTLS/Xray-docs-next/main/<path>
 *   path    = "docs/en/config/<slug>.md" (slug "" maps to "index")
 *
 * Strategy per slug (e.g. "transports/xhttp"):
 *   1. If force_offline → straight to packed cache.
 *   2. Try network: GET raw_url. On success: store as-is, overwrite packed
 *      cache, return network.
 *   3. On failure: fall back to packed cache; surface a `warning` field.
 *
 * The catalogue of all known slugs lives in DOCS_CATALOGUE.
 */

import { buildFrontmatter, fileNameFor } from "./utils.js";
import { loadIndex, readTopic, saveIndex, writeTopic } from "./state.js";
import type { Category, FetchResult, Topic, TopicMeta } from "./types.js";

const RAW_BASE = "https://raw.githubusercontent.com/XTLS/Xray-docs-next/main/docs/en/config";
const SITE_BASE = "https://xtls.github.io/en/config";
export const TREE_API =
  "https://api.github.com/repos/XTLS/Xray-docs-next/git/trees/main?recursive=1";

interface CatalogueEntry {
  category: Category;
  /* Path under docs/en/config/ without ".md". E.g. "inbounds/vless" or "log".
   * Special: "index" maps to docs/en/config/index.md. */
  slug: string;
}

/* Full catalogue (~50 pages). Mirrors XTLS/Xray-docs-next/docs/en/config tree.
 * Keep in sync with `npm run fetch-docs --refresh-catalogue` (manual edit). */
export const DOCS_CATALOGUE: CatalogueEntry[] = [
  /* basic (top-level under docs/en/config) */
  { category: "basic", slug: "index" },
  { category: "basic", slug: "log" },
  { category: "basic", slug: "api" },
  { category: "basic", slug: "dns" },
  { category: "basic", slug: "fakedns" },
  { category: "basic", slug: "inbound" },
  { category: "basic", slug: "outbound" },
  { category: "basic", slug: "policy" },
  { category: "basic", slug: "reverse" },
  { category: "basic", slug: "routing" },
  { category: "basic", slug: "stats" },
  { category: "basic", slug: "transport" },
  { category: "basic", slug: "metrics" },
  { category: "basic", slug: "observatory" },
  { category: "basic", slug: "geodata" },

  /* features */
  { category: "features", slug: "features/index" },
  { category: "features", slug: "features/xtls" },
  { category: "features", slug: "features/fallback" },
  { category: "features", slug: "features/browser_dialer" },
  { category: "features", slug: "features/env" },
  { category: "features", slug: "features/multiple" },

  /* inbounds */
  { category: "inbounds", slug: "inbounds/index" },
  { category: "inbounds", slug: "inbounds/dokodemo" },
  { category: "inbounds", slug: "inbounds/tunnel" },
  { category: "inbounds", slug: "inbounds/http" },
  { category: "inbounds", slug: "inbounds/shadowsocks" },
  { category: "inbounds", slug: "inbounds/socks" },
  { category: "inbounds", slug: "inbounds/trojan" },
  { category: "inbounds", slug: "inbounds/vless" },
  { category: "inbounds", slug: "inbounds/vmess" },
  { category: "inbounds", slug: "inbounds/wireguard" },
  { category: "inbounds", slug: "inbounds/hysteria" },
  { category: "inbounds", slug: "inbounds/tun" },

  /* outbounds */
  { category: "outbounds", slug: "outbounds/index" },
  { category: "outbounds", slug: "outbounds/blackhole" },
  { category: "outbounds", slug: "outbounds/dns" },
  { category: "outbounds", slug: "outbounds/freedom" },
  { category: "outbounds", slug: "outbounds/http" },
  { category: "outbounds", slug: "outbounds/loopback" },
  { category: "outbounds", slug: "outbounds/shadowsocks" },
  { category: "outbounds", slug: "outbounds/socks" },
  { category: "outbounds", slug: "outbounds/trojan" },
  { category: "outbounds", slug: "outbounds/vless" },
  { category: "outbounds", slug: "outbounds/vmess" },
  { category: "outbounds", slug: "outbounds/wireguard" },
  { category: "outbounds", slug: "outbounds/hysteria" },

  /* transports */
  { category: "transports", slug: "transports/index" },
  { category: "transports", slug: "transports/raw" },
  { category: "transports", slug: "transports/tcp" },
  { category: "transports", slug: "transports/xhttp" },
  { category: "transports", slug: "transports/splithttp" },
  { category: "transports", slug: "transports/mkcp" },
  { category: "transports", slug: "transports/grpc" },
  { category: "transports", slug: "transports/websocket" },
  { category: "transports", slug: "transports/httpupgrade" },
  { category: "transports", slug: "transports/hysteria" },
  { category: "transports", slug: "transports/h2" },
  { category: "transports", slug: "transports/http" },
  { category: "transports", slug: "transports/quic" },
];

export function rawUrlFor(slug: string): string {
  return `${RAW_BASE}/${slug}.md`;
}

export function siteUrlFor(slug: string): string {
  return `${SITE_BASE}/${slug}.html`;
}

/* Backwards-compat alias used by validate/lint copy paths. */
export function urlFor(slug: string): string {
  return siteUrlFor(slug);
}

export function catalogueEntry(slug: string): CatalogueEntry | undefined {
  return DOCS_CATALOGUE.find((e) => e.slug === slug);
}

/* Fetch a single URL with retries and timeout (used by bulk + discovery). */
export async function fetchOneRaw(
  url: string,
  attempts = 3,
  timeoutMs = 10_000,
): Promise<string> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          "user-agent": "mcp-xray-pilot-fetch/0.10",
          accept: "text/plain, text/markdown, */*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e as Error;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

interface TreeEntry {
  path: string;
  type: string;
}

/* Pull the upstream tree, return slugs that exist in upstream but not in
 * DOCS_CATALOGUE. Used by the `discover` mode of refresh. */
export async function discoverNewSlugs(): Promise<string[]> {
  const raw = await fetchOneRaw(TREE_API);
  const tree = JSON.parse(raw) as { tree?: TreeEntry[] };
  if (!Array.isArray(tree.tree)) throw new Error("Unexpected tree API shape");
  const slugs = new Set<string>();
  for (const e of tree.tree) {
    if (e.type !== "blob") continue;
    const m = e.path.match(/^docs\/en\/config\/(.+)\.md$/);
    if (!m) continue;
    slugs.add(m[1]);
  }
  const known = new Set(DOCS_CATALOGUE.map((e) => e.slug));
  return [...slugs].filter((s) => !known.has(s)).sort();
}

export type RefreshScope = "all" | "stale" | "category";

export interface RefreshOptions {
  scope: RefreshScope;
  category?: Category;
  /* For scope=stale: refetch entries older than this many days. */
  max_age_days?: number;
  /* If true, include `new_slugs_discovered` in the result. */
  discover?: boolean;
  /* Throttle between requests, ms. */
  throttle_ms?: number;
  /* Optional progress callback (used by CLI). */
  onProgress?: (msg: string) => void;
  /* If true, refetch even when cached file is fresh (used by --refresh CLI). */
  force?: boolean;
}

export interface PerTopicResult {
  slug: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  age_days_before?: number;
}

export interface RefreshResult {
  attempted: number;
  updated: number;
  skipped: number;
  failed: number;
  duration_ms: number;
  per_topic: PerTopicResult[];
  new_slugs_discovered?: string[];
}

function ageDays(iso: string | undefined, nowMs: number): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return (nowMs - t) / 86_400_000;
}

/* Bulk refresh: shared between the CLI script and the MCP tool. */
export async function refreshDocs(opts: RefreshOptions): Promise<RefreshResult> {
  const t0 = Date.now();
  const throttle = opts.throttle_ms ?? 200;
  const maxAge = opts.max_age_days ?? 30;

  const idx = await loadIndex();
  const idxBySlug = new Map(idx.map((m) => [m.slug, m]));

  /* Decide which entries to attempt. */
  let candidates = DOCS_CATALOGUE.slice();
  if (opts.scope === "category") {
    if (!opts.category) throw new Error("scope=category requires `category`");
    candidates = candidates.filter((e) => e.category === opts.category);
  }

  const per_topic: PerTopicResult[] = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const nowMs = Date.now();

  for (const entry of candidates) {
    const meta = idxBySlug.get(entry.slug);
    const age = ageDays(meta?.fetched_at, nowMs);

    if (opts.scope === "stale" && !opts.force) {
      if (age !== undefined && age < maxAge) {
        per_topic.push({
          slug: entry.slug,
          status: "skipped",
          reason: `fresh (${age.toFixed(1)}d < ${maxAge}d)`,
          age_days_before: age,
        });
        skipped++;
        continue;
      }
    }

    const url = rawUrlFor(entry.slug);
    opts.onProgress?.(`GET ${url}`);
    try {
      const markdown = await fetchOneRaw(url);
      const title = titleFromMarkdown(entry.slug, markdown);
      const topic: Topic = {
        slug: entry.slug,
        title,
        category: entry.category,
        url: siteUrlFor(entry.slug),
        source_url: url,
        fetched_at: new Date().toISOString(),
        file: fileNameFor(entry.category, entry.slug),
        markdown: markdown.trim() + "\n",
      };
      await persistAndIndex(topic);
      per_topic.push({
        slug: entry.slug,
        status: "updated",
        age_days_before: age,
      });
      updated++;
      if (throttle > 0) await new Promise((r) => setTimeout(r, throttle));
    } catch (e) {
      const msg = (e as Error).message;
      opts.onProgress?.(`FAIL ${entry.slug}: ${msg}`);
      per_topic.push({
        slug: entry.slug,
        status: "failed",
        reason: msg,
        age_days_before: age,
      });
      failed++;
    }
  }

  const result: RefreshResult = {
    attempted: candidates.length,
    updated,
    skipped,
    failed,
    duration_ms: Date.now() - t0,
    per_topic,
  };

  if (opts.discover) {
    try {
      result.new_slugs_discovered = await discoverNewSlugs();
    } catch (e) {
      result.new_slugs_discovered = [];
      opts.onProgress?.(`discover failed: ${(e as Error).message}`);
    }
  }

  return result;
}

/* Pull the first-line title from a markdown body. Falls back to slug-cased. */
export function titleFromMarkdown(slug: string, md: string): string {
  const line = md.split(/\r?\n/).find((l) => /^#\s+/.test(l));
  if (line) return line.replace(/^#\s+/, "").trim();
  /* slug → "Inbounds Vless" style fallback. */
  const last = slug.split("/").pop() ?? slug;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchOnline(slug: string): Promise<Topic> {
  const entry = catalogueEntry(slug);
  if (!entry) throw new Error(`Unknown slug: ${slug}`);
  const url = rawUrlFor(slug);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  let markdown: string;
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "user-agent": "mcp-xray-pilot/0.10 (+https://github.com/beekamai/mcp-xray-pilot)",
        accept: "text/plain, text/markdown, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markdown = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const title = titleFromMarkdown(slug, markdown);
  const topic: Topic = {
    slug,
    title,
    category: entry.category,
    /* `url` keeps website link (compat with old clients); raw lives in source_url. */
    url: siteUrlFor(slug),
    source_url: url,
    fetched_at: new Date().toISOString(),
    file: fileNameFor(entry.category, slug),
    markdown: markdown.trim() + "\n",
  };
  return topic;
}

async function persistAndIndex(topic: Topic): Promise<void> {
  const fm = buildFrontmatter(topic);
  await writeTopic(topic, fm);

  const idx = await loadIndex();
  const meta: TopicMeta = {
    slug: topic.slug,
    title: topic.title,
    category: topic.category,
    url: topic.url,
    source_url: topic.source_url,
    fetched_at: topic.fetched_at,
    file: topic.file,
  };
  const i = idx.findIndex((m) => m.slug === topic.slug);
  if (i >= 0) idx[i] = meta;
  else idx.push(meta);
  idx.sort((a, b) => a.slug.localeCompare(b.slug));
  await saveIndex(idx);
}

export async function fetchTopic(
  slug: string,
  opts: { force_offline?: boolean } = {},
): Promise<FetchResult> {
  if (opts.force_offline) {
    const topic = await readTopic(slug);
    if (!topic) throw new Error(`No offline copy for slug: ${slug}`);
    return { topic, source: "offline" };
  }

  try {
    const fresh = await fetchOnline(slug);
    await persistAndIndex(fresh);
    return { topic: fresh, source: "network" };
  } catch (err) {
    const offline = await readTopic(slug);
    if (!offline) {
      throw new Error(
        `Network fetch failed (${(err as Error).message}) and no offline copy exists for slug: ${slug}`,
      );
    }
    return {
      topic: offline,
      source: "offline",
      warning: `network fetch failed: ${(err as Error).message}`,
    };
  }
}
