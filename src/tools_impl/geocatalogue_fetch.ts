/*
 * Shared "refresh geocatalogue" logic, called both by the
 * scripts/fetch-geocatalogue.ts CLI and by xray_refresh_cache when
 * `refresh_geocatalogue: true`.
 *
 * Pulls TWO things:
 *   1. v2fly/domain-list-community git tree     (full source catalogue,
 *      ~1500 categories) — feeds xray_geo_search and the legacy
 *      `geo_unknown_category` lint rule.
 *   2. Loyalsoldier/v2ray-rules-dat release    (the curated ~150-category
 *      build that actually ships inside xray-core's geosite.dat) — feeds
 *      the new `geosite_not_in_xray_release` lint rule.
 *
 * If (2) fails (rate limit, network) we fall back to a hand-curated
 * RELEASE_FALLBACK list — accurate enough that the lint rule still flags
 * obvious typos and v2fly-source-only categories.
 *
 * Output: data/geocatalogue.json
 *   {
 *     fetched_at, source, count, names,
 *     release_count, release_names, release_source
 *   }
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TREE_API =
  "https://api.github.com/repos/v2fly/domain-list-community/git/trees/master?recursive=1";

/* Loyalsoldier ships a category-listing file in every release. Fetched at:
 * https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/<file>
 * The `<file>` is "geosite.dat.short" — a sorted text list of every
 * category present in the corresponding geosite.dat. ~150 lines. */
const LOYALSOLDIER_RELEASE_LIST =
  "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat.short";

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
  release_count: number;
  release_source: string;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "user-agent": "mcp-xray-pilot-fetch-geo/0.12",
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

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "user-agent": "mcp-xray-pilot-fetch-geo/0.12",
    };
    /* GitHub redirects release-asset URLs to a pre-signed S3-ish URL.
     * Default fetch follows redirects fine. */
    const res = await fetch(url, { signal: ac.signal, headers, redirect: "follow" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/* Hand-curated subset of categories that are known to ship in xray-core
 * geosite.dat releases (Loyalsoldier + v2fly upstream builds). Used as a
 * safety net when the network probe fails so the lint rule still catches
 * obviously v2fly-only categories like geosite:geolocation-ru.
 *
 * ~140 entries, lowercased. Country geolocation-XX tags are NOT in the
 * release build (xray uses category-XX or the geoip side instead).
 */
const RELEASE_FALLBACK: ReadonlyArray<string> = [
  /* core ad/privacy/security */
  "category-ads",
  "category-ads-all",
  "category-ads-ir",
  "category-public-tracker",
  "category-porn",
  "category-anticn",
  "category-scholar-!cn",
  "category-scholar-cn",
  "category-cryptocurrency",
  "category-cryptocurrency-cn",
  "category-cryptocurrency-!cn",
  /* country flavours */
  "category-ru",
  "category-gov-ru",
  "category-banks-ru",
  "category-media-ru",
  "category-ir",
  "category-kp",
  "geolocation-cn",
  "geolocation-!cn",
  /* dev */
  "category-dev",
  "category-game-platforms",
  "category-game-platforms-download",
  "category-games-cn",
  "category-cdn",
  "category-public-cdn",
  "category-bittorrent",
  "category-forums",
  "category-social",
  "category-social-cn",
  "category-social-!cn",
  /* ai */
  "category-ai-!cn",
  "category-ai-chat-!cn",
  "category-ai-chat-cn",
  /* common services */
  "private",
  "cn",
  "gfw",
  "greatfire",
  "tld-cn",
  "tld-!cn",
  "tld-proxy",
  "tld-net",
  "google",
  "google-cn",
  "googlefcm",
  "googleads",
  "googleapis",
  "googlescholar",
  "googleplay",
  "youtube",
  "apple",
  "apple-cn",
  "icloud",
  "microsoft",
  "microsoft-cn",
  "windowsupdate",
  "amazon",
  "amazon-aws",
  "amazon-cn",
  "facebook",
  "instagram",
  "meta",
  "twitter",
  "discord",
  "telegram",
  "whatsapp",
  "tiktok",
  "netflix",
  "spotify",
  "openai",
  "anthropic",
  "claude",
  "huggingface",
  "github",
  "gitlab",
  "bitbucket",
  "dropbox",
  "onedrive",
  "reddit",
  "twitch",
  "steam",
  "steam@cn",
  "epicgames",
  "ea",
  "blizzard",
  "riot-games",
  "ubisoft",
  "bilibili",
  "weibo",
  "qq",
  "wechat",
  "alibaba",
  "taobao",
  "baidu",
  "yandex",
  "vk",
  "mail-ru",
  "ozon",
  "wildberries",
  "rutube",
  "rutracker",
  "kinopoisk",
  "sberbank",
  "tinkoff",
  "vtb",
  "alfabank",
  "gosuslugi",
  "yapomogu",
  "habr",
  "1c",
  "binance",
  "bybit",
  "okx",
  "kucoin",
  "coinbase",
  "ethereum",
  "tron",
  "metamask",
  "cloudflare",
  "fastly",
  "cloudfront",
  "imgur",
  "pixiv",
  "nicovideo",
  "speedtest",
  "pinterest",
  "linkedin",
  "snapchat",
  "zoom",
  "slack",
  "notion",
  "figma",
  "atlassian",
  "jetbrains",
  "vscode",
  "docker",
  "npmjs",
  "pypi",
  "rust-lang",
  "golang",
  "python",
  "nodejs",
  "wikipedia",
  "stackexchange",
  "medium",
  "substack",
  "archive",
  "win-update",
  "win-spy",
  "win-extra",
  "xboxlive",
  "playstation",
  "nintendo",
  "ea-games",
  "rockstargames",
  "miscellaneous",
  "test",
  "geolocation-ir",
];

async function fetchReleaseList(): Promise<{ names: string[]; source: string }> {
  try {
    const txt = await fetchText(LOYALSOLDIER_RELEASE_LIST);
    const names = txt
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && !s.startsWith("#"));
    if (names.length < 20) {
      throw new Error(`unexpected short list (${names.length} entries)`);
    }
    return {
      names: [...new Set(names)].sort(),
      source: "Loyalsoldier/v2ray-rules-dat geosite.dat.short release asset",
    };
  } catch (e) {
    process.stderr.write(
      `[fetch-geocatalogue] release list fetch failed: ${(e as Error).message} — using hand-curated fallback\n`,
    );
    return {
      names: [...new Set(RELEASE_FALLBACK.map((s) => s.toLowerCase()))].sort(),
      source: "hand-curated fallback (network fetch failed)",
    };
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

  const release = await fetchReleaseList();

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
    release_source: release.source,
    release_count: release.names.length,
    release_names: release.names,
  };
  await writeFile(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");

  return {
    updated: true,
    count: sorted.length,
    source: payload.source,
    written_to: outFile,
    fetched_at,
    release_count: release.names.length,
    release_source: release.source,
  };
}

/* Exported so the runtime module can use the same fallback when the
 * JSON file on disk is from an older fetch and lacks release_names. */
export const RELEASE_FALLBACK_NAMES: ReadonlyArray<string> = RELEASE_FALLBACK;
