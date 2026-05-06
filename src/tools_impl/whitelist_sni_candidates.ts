/*
 * Tool: xray_whitelist_sni_candidates
 *
 * Pulls a public RU-traffic whitelist (default:
 * `https://raw.githubusercontent.com/hxehex/russia-mobile-internet-whitelist/main/whitelist.txt`),
 * parses out hostnames, and runs the live TLS/ALPN/HEAD probe against the top
 * N of them. The whitelist is the same one a РФ mobile carrier under TSPU
 * passes through unfiltered — every host in it is a *potential* REALITY SNI
 * front for an inbound RU-relay node.
 *
 * IMPORTANT: latency_ms is measured from the machine where mcp-xray-pilot
 * runs (your laptop). It is NOT the latency you'd see from the Russian
 * relay node. For geo-relevant probing, use `xray_test_reality_live` from
 * the relay (or ssh + ping/curl).
 *
 * Whitelist body is cached on disk at `data/whitelist-cache.json`,
 * keyed by URL. TTL is per-call (default 24h). Verdicts are NOT cached;
 * each invocation re-probes its slice live so an LLM can re-run with
 * different filters and trust the latency numbers.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSniTarget, type ValidateSniResult } from "./validate_sni.js";

const DEFAULT_WHITELIST_URL =
  "https://raw.githubusercontent.com/hxehex/russia-mobile-internet-whitelist/main/whitelist.txt";

const CACHE_FILENAME = "whitelist-cache.json";
/* dist/tools_impl/whitelist_sni_candidates.js → ../../data/
 * src/tools_impl/whitelist_sni_candidates.ts (tsx) → same. */
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const cachePath = join(dataDir, CACHE_FILENAME);

const PROBE_TIMEOUT_MS = 6000;
const BATCH_CONCURRENCY = 5;
const MAX_CANDIDATES_HARD_LIMIT = 50;

export interface WhitelistSniArgs {
  whitelist_url?: string;
  max_candidates?: number;
  require_alpn_h2?: boolean;
  require_tls13?: boolean;
  cache_ttl_hours?: number;
}

export interface WhitelistCandidate {
  host: string;
  ok: boolean;
  tls_version: string;
  alpn: string;
  http_status: number;
  latency_ms: number;
  cert_subject: string;
  issues: string[];
}

export interface WhitelistSniResult {
  source_url: string;
  fetched_at: string;
  total_domains: number;
  tested: number;
  candidates: WhitelistCandidate[];
  summary: { ok_count: number; failed_count: number };
  cache: { used: boolean; age_seconds: number | null };
  notes: string[];
}

interface CacheBody {
  url: string;
  fetched_at: string;
  body: string;
}
type CacheFile = Record<string, CacheBody>;

async function readCacheFile(): Promise<CacheFile> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CacheFile;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeCacheFile(file: CacheFile): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(file, null, 2), "utf8");
  } catch {
    /* Whitelist still works without the disk cache; swallow write errors. */
  }
}

interface FetchOutcome {
  body: string | null;
  fetched_at: string;
  cache_used: boolean;
  cache_age_seconds: number | null;
  error: string | null;
}

