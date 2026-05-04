/*
 * Best-practice lint rules for xray configs.
 *
 * Each rule is a pure function (config) => LintIssue[]. They run on the
 * *parsed* JSON; if parsing failed the dispatcher in handlers.ts short-
 * circuits with the parse error from validate.ts and never calls these.
 *
 * Rule families (v0.6):
 *   v0.1 base — vless decryption, REALITY shortIds/target, dns/dangling tags,
 *               geosite/geoip + domainStrategy, xhttp path, geoip:private
 *               block, sniffing on 80/443.
 *   v0.4 sec  — REALITY pubkey base64url-43, REALITY shortId hex 0..16,
 *               REALITY target host:port grammar, XTLS vision flow needs
 *               raw + tls/reality, TLS fingerprint enum, ALPN h2/h3 collision.
 *   v0.5 geo  — unknown geosite/geoip catalogue tag.
 *   v0.6 mtx  — protocol+security/transport/flow incompatibility.
 */

import type { LintIssue, LintRule } from "./types.js";
import { tlsFingerprints, alpnValues } from "./schemas/security/index.js";
import { isKnownGeoTag } from "./data/geocatalogue.js";
import {
  checkFlow,
  isProtocolSecuritySupported,
  isProtocolTransportSupported,
} from "./data/compatibility.js";

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function getInbounds(c: unknown): Record<string, unknown>[] {
  if (!isObject(c) || !Array.isArray(c["inbounds"])) return [];
  return (c["inbounds"] as unknown[]).filter(isObject) as Record<string, unknown>[];
}

function getOutbounds(c: unknown): Record<string, unknown>[] {
  if (!isObject(c) || !Array.isArray(c["outbounds"])) return [];
  return (c["outbounds"] as unknown[]).filter(isObject) as Record<string, unknown>[];
}

function getRoutingRules(c: unknown): Record<string, unknown>[] {
  if (!isObject(c)) return [];
  const r = c["routing"];
  if (!isObject(r) || !Array.isArray(r["rules"])) return [];
  return (r["rules"] as unknown[]).filter(isObject) as Record<string, unknown>[];
}

function inboundsAndOutbounds(c: unknown): {
  node: Record<string, unknown>;
  where: string;
}[] {
  const out: { node: Record<string, unknown>; where: string }[] = [];
  getInbounds(c).forEach((n, i) => out.push({ node: n, where: `/inbounds/${i}` }));
  getOutbounds(c).forEach((n, i) => out.push({ node: n, where: `/outbounds/${i}` }));
  return out;
}

