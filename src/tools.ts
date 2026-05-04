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
      "private LAN block rule, sniffing on 80/443, etc. ~20 rules in v0.6.",
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
      },
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
