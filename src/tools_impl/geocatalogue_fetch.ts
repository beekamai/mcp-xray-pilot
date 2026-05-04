/*
 * Shared "refresh geocatalogue" logic, called both by the
 * scripts/fetch-geocatalogue.ts CLI and by xray_refresh_cache when
 * `refresh_geocatalogue: true`.
 *
 * Pulls the v2fly/domain-list-community git tree, extracts every blob
 * under data/<name>, and writes the names to data/geocatalogue.json so
 * geocatalogue.ts can hydrate the full catalogue at next process start.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TREE_API =
  "https://api.github.com/repos/v2fly/domain-list-community/git/trees/master?recursive=1";

interface TreeEntry {
  path: string;
  type: string;
}

export interface GeoRefreshResult {
  updated: boolean;
  count: number;
  source: string;
  written_to: string;
  fetched_at: string;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "user-agent": "mcp-xray-pilot-fetch-geo/0.11",
      accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, { signal: ac.signal, headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function refreshGeoCatalogue(): Promise<GeoRefreshResult> {
  const tree = (await fetchJson(TREE_API)) as { tree?: TreeEntry[]; truncated?: boolean };
  if (!Array.isArray(tree.tree)) {
    throw new Error("Unexpected tree API shape — no .tree[] array");
  }
  const names = new Set<string>();
  for (const e of tree.tree) {
    if (e.type !== "blob") continue;
    const m = e.path.match(/^data\/([^/]+)$/);
    if (!m) continue;
    const name = m[1];
    if (!name || name.startsWith(".")) continue;
    if (/\.(md|json|sh|py|txt)$/i.test(name)) continue;
    names.add(name.toLowerCase());
  }
  const sorted = [...names].sort();

  /* dist/tools_impl/geocatalogue_fetch.js → ../../data/geocatalogue.json
   * src/tools_impl/geocatalogue_fetch.ts (tsx) → same. */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "..", "..", "data");
  const outFile = path.join(outDir, "geocatalogue.json");
  await mkdir(outDir, { recursive: true });

  const fetched_at = new Date().toISOString();
  const payload = {
    fetched_at,
    source: "github.com/v2fly/domain-list-community/tree/master/data",
    count: sorted.length,
    names: sorted,
  };
  await writeFile(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");

  return {
    updated: true,
    count: sorted.length,
    source: payload.source,
    written_to: outFile,
    fetched_at,
  };
}