async function fetchWhitelistBody(url: string, ttlMs: number): Promise<FetchOutcome> {
  const cacheFile = await readCacheFile();
  const entry = cacheFile[url];
  const now = Date.now();
  if (entry) {
    const ageMs = now - new Date(entry.fetched_at).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs) {
      return {
        body: entry.body,
        fetched_at: entry.fetched_at,
        cache_used: true,
        cache_age_seconds: Math.floor(ageMs / 1000),
        error: null,
      };
    }
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "user-agent": "mcp-xray-pilot/0.14 (whitelist-sni-candidates)",
        accept: "text/plain, */*",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        body: entry?.body ?? null,
        fetched_at: entry?.fetched_at ?? new Date().toISOString(),
        cache_used: Boolean(entry),
        cache_age_seconds: entry
          ? Math.floor((now - new Date(entry.fetched_at).getTime()) / 1000)
          : null,
        error: `whitelist fetch failed: HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body = await res.text();
    const fetched_at = new Date().toISOString();
    cacheFile[url] = { url, fetched_at, body };
    await writeCacheFile(cacheFile);
    return { body, fetched_at, cache_used: false, cache_age_seconds: null, error: null };
  } catch (e) {
    return {
      body: entry?.body ?? null,
      fetched_at: entry?.fetched_at ?? new Date().toISOString(),
      cache_used: Boolean(entry),
      cache_age_seconds: entry
        ? Math.floor((now - new Date(entry.fetched_at).getTime()) / 1000)
        : null,
      error: `whitelist fetch failed: ${(e as Error).message}`,
    };
  } finally {
    clearTimeout(t);
  }
}

/* Parse a whitelist body. The hxehex source is comma + newline separated,
 * possibly with comments (`#`) and blank lines. We're conservative:
 *   - split on comma / whitespace / newlines
 *   - strip comments (everything after `#` on a line)
 *   - lowercase, trim
 *   - drop entries that don't look like a real DNS hostname
 *   - dedupe preserving first-seen order */
export function parseWhitelist(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0] ?? "";
    if (!line.trim()) continue;
    /* split on comma, semicolon, whitespace */
    const parts = line.split(/[,;\s]+/);
    for (const partRaw of parts) {
      const p = partRaw.trim().toLowerCase();
      if (!p) continue;
      if (!isValidHost(p)) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function isValidHost(h: string): boolean {
  if (!h) return false;
  if (h.length > 253) return false;
  if (h.startsWith(".") || h.endsWith(".")) return false;
  if (h.includes("*")) return false; /* wildcard — not a SNI candidate */
  if (h.includes("/")) return false; /* URL fragment, not a host */
  if (h.includes(":")) return false; /* host:port — caller doesn't expect this; skip */
  if (h.includes("@")) return false;
  if (h.includes(" ")) return false;
  /* Must contain at least one dot (TLD). */
  if (!h.includes(".")) return false;
  /* Each label: 1..63 chars, alnum or hyphen, no leading/trailing hyphen.
   * IDN punycode (`xn--…`) labels are alphanumeric so they pass. */
  const labels = h.split(".");
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
  }
  /* TLD must be at least 2 chars and non-numeric (otherwise it's an IPv4). */
  const tld = labels[labels.length - 1] ?? "";
  if (tld.length < 2) return false;
  if (/^\d+$/.test(tld)) return false; /* IPv4 like 1.2.3.4 → drop */
  return true;
}

async function runBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async (): Promise<void> => {
        for (;;) {
          const i = cursor++;
          if (i >= items.length) return;
          out[i] = await fn(items[i] as T);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

function toCandidate(r: ValidateSniResult): WhitelistCandidate {
  return {
    host: r.host,
    ok: r.ok,
    tls_version: r.tls_version,
    alpn: r.alpn ?? "",
    http_status: r.http_status,
    latency_ms: r.latency_ms,
    cert_subject: r.cert_subject,
    issues: r.issues,
  };
}

export async function whitelistSniCandidates(
  args: WhitelistSniArgs,
): Promise<WhitelistSniResult> {
  const url = (args.whitelist_url ?? DEFAULT_WHITELIST_URL).trim() || DEFAULT_WHITELIST_URL;
  const max = Math.min(
    MAX_CANDIDATES_HARD_LIMIT,
    Math.max(1, args.max_candidates ?? 20),
  );
  const requireAlpnH2 = args.require_alpn_h2 !== false; /* default true */
  const requireTls13 = args.require_tls13 !== false; /* default true */
  const ttlHours = Math.max(0, args.cache_ttl_hours ?? 24);
  const ttlMs = ttlHours * 60 * 60 * 1000;

  const notes: string[] = [
    "latency_ms is measured from the MCP host (your laptop), not from the relay node — re-test from the node for geo-accurate values",
  ];

  const fetched = await fetchWhitelistBody(url, ttlMs);
  if (!fetched.body) {
    return {
      source_url: url,
      fetched_at: fetched.fetched_at,
      total_domains: 0,
      tested: 0,
      candidates: [],
      summary: { ok_count: 0, failed_count: 0 },
      cache: { used: fetched.cache_used, age_seconds: fetched.cache_age_seconds },
      notes: [...notes, fetched.error ?? "whitelist fetch failed: unknown reason"],
    };
  }
  if (fetched.error) notes.push(fetched.error + " — using stale cached body");

  const hosts = parseWhitelist(fetched.body);
  if (hosts.length === 0) {
    return {
      source_url: url,
      fetched_at: fetched.fetched_at,
      total_domains: 0,
      tested: 0,
      candidates: [],
      summary: { ok_count: 0, failed_count: 0 },
      cache: { used: fetched.cache_used, age_seconds: fetched.cache_age_seconds },
      notes: [...notes, "whitelist parsed to zero hosts (empty or all-invalid)"],
    };
  }

  /* Always take the first N from the (deduped) parse order — the source list
   * is roughly hand-curated so the order has meaning. */
  const slice = hosts.slice(0, max);
  const verdicts = await runBatch(
    slice,
    (h) => validateSniTarget({ host: h, port: 443, timeout_ms: PROBE_TIMEOUT_MS }),
    BATCH_CONCURRENCY,
  );

  /* Per-call gating: if caller relaxed `require_alpn_h2` / `require_tls13`,
   * re-derive `ok` from the loosened criteria (don't mutate raw verdict). */
  const candidates = verdicts.map((v) => {
    const c = toCandidate(v);
    if (!requireAlpnH2 || !requireTls13) {
      const tlsOk = !requireTls13 || v.tls_version === "TLSv1.3";
      const alpnOk = !requireAlpnH2 || v.alpn === "h2";
      const httpOk = v.http_status === 405 || (v.http_status >= 200 && v.http_status < 400);
      c.ok = tlsOk && alpnOk && httpOk;
    }
    return c;
  });

  candidates.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.latency_ms - b.latency_ms;
  });

  const ok_count = candidates.filter((c) => c.ok).length;
  return {
    source_url: url,
    fetched_at: fetched.fetched_at,
    total_domains: hosts.length,
    tested: candidates.length,
    candidates,
    summary: { ok_count, failed_count: candidates.length - ok_count },
    cache: { used: fetched.cache_used, age_seconds: fetched.cache_age_seconds },
    notes,
  };
}
