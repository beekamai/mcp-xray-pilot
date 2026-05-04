/*
 * Embedded catalogue of well-known geosite/geoip categories.
 *
 * Sources:
 *   - github.com/v2fly/domain-list-community  (geosite — full list, hydrated
 *                                              from data/geocatalogue.json
 *                                              produced by `npm run
 *                                              fetch-geocatalogue`)
 *   - github.com/v2fly/geoip                  (geoip)
 *   - github.com/runetfreedom/russia-v2ray-rules-dat  (Russia-flavoured set)
 *
 * The hand-curated GEOSITE_NAMES array below is the legacy fallback used
 * when data/geocatalogue.json is missing (e.g. fresh clone before running
 * the fetch script). With the JSON present we extend the catalogue with
 * EVERY upstream category — typo-checks against a typo'd `geosite:yandex`
 * now actually match.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* All ISO 3166-1 alpha-2 country codes (lowercase). Most are valid geoip:* /
 * geosite:geolocation-* tags. */
export const ISO_COUNTRY_CODES = [
  "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw",
  "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn",
  "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg",
  "ch", "ci", "ck", "cl", "cm", "cn", "co", "cr", "cu", "cv", "cw", "cx", "cy", "cz",
  "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi",
  "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl",
  "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr",
  "ht", "hu", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm",
  "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la",
  "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me",
  "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu",
  "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np",
  "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr",
  "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd",
  "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv",
  "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to",
  "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "us", "uy", "uz", "va", "vc", "ve",
  "vg", "vi", "vn", "vu", "wf", "ws", "ye", "yt", "za", "zm", "zw",
];

/* Special geoip tags. */
const GEOIP_SPECIAL = [
  "private",
  "tor",
  "telegram",
  "facebook",
  "google",
  "twitter",
  "netflix",
  "cloudflare",
  "fastly",
  "cloudfront",
];

/* geosite tags. Curated from domain-list-community + ru flavoured forks. */
const GEOSITE_NAMES = [
  /* core */
  "category-ads",
  "category-ads-all",
  "category-public-tracker",
  "geolocation-cn",
  "geolocation-!cn",
  /* country-flavoured (ru fork) */
  "category-ru",
  "category-gov-ru",
  "category-banks-ru",
  "category-media-ru",
  /* common services */
  "apple",
  "google",
  "google-cn",
  "googlefcm",
  "googleads",
  "googlescholar",
  "microsoft",
  "amazon",
  "amazon-aws",
  "amazon-cn",
  "youtube",
  "netflix",
  "spotify",
  "twitter",
  "facebook",
  "instagram",
  "telegram",
  "whatsapp",
  "discord",
  "dropbox",
  "github",
  "gitlab",
  "bitbucket",
  "openai",
  "claude",
  "anthropic",
  "huggingface",
  "tiktok",
  "bilibili",
  "reddit",
  "twitch",
  "steam",
  "steam@cn",
  "epicgames",
  "ea",
  "blizzard",
  "riot-games",
  "ubisoft",
  /* dev / package mirrors */
  "category-dev",
  "category-game-platforms",
  "category-game-platforms-download",
  "category-games-cn",
  "category-cdn",
  /* bittorrent / private */
  "category-bittorrent",
  /* ai */
  "category-ai-!cn",
  "category-ai-chat-!cn",
  "category-ai-chat-cn",
  /* misc */
  "private",
  "cn",
];

interface GeoEntry {
  prefix: "geoip" | "geosite";
  /* Tag without the prefix. */
  name: string;
  /* Free-form description, helps semantic search. */
  description: string;
}

function geoip(name: string, description: string): GeoEntry {
  return { prefix: "geoip", name, description };
}
function geosite(name: string, description: string): GeoEntry {
  return { prefix: "geosite", name, description };
}

const COUNTRY_NAMES: Record<string, string> = {
  ru: "Russia", us: "United States", cn: "China", jp: "Japan", de: "Germany",
  gb: "United Kingdom", fr: "France", kr: "South Korea", hk: "Hong Kong",
  sg: "Singapore", tw: "Taiwan", ir: "Iran", in: "India", br: "Brazil",
  ca: "Canada", au: "Australia", nl: "Netherlands", se: "Sweden",
  fi: "Finland", no: "Norway", pl: "Poland", ua: "Ukraine", by: "Belarus",
  kz: "Kazakhstan", tr: "Turkey", il: "Israel", ae: "United Arab Emirates",
  sa: "Saudi Arabia", za: "South Africa", mx: "Mexico", ar: "Argentina",
  cl: "Chile", co: "Colombia", th: "Thailand", vn: "Vietnam", id: "Indonesia",
  my: "Malaysia", ph: "Philippines", pk: "Pakistan", bd: "Bangladesh",
};

