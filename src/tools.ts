/*
 * MCP tool schemas. Pure data — descriptions are tuned for LLM tool selection.
 */

export const TOOL_SCHEMAS = [
  {
    name: "xray_list_topics",
    description:
      "List all available xray-core documentation topics, grouped by category. " +
      "Use this first to discover what slugs exist before calling xray_fetch_topic.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["basic", "features", "inbounds", "outbounds", "transports", "all"],
          default: "all",
          description: "Filter by category. 'all' returns every topic.",
        },
      },
    },
  },
  {
    name: "xray_fetch_topic",
    description:
      "Fetch a specific xray docs page as markdown. Tries XTLS/Xray-docs-next on " +
      "github raw first; on success the response also overwrites the packaged " +
      "offline cache. If the network fails (offline, blocked, timeout), falls back " +
      "to the bundled offline copy and sets a `warning` field. Use force_offline=true " +
      "to skip the network entirely.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            'Topic slug, e.g. "transports/xhttp", "inbounds/vless", "routing".',
        },
        force_offline: {
          type: "boolean",
          default: false,
          description: "If true, skip the network and read straight from the bundled cache.",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "xray_search",
    description:
      "Full-text search across all cached xray docs. Returns matched topics with " +
      "a relevance score and a ~240-char snippet around the best match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        max_results: { type: "number", default: 10, minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "xray_validate_config",
    description:
      "Parse and structurally validate an xray JSON config. Checks: valid JSON, " +
      "required top-level fields, known protocols, per-protocol settings shape via " +
      "Zod schemas (vless/vmess/trojan/ss/socks/http/wireguard/hysteria/freedom/...), " +
      "transport-specific *Settings shape (raw/xhttp/grpc/ws/mkcp/httpupgrade), " +
      "security blocks (tls/reality), routing tag references. Returns issues with " +
      "severity (error/warn/info) and JSON-pointer paths.",
    inputSchema: {
      type: "object",
      properties: {
        config: {
          type: "string",
          description: "JSON string of the xray config.",
        },
      },
      required: ["config"],
    },
  },
  {
    name: "xray_lint",
    description:
      "Run best-practice lint on an xray config. Covers things validation doesn't " +
      "catch: VLESS decryption mode, REALITY pubkey/shortId/target syntax, XTLS " +
      "vision flow compatibility, TLS fingerprint enum, ALPN collisions, geosite/" +
      "geoip catalogue check, protocol×transport×security compatibility matrix, " +
      "private LAN block rule, sniffing on 80/443, DNS-over-proxy leaks, " +
      "geosite categories absent from xray-core release dat. ~22 rules in v0.12.",
    inputSchema: {
      type: "object",
      properties: {
        config: { type: "string", description: "JSON string of the xray config." },
      },
      required: ["config"],
    },
  },
  {
    name: "xray_geo_search",
    description:
      "Search the bundled geosite/geoip catalogue for a category by substring. " +
      "Use to typo-check or discover the right tag (geoip:ru, geosite:youtube, …) " +
      "before adding it to routing.rules.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search for, case-insensitive." },
        max_results: { type: "number", default: 30, minimum: 1, maximum: 100 },
      },
      required: ["query"],
    },
  },
  {
    name: "xray_diff_protocols",
    description:
      "Side-by-side comparison of two xray protocols (vless/vmess/trojan/" +
      "shadowsocks/hysteria2/wireguard) on transports, security, anti-DPI, " +
      "mobile friendliness, battery, ease. Returns a table-shaped JSON.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "First protocol name." },
        b: { type: "string", description: "Second protocol name." },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "xray_suggest_alternative",
    description:
      "Recommend a protocol+transport+security stack for a goal. Goals include " +
      "anti-dpi-russia, anti-dpi-iran, anti-dpi-china, low-latency, mobile-battery, " +
      "high-throughput, stealth-cdn, simple-getting-started. Optionally pass " +
      "current_config to also get a list of issues with what you have today.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          enum: [
            "anti-dpi-russia",
            "anti-dpi-iran",
            "anti-dpi-china",
            "low-latency",
            "mobile-battery",
            "high-throughput",
            "stealth-cdn",
            "simple-getting-started",
          ],
        },
        current_config: {
          type: "string",
          description: "Optional JSON string of an existing config to lint alongside.",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "xray_github_search",
    description:
      "Search GitHub issues, pull requests and discussions across XTLS repositories " +
      "(Xray-core, REALITY, Xray-docs-next). Returns matched items with title, number, " +
      "state, updated date, URL, and a short body snippet. Useful for finding " +
      "state-of-the-art bypass techniques, RKN/TSPU/DPI discussions, protocol " +
      "comparisons, bug reports. Discussions require GITHUB_TOKEN env var; " +
      "issues/PRs work anonymously but with a 60/h rate limit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Free-text search query, e.g. "REALITY blocked Russia".' },
        repo: {
          type: "string",
          enum: ["xray-core", "reality", "xray-docs-next", "all"],
          default: "xray-core",
          description: "Which XTLS repo to search. 'all' fans out across all three.",
        },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          default: "all",
        },
        type: {
          type: "string",
          enum: ["issue", "pr", "discussion", "all"],
          default: "all",
          description: "Filter by item type. 'discussion' uses GraphQL and needs GITHUB_TOKEN.",
        },
        sort: {
          type: "string",
          enum: ["updated", "created", "reactions", "comments"],
          default: "updated",
        },
        order: { type: "string", enum: ["desc", "asc"], default: "desc" },
        max_results: { type: "number", default: 10, minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "xray_github_fetch_issue",
    description:
      "Fetch a specific GitHub issue, pull request or discussion from an XTLS repo " +
      "with its full body and top comments. Use after xray_github_search points you " +
      "at something interesting and you need full context.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          enum: ["xray-core", "reality", "xray-docs-next"],
          default: "xray-core",
        },
        number: { type: "number", description: "Issue/PR/discussion number." },
        type: {
          type: "string",
          enum: ["issue", "pr", "discussion"],
          default: "issue",
          description:
            "PR uses the same REST endpoint as issue in GitHub API. Discussion uses GraphQL and needs GITHUB_TOKEN.",
        },
        max_comments: {
          type: "number",
          default: 10,
          minimum: 0,
          maximum: 50,
          description: "How many comments to include. 0 = none.",
        },
      },
      required: ["number"],
    },
  },
  {
    name: "xray_refresh_cache",
    description:
      "Re-fetch xray docs cache from XTLS/Xray-docs-next on github. Use to " +
      "actualize docs when upstream changed (e.g. new transport added, page " +
      "rewritten). Returns per-topic status and updated count.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "stale", "category"],
          default: "stale",
          description:
            "'all' = refetch every page (~60). 'stale' = only entries older than max_age_days. 'category' = restrict to one category (requires `category`).",
        },
        category: {
          type: "string",
          enum: ["basic", "features", "inbounds", "outbounds", "transports"],
          description: "Required when scope=category.",
        },
        max_age_days: {
          type: "number",
          minimum: 1,
          maximum: 365,
          default: 30,
          description: "For scope=stale: refetch entries older than this.",
        },
        discover: {
          type: "boolean",
          default: false,
          description:
            "Also call the github tree API and return slugs that exist upstream but are not in DOCS_CATALOGUE (for manual addition to src/docs.ts).",
        },
        refresh_geocatalogue: {
          type: "boolean",
          default: false,
          description:
            "Also re-pull the v2fly/domain-list-community category list into data/geocatalogue.json (used by xray_geo_search and the geo_unknown_category lint rule). Returns geocatalogue.{updated, count}.",
        },
      },
    },
  },
  {
    name: "xray_generate_short_ids",
    description:
      "Generate cryptographically random REALITY shortIds. Returns N hex strings of " +
      "varied byte-lengths (default [4, 8, 16] bytes → 8, 16, 32 hex chars). When " +
      "count > 1 the first entry is the empty string for legacy-client compatibility. " +
      "Drop the array straight into realitySettings.shortIds on inbound.",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          minimum: 1,
          maximum: 10,
          default: 3,
          description: "How many shortIds to produce (1..10). count > 1 prepends empty string.",
        },
        lengths: {
          type: "array",
          items: { type: "number", minimum: 1, maximum: 32 },
          description:
            "Byte lengths to round-robin through (1..32). Default: [4, 8, 16] bytes. Note: xray-core REALITY caps shortId at 8 bytes / 16 hex chars — entries above 8 are produced but xray will reject them; the response includes a warning when this happens.",
        },
      },
    },
  },
  {
    name: "xray_generate_reality_keypair",
    description:
      "Generate a fresh REALITY X25519 keypair. Returns base64url-encoded " +
      "privateKey + publicKey (43 chars each, no padding) — exactly the format " +
      "produced by the `xray x25519` CLI. Server: paste privateKey into inbound. " +
      "Clients: paste publicKey into outbound.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "xray_validate_sni_target",
    description:
      "Live-check a candidate REALITY target host: confirms TLS 1.3, ALPN h2, " +
      "responds to HEAD /, presents a real cert. The probe runs from the LOCAL " +
      "machine where mcp-xray-pilot lives — verdict reflects YOUR network's view, " +
      "not necessarily a Russian residential. For RU-side checks, run from a РФ IP " +
      "separately.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: 'SNI host, e.g. "www.onet.pl".' },
        port: { type: "number", default: 443, minimum: 1, maximum: 65535 },
        timeout_ms: { type: "number", default: 5000, minimum: 500, maximum: 30000 },
      },
      required: ["host"],
    },
  },
  {
    name: "xray_test_reality_live",
    description:
      "Spin up a real local pair of xray-core processes (server + client) on " +
      "ephemeral ports and run a full REALITY handshake against the target. Returns " +
      "ok=true ONLY if the handshake completed AND the client did NOT receive a real " +
      "certificate AND an HTTPS probe through the cascade returned 2xx/3xx. Strictly " +
      "stronger than xray_validate_sni_target — catches targets that pass TLS 1.3+h2 " +
      "but still break REALITY (e.g. outlook.live.com, www.ozon.ru). Downloads xray " +
      "binary on first call into ~/.cache/mcp-xray-pilot/xray-bin (cached after). " +
      "Verdicts are persisted in data/reality-verdicts.json (LRU 50, TTL 24h, key " +
      "host:port) — set force_refresh=true to bypass. Pass multi_targets[] (1..10) " +
      "instead of target_host to batch a sorted comparison in one call.",
    inputSchema: {
      type: "object",
      properties: {
        target_host: {
          type: "string",
          description:
            'REALITY target/SNI host, e.g. "2gis.ru". Mutually exclusive with multi_targets[].',
        },
        target_port: { type: "number", default: 443, minimum: 1, maximum: 65535 },
        timeout_ms: { type: "number", default: 15000, minimum: 5000, maximum: 60000 },
        keypair: {
          type: "object",
          description: "Optional pre-generated REALITY keypair. If omitted a fresh one is generated.",
          properties: {
            privateKey: { type: "string" },
            publicKey: { type: "string" },
          },
          required: ["privateKey", "publicKey"],
        },
        multi_targets: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description:
            'Batch mode: list of "host" or "host:port" specs (1..10). Run sequentially, ' +
            "each entry uses the disk cache, response is sorted by ok desc, latency_ms asc " +
            "and returned as { results, summary }. Mutually exclusive with target_host.",
        },
        force_refresh: {
          type: "boolean",
          default: false,
          description:
            "If true, ignore the on-disk verdict cache and rerun xray for every target.",
        },
      },
    },
  },
  {
    name: "xray_whitelist_sni_candidates",
    description:
      "Pull a public RU-traffic whitelist (default: hxehex/russia-mobile-internet-whitelist), " +
      "parse out hostnames, and run xray_validate_sni_target on the top N. Returns ranked " +
      "candidates suitable as REALITY SNI fronts on inbound RU-relay nodes. " +
      "Whitelist body is cached on disk in data/whitelist-cache.json (TTL = cache_ttl_hours, " +
      "default 24h). NB: latency_ms is measured from the MCP host (your laptop), NOT from the " +
      "relay node — for geo-relevant probing use xray_test_reality_live from the actual relay " +
      "(or ssh + ping/curl on the node).",
    inputSchema: {
      type: "object",
      properties: {
        whitelist_url: {
          type: "string",
          description:
            "Override the whitelist source URL (raw text format, comma/newline separated). " +
            "Default: hxehex/russia-mobile-internet-whitelist raw.",
        },
        max_candidates: {
          type: "number",
          default: 20,
          minimum: 1,
          maximum: 50,
          description: "How many top-of-list hosts to TLS-validate. Hard cap 50.",
        },
        require_alpn_h2: {
          type: "boolean",
          default: true,
          description: "If true, only ALPN h2 hosts get ok=true (REALITY needs h2 for proper mimicry).",
        },
        require_tls13: {
          type: "boolean",
          default: true,
          description: "If true, only TLS 1.3 hosts get ok=true (REALITY hard-requires 1.3).",
        },
        cache_ttl_hours: {
          type: "number",
          default: 24,
          minimum: 0,
          maximum: 168,
          description: "Whitelist body disk-cache TTL (hours). 0 forces a fresh fetch each call.",
        },
      },
    },
  },
  {
    name: "xray_suggest_sni_for_country",
    description:
      "Suggest curated REALITY SNI/target hosts for an exit-node country. Returns " +
      "popular legitimate sites known to run TLS 1.3 + h2 and not advertise as VPN " +
      "providers — ideal REALITY fronts. Output sorted by suitability, plus a " +
      "worldwide-safe `generic_safe` list. Pair with xray_validate_sni_target for a " +
      "live handshake check before committing to a config.",
    inputSchema: {
      type: "object",
      properties: {
        country_code: {
          type: "string",
          description: 'ISO 3166-1 alpha-2 code, e.g. "PL", "DE", "NL", "FR", "US".',
        },
        max_results: { type: "number", default: 5, minimum: 1, maximum: 20 },
      },
      required: ["country_code"],
    },
  },
  {
    name: "xray_merge_configs",
    description:
      "Merge two or more xray JSON configs. Concatenates inbounds/outbounds/" +
      "routing.rules/dns.servers, auto-renames colliding tags with a -2/-3 suffix " +
      "and warns. Singleton blocks (log, policy, api, …) keep the first occurrence " +
      "and warn on disagreement. Returns merged JSON + list of warnings.",
    inputSchema: {
      type: "object",
      properties: {
        configs: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          description: "Array of xray config JSON strings.",
        },
      },
      required: ["configs"],
    },
  },
] as const;