const RULES: { id: string; fn: LintRule }[] = [
  /* ---------- v0.1 base rules ---------- */
  {
    id: "vless_decryption_none",
    fn: (c) => {
      const out: LintIssue[] = [];
      getInbounds(c).forEach((ib, i) => {
        if (ib["protocol"] !== "vless") return;
        const settings = ib["settings"];
        if (!isObject(settings)) return;
        if (settings["decryption"] !== "none") {
          out.push({
            rule: "vless_decryption_none",
            id: "vless_decryption_none",
            severity: "warn",
            message:
              'VLESS inbound must have settings.decryption = "none" (xray will refuse to start otherwise).',
            where: `/inbounds/${i}/settings/decryption`,
          });
        }
      });
      return out;
    },
  },
  {
    id: "reality_short_id_present",
    fn: (c) => {
      const out: LintIssue[] = [];
      getInbounds(c).forEach((ib, i) => {
        const ss = ib["streamSettings"];
        if (!isObject(ss)) return;
        if (ss["security"] !== "reality") return;
        const reality = ss["realitySettings"];
        if (!isObject(reality)) return;
        const sids = reality["shortIds"];
        if (!Array.isArray(sids) || sids.length === 0) return;
        const hasOnlyEmpty = sids.every((x) => x === "");
        if (hasOnlyEmpty) {
          out.push({
            rule: "reality_short_id_present",
            id: "reality_short_id_present",
            severity: "warn",
            message:
              "REALITY shortIds contains only empty string. A non-empty shortId is harder for DPI to fingerprint.",
            where: `/inbounds/${i}/streamSettings/realitySettings/shortIds`,
          });
        }
      });
      return out;
    },
  },
  {
    id: "reality_target_resolves",
    fn: (c) => {
      const out: LintIssue[] = [];
      const re = /^[A-Za-z0-9.\-_]+:\d{1,5}$/;
      getInbounds(c).forEach((ib, i) => {
        const ss = ib["streamSettings"];
        if (!isObject(ss) || ss["security"] !== "reality") return;
        const reality = ss["realitySettings"];
        if (!isObject(reality)) return;
        const target = reality["target"] ?? reality["dest"];
        if (typeof target !== "string" || !re.test(target)) {
          out.push({
            rule: "reality_target_resolves",
            id: "reality_target_resolves",
            severity: "warn",
            message: `REALITY target/dest "${String(target)}" doesn't look like host:port (e.g. "www.microsoft.com:443").`,
            where: `/inbounds/${i}/streamSettings/realitySettings/target`,
          });
        }
      });
      return out;
    },
  },
  {
    id: "dns_block_missing",
    fn: (c) => {
      const out: LintIssue[] = [];
      const rules = getRoutingRules(c);
      const referencesDnsOutbound = rules.some(
        (r) => r["outboundTag"] === "dns-out" || r["outboundTag"] === "dns",
      );
      if (!referencesDnsOutbound) return out;
      const dns = isObject(c) ? c["dns"] : undefined;
      const servers = isObject(dns) ? dns["servers"] : undefined;
      if (!Array.isArray(servers) || servers.length === 0) {
        out.push({
          rule: "dns_block_missing",
          id: "dns_block_missing",
          severity: "warn",
          message:
            "routing rules reference a DNS outbound, but dns.servers is empty or missing.",
          where: "/dns/servers",
        });
      }
      return out;
    },
  },
  {
    id: "routing_dangling_outbound",
    fn: (c) => {
      const out: LintIssue[] = [];
      const tags = new Set(
        getOutbounds(c)
          .map((o) => o["tag"])
          .filter((t): t is string => typeof t === "string" && !!t),
      );
      getRoutingRules(c).forEach((r, i) => {
        const ot = r["outboundTag"];
        if (typeof ot === "string" && ot && !tags.has(ot)) {
          out.push({
            rule: "routing_dangling_outbound",
            id: "routing_dangling_outbound",
            severity: "error",
            message: `routing.rules[${i}].outboundTag "${ot}" doesn't exist in outbounds[].`,
            where: `/routing/rules/${i}/outboundTag`,
          });
        }
      });
      return out;
    },
  },
  {
    id: "routing_dangling_inbound",
    fn: (c) => {
      const out: LintIssue[] = [];
      const tags = new Set(
        getInbounds(c)
          .map((o) => o["tag"])
          .filter((t): t is string => typeof t === "string" && !!t),
      );
      getRoutingRules(c).forEach((r, i) => {
        const its = r["inboundTag"];
        const arr = Array.isArray(its) ? (its as unknown[]) : its ? [its] : [];
        arr.forEach((tag, j) => {
          if (typeof tag === "string" && tag && !tags.has(tag)) {
            out.push({
              rule: "routing_dangling_inbound",
              id: "routing_dangling_inbound",
              severity: "error",
              message: `routing.rules[${i}].inboundTag[${j}] "${tag}" doesn't exist in inbounds[].`,
              where: `/routing/rules/${i}/inboundTag/${j}`,
            });
          }
        });
      });
      return out;
    },
  },
  {
    id: "geosite_geoip_used_without_strategy",
    fn: (c) => {
      const out: LintIssue[] = [];
      if (!isObject(c)) return out;
      const routing = c["routing"];
      if (!isObject(routing)) return out;
      const strat = routing["domainStrategy"];
      if (strat && strat !== "AsIs") return out;
      const usesGeoIp = getRoutingRules(c).some((r) => {
        const ip = r["ip"];
        return Array.isArray(ip) && ip.some((x) => typeof x === "string" && x.startsWith("geoip:"));
      });
      const usesGeoSite = getRoutingRules(c).some((r) => {
        const d = r["domain"];
        return Array.isArray(d) && d.some((x) => typeof x === "string" && x.startsWith("geosite:"));
      });
      if (usesGeoIp && (!strat || strat === "AsIs")) {
        out.push({
          rule: "geosite_geoip_used_without_strategy",
          id: "geosite_geoip_used_without_strategy",
          severity: "info",
          message:
            "geoip:* used in rules but routing.domainStrategy is AsIs. Consider IPIfNonMatch so domain rules can fall back to IP lookup.",
          where: "/routing/domainStrategy",
        });
      }
      if (usesGeoSite && !strat) {
        out.push({
          rule: "geosite_geoip_used_without_strategy",
          id: "geosite_geoip_used_without_strategy",
          severity: "info",
          message:
            "geosite:* used in rules but routing.domainStrategy is unset (defaults to AsIs).",
          where: "/routing/domainStrategy",
        });
      }
      return out;
    },
  },
  {
    id: "xhttp_path_leading_slash",
    fn: (c) => {
      const out: LintIssue[] = [];
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss)) return;
        const xs = ss["xhttpSettings"];
        if (!isObject(xs)) return;
        const path = xs["path"];
        if (typeof path === "string" && path && !path.startsWith("/")) {
          out.push({
            rule: "xhttp_path_leading_slash",
            id: "xhttp_path_leading_slash",
            severity: "warn",
            message: `xhttpSettings.path "${path}" should start with "/".`,
            where: `${where}/streamSettings/xhttpSettings/path`,
          });
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "private_geoip_blocked",
    fn: (c) => {
      const out: LintIssue[] = [];
      const rules = getRoutingRules(c);
      const blocks = rules.some((r) => {
        const ip = r["ip"];
        const ot = r["outboundTag"];
        if (typeof ot !== "string") return false;
        const isBlock = /block|blackhole/i.test(ot);
        if (!isBlock) return false;
        return Array.isArray(ip) && ip.some((x) => typeof x === "string" && x.includes("geoip:private"));
      });
      if (!blocks) {
        out.push({
          rule: "private_geoip_blocked",
          id: "private_geoip_blocked",
          severity: "warn",
          message:
            "No routing rule blocks geoip:private. Without it the VPN can be used to scan the server's LAN — usually undesirable.",
          where: "/routing/rules",
        });
      }
      return out;
    },
  },
  {
    id: "sniffing_enabled_recommended",
    fn: (c) => {
      const out: LintIssue[] = [];
      getInbounds(c).forEach((ib, i) => {
        const port = ib["port"];
        const portMatches =
          port === 443 || port === 80 || port === "443" || port === "80";
        if (!portMatches) return;
        const sniffing = ib["sniffing"];
        if (!isObject(sniffing) || sniffing["enabled"] !== true) {
          out.push({
            rule: "sniffing_enabled_recommended",
            id: "sniffing_enabled_recommended",
            severity: "info",
            message:
              "sniffing.enabled=true is recommended for inbounds on 80/443 — required for routing by domain/protocol.",
            where: `/inbounds/${i}/sniffing`,
          });
        }
      });
      return out;
    },
  },

  /* ---------- v0.4 REALITY/XTLS deep ---------- */
  {
    id: "reality_pubkey_format",
    fn: (c) => {
      const out: LintIssue[] = [];
      const re = /^[A-Za-z0-9_-]{43}$/;
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss) || ss["security"] !== "reality") return;
        const reality = ss["realitySettings"];
        if (!isObject(reality)) return;
        for (const key of ["privateKey", "publicKey"] as const) {
          const k = reality[key];
          if (k !== undefined && (typeof k !== "string" || !re.test(k))) {
            out.push({
              rule: "reality_pubkey_format",
              id: "reality_pubkey_format",
              severity: "error",
              message: `REALITY ${key} must be 43 base64url chars (no padding). Got: "${String(k).slice(0, 20)}…" (${typeof k === "string" ? k.length : "non-string"} chars).`,
              where: `${where}/streamSettings/realitySettings/${key}`,
            });
          }
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "reality_shortid_format",
    fn: (c) => {
      const out: LintIssue[] = [];
      const re = /^([0-9a-fA-F]{2}){0,8}$/;
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss) || ss["security"] !== "reality") return;
        const reality = ss["realitySettings"];
        if (!isObject(reality)) return;
        const sids = reality["shortIds"];
        if (!Array.isArray(sids)) return;
        sids.forEach((s, j) => {
          if (typeof s !== "string" || !re.test(s)) {
            out.push({
              rule: "reality_shortid_format",
              id: "reality_shortid_format",
              severity: "error",
              message: `REALITY shortIds[${j}] must be hex with even length 0..16. Got: ${JSON.stringify(s)}.`,
              where: `${where}/streamSettings/realitySettings/shortIds/${j}`,
            });
          }
        });
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "reality_target_format",
    fn: (c) => {
      const out: LintIssue[] = [];
      const re = /^[A-Za-z0-9.\-_]+:\d{1,5}$/;
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss) || ss["security"] !== "reality") return;
        const reality = ss["realitySettings"];
        if (!isObject(reality)) return;
        const t = reality["target"] ?? reality["dest"];
        if (t === undefined) return;
        if (typeof t !== "string" || !re.test(t)) {
          out.push({
            rule: "reality_target_format",
            id: "reality_target_format",
            severity: "error",
            message: `REALITY target/dest must match host:port grammar. Got: ${JSON.stringify(t)}.`,
            where: `${where}/streamSettings/realitySettings/target`,
          });
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "xtls_flow_requires_vision",
    fn: (c) => {
      const out: LintIssue[] = [];
      /* Vision flow only works with raw/tcp transport + tls/reality security.
       * Walk each VLESS client/user; if flow=xtls-rprx-vision* then verify. */
      const visit = (
        node: Record<string, unknown>,
        users: unknown,
        where: string,
      ): void => {
        if (!Array.isArray(users)) return;
        const ss = node["streamSettings"];
        const network = isObject(ss) ? ss["network"] : undefined;
        const security = isObject(ss) ? ss["security"] : undefined;
        users.forEach((u, j) => {
          if (!isObject(u)) return;
          const flow = u["flow"];
          if (typeof flow !== "string" || !flow.startsWith("xtls-rprx-vision")) return;
          const goodTransport = network === "raw" || network === "tcp" || network === undefined;
          const goodSecurity = security === "tls" || security === "reality";
          if (!goodTransport || !goodSecurity) {
            out.push({
              rule: "xtls_flow_requires_vision",
              id: "xtls_flow_requires_vision",
              severity: "error",
              message: `flow="${flow}" requires transport=raw/tcp + security=tls/reality (got network=${String(network)}, security=${String(security)}).`,
              where: `${where}/${j}/flow`,
            });
          }
        });
      };
      getInbounds(c).forEach((ib, i) => {
        if (ib["protocol"] !== "vless") return;
        const settings = ib["settings"];
        if (!isObject(settings)) return;
        visit(ib, settings["clients"], `/inbounds/${i}/settings/clients`);
      });
      getOutbounds(c).forEach((ob, i) => {
        if (ob["protocol"] !== "vless") return;
        const settings = ob["settings"];
        if (!isObject(settings)) return;
        const vnext = settings["vnext"];
        if (Array.isArray(vnext)) {
          vnext.forEach((srv, k) => {
            if (!isObject(srv)) return;
            visit(ob, srv["users"], `/outbounds/${i}/settings/vnext/${k}/users`);
          });
        }
      });
      return out;
    },
  },
  {
    id: "tls_fingerprint_enum",
    fn: (c) => {
      const out: LintIssue[] = [];
      const allowed = new Set<string>(tlsFingerprints);
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss)) return;
        for (const key of ["tlsSettings", "realitySettings"] as const) {
          const sec = ss[key];
          if (!isObject(sec)) continue;
          const fp = sec["fingerprint"];
          if (fp !== undefined && (typeof fp !== "string" || !allowed.has(fp))) {
            out.push({
              rule: "tls_fingerprint_enum",
              id: "tls_fingerprint_enum",
              severity: "warn",
              message: `${key}.fingerprint "${String(fp)}" not in known set: ${[...allowed].join(", ")}.`,
              where: `${where}/streamSettings/${key}/fingerprint`,
            });
          }
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "tls_alpn_collision",
    fn: (c) => {
      const out: LintIssue[] = [];
      const allowed = new Set<string>(alpnValues);
      const check = (node: Record<string, unknown>, where: string): void => {
        const ss = node["streamSettings"];
        if (!isObject(ss)) return;
        const tls = ss["tlsSettings"];
        if (!isObject(tls)) return;
        const alpn = tls["alpn"];
        if (!Array.isArray(alpn)) return;
        const network = ss["network"];
        const hasH2 = alpn.includes("h2");
        const hasH3 = alpn.includes("h3");
        const hasH1 = alpn.includes("http/1.1");
        for (const a of alpn) {
          if (typeof a === "string" && !allowed.has(a)) {
            out.push({
              rule: "tls_alpn_collision",
              id: "tls_alpn_collision",
              severity: "warn",
              message: `tlsSettings.alpn contains unknown value "${a}". Known: ${[...allowed].join(", ")}.`,
              where: `${where}/streamSettings/tlsSettings/alpn`,
            });
          }
        }
        if (network === "xhttp" && !hasH2 && !hasH3) {
          out.push({
            rule: "tls_alpn_collision",
            id: "tls_alpn_collision",
            severity: "info",
            message: 'xhttp transport usually negotiates h2/h3; consider declaring alpn: ["h2"] explicitly.',
            where: `${where}/streamSettings/tlsSettings/alpn`,
          });
        }
        if (hasH1 && hasH2 && network === "grpc") {
          out.push({
            rule: "tls_alpn_collision",
            id: "tls_alpn_collision",
            severity: "info",
            message: "grpc requires h2; including http/1.1 in alpn lets clients fall back and break.",
            where: `${where}/streamSettings/tlsSettings/alpn`,
          });
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },

  /* ---------- v0.5 geo catalogue ---------- */
  {
    id: "geo_unknown_category",
    fn: (c) => {
      const out: LintIssue[] = [];
      getRoutingRules(c).forEach((r, i) => {
        const visit = (arr: unknown, field: string): void => {
          if (!Array.isArray(arr)) return;
          arr.forEach((tag, j) => {
            if (typeof tag !== "string") return;
            if (!tag.startsWith("geosite:") && !tag.startsWith("geoip:")) return;
            if (!isKnownGeoTag(tag)) {
              out.push({
                rule: "geo_unknown_category",
                id: "geo_unknown_category",
                severity: "warn",
                message: `Unknown ${tag.split(":")[0]} category "${tag}". Use xray_geo_search to find the correct tag.`,
                where: `/routing/rules/${i}/${field}/${j}`,
              });
            }
          });
        };
        visit(r["domain"], "domain");
        visit(r["ip"], "ip");
      });
      return out;
    },
  },

  /* ---------- v0.6 compatibility matrix ---------- */
  {
    id: "incompatible_protocol_security",
    fn: (c) => {
      const out: LintIssue[] = [];
      const check = (node: Record<string, unknown>, where: string): void => {
        const proto = node["protocol"];
        if (typeof proto !== "string") return;
        const ss = node["streamSettings"];
        if (!isObject(ss)) return;
        const security = ss["security"];
        if (typeof security !== "string" || !security) return;
        const r = isProtocolSecuritySupported(proto, security);
        if (!r.ok) {
          out.push({
            rule: "incompatible_protocol_security",
            id: "incompatible_protocol_security",
            severity: "error",
            message: r.reason ?? "incompatible protocol+security",
            where: `${where}/streamSettings/security`,
          });
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "incompatible_protocol_transport",
    fn: (c) => {
      const out: LintIssue[] = [];
      const check = (node: Record<string, unknown>, where: string): void => {
        const proto = node["protocol"];
        if (typeof proto !== "string") return;
        const ss = node["streamSettings"];
        if (!isObject(ss)) return;
        const network = ss["network"];
        if (typeof network !== "string" || !network) return;
        const r = isProtocolTransportSupported(proto, network);
        if (!r.ok) {
          out.push({
            rule: "incompatible_protocol_transport",
            id: "incompatible_protocol_transport",
            severity: "error",
            message: r.reason ?? "incompatible protocol+transport",
            where: `${where}/streamSettings/network`,
          });
        }
      };
      getInbounds(c).forEach((ib, i) => check(ib, `/inbounds/${i}`));
      getOutbounds(c).forEach((ob, i) => check(ob, `/outbounds/${i}`));
      return out;
    },
  },
  {
    id: "flow_requires_specific_transport",
    fn: (c) => {
      const out: LintIssue[] = [];
      const visit = (
        node: Record<string, unknown>,
        users: unknown,
        where: string,
      ): void => {
        if (!Array.isArray(users)) return;
        const proto = node["protocol"];
        if (typeof proto !== "string") return;
        const ss = node["streamSettings"];
        const network = isObject(ss) && typeof ss["network"] === "string" ? (ss["network"] as string) : "";
        const security =
          isObject(ss) && typeof ss["security"] === "string" ? (ss["security"] as string) : "none";
        users.forEach((u, j) => {
          if (!isObject(u)) return;
          const flow = u["flow"];
          if (typeof flow !== "string" || !flow) return;
          const r = checkFlow(proto, flow, network, security);
          if (!r.ok) {
            out.push({
              rule: "flow_requires_specific_transport",
              id: "flow_requires_specific_transport",
              severity: "error",
              message: r.reason ?? "flow requires a specific transport+security",
              where: `${where}/${j}/flow`,
            });
          }
        });
      };
      getInbounds(c).forEach((ib, i) => {
        const settings = ib["settings"];
        if (!isObject(settings)) return;
        visit(ib, settings["clients"], `/inbounds/${i}/settings/clients`);
      });
      getOutbounds(c).forEach((ob, i) => {
        const settings = ob["settings"];
        if (!isObject(settings)) return;
        const vnext = settings["vnext"];
        if (Array.isArray(vnext)) {
          vnext.forEach((srv, k) => {
            if (!isObject(srv)) return;
            visit(ob, srv["users"], `/outbounds/${i}/settings/vnext/${k}/users`);
          });
        }
      });
      return out;
    },
  },
];

export interface LintReport {
  ok: boolean;
  issues: LintIssue[];
  ranRules: string[];
}

export function lintConfig(jsonText: string): LintReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      ranRules: [],
      issues: [
        {
          rule: "_parse",
          id: "bad_json",
          severity: "error",
          message: `Config is not valid JSON: ${(err as Error).message}`,
        },
      ],
    };
  }

  const issues: LintIssue[] = [];
  const ranRules: string[] = [];
  for (const r of RULES) {
    ranRules.push(r.id);
    try {
      issues.push(...r.fn(parsed));
    } catch (err) {
      issues.push({
        rule: r.id,
        id: "rule_threw",
        severity: "warn",
        message: `Lint rule "${r.id}" threw: ${(err as Error).message}`,
      });
    }
  }
  return {
    ok: !issues.some((i) => i.severity === "error"),
    issues,
    ranRules,
  };
}