const entries: GeoEntry[] = [];

/* geoip per country */
for (const code of ISO_COUNTRY_CODES) {
  const human = COUNTRY_NAMES[code] ?? code.toUpperCase();
  entries.push(geoip(code, `IPs geolocated to ${human}`));
}
/* geoip special */
for (const t of GEOIP_SPECIAL) entries.push(geoip(t, `Special IP set: ${t}`));

/* geosite well-known (curated subset — descriptions richer than auto). */
for (const t of GEOSITE_NAMES) entries.push(geosite(t, `Domain list: ${t}`));
/* geosite per country (geolocation-XX) */
for (const code of ISO_COUNTRY_CODES) {
  const human = COUNTRY_NAMES[code] ?? code.toUpperCase();
  entries.push(geosite(`geolocation-${code}`, `Domains geolocated to ${human}`));
}

/* ---- v0.11: hydrate the FULL upstream geosite catalogue from JSON ---- */

interface GeoCataloguePayload {
  fetched_at?: string;
  source?: string;
  count?: number;
  names?: string[];
}

function loadFullGeositeNames(): string[] {
  /* Resolve relative to this module's filesystem location.
   * - source (tsx): src/data/geocatalogue.ts → ../../data/geocatalogue.json
   * - dist (node):  dist/data/geocatalogue.js → ../../data/geocatalogue.json
   * Both paths land on <repo>/data/geocatalogue.json.
   */
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const jsonPath = path.resolve(here, "..", "..", "data", "geocatalogue.json");
    const raw = readFileSync(jsonPath, "utf8");
    const data = JSON.parse(raw) as GeoCataloguePayload;
    if (Array.isArray(data.names)) return data.names;
    return [];
  } catch {
    /* No JSON yet → fall back to curated list only. Silent: the lint warning
     * "geo_unknown_category" still works, just with a smaller corpus. */
    return [];
  }
}

const fullNames = loadFullGeositeNames();
const seenGeosite = new Set(GEOSITE_NAMES);
for (const code of ISO_COUNTRY_CODES) seenGeosite.add(`geolocation-${code}`);
for (const name of fullNames) {
  if (seenGeosite.has(name)) continue;
  seenGeosite.add(name);
  entries.push(geosite(name, `Domain list (v2fly upstream): ${name}`));
}

export const GEO_CATALOGUE: ReadonlyArray<GeoEntry> = entries;

const GEOIP_SET = new Set(entries.filter((e) => e.prefix === "geoip").map((e) => e.name));
const GEOSITE_SET = new Set(entries.filter((e) => e.prefix === "geosite").map((e) => e.name));

/* "geoip:ru" / "geosite:youtube" → known? */
export function isKnownGeoTag(tag: string): boolean {
  if (!tag.includes(":")) return false;
  const [prefix, rawName] = tag.split(":", 2);
  /* Tags can carry "@cn" suffixes (steam@cn) or "!" negations (geolocation-!cn). */
  const name = rawName.split("@")[0];
  if (prefix === "geoip") return GEOIP_SET.has(name);
  if (prefix === "geosite") return GEOSITE_SET.has(name);
  return false;
}

export interface GeoSearchHit {
  prefix: "geoip" | "geosite";
  name: string;
  description: string;
  /* Full tag form used in routing rules. */
  tag: string;
}

export function searchGeoCatalogue(query: string, limit = 30): GeoSearchHit[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const hits: { e: GeoEntry; score: number }[] = [];
  for (const e of entries) {
    let score = 0;
    if (e.name === q) score += 100;
    else if (e.name.startsWith(q)) score += 50;
    else if (e.name.includes(q)) score += 20;
    if (e.description.toLowerCase().includes(q)) score += 10;
    if (score > 0) hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map(({ e }) => ({
    prefix: e.prefix,
    name: e.name,
    description: e.description,
    tag: `${e.prefix}:${e.name}`,
  }));
}
