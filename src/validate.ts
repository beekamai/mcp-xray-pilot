/*
 * Structural validator for xray-core configs.
 *
 * v0.2+ scope:
 *   - JSON parse safety
 *   - Top-level shape: at minimum `inbounds[]` AND `outbounds[]` must exist
 *   - Each inbound/outbound has `tag` and a known `protocol`
 *   - Per-protocol Zod schema for `settings`
 *   - streamSettings.network and matching *Settings block via Zod
 *   - streamSettings.security ("tls" / "reality") *Settings via Zod
 *   - Cross-network and cross-security leftover *Settings warning
 *   - All routing.rules tag references resolve to existing inbound/outbound tags
 *   - Basic type sanity for `port`, `listen`
 */

import type { ZodIssue } from "zod";
import type { ValidationIssue } from "./types.js";
import {
  inboundProtocolSchemas,
  outboundProtocolSchemas,
} from "./schemas/protocols/index.js";
import {
  allSettingsKeys,
  transportByNetwork,
} from "./schemas/transports/index.js";
import {
  allSecuritySettingsKeys,
  securityByName,
} from "./schemas/security/index.js";

const KNOWN_INBOUND_PROTOCOLS = new Set([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "socks",
  "http",
  "wireguard",
  "hysteria2",
  "hysteria",
  "tunnel",
  "dokodemo-door",
  "tun",
]);

const KNOWN_OUTBOUND_PROTOCOLS = new Set([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "socks",
  "http",
  "wireguard",
  "hysteria2",
  "hysteria",
  "freedom",
  "blackhole",
  "loopback",
  "dns",
]);

export interface ValidationReport {
  ok: boolean;
  parsed: unknown | null;
  issues: ValidationIssue[];
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function zodPath(issue: ZodIssue): string {
  if (!issue.path.length) return "";
  return "/" + issue.path.map(String).join("/");
}

function pushZodIssues(
  issues: ValidationIssue[],
  basePath: string,
  zodIssues: readonly ZodIssue[],
  idPrefix: string,
): void {
  for (const z of zodIssues) {
    issues.push({
      id: `${idPrefix}_${z.code}`,
      severity: "error",
      message: z.message,
      where: basePath + zodPath(z),
    });
  }
}

export function validateConfig(jsonText: string): ValidationReport {
  const issues: ValidationIssue[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    issues.push({
      id: "bad_json",
      severity: "error",
      message: `Config is not valid JSON: ${(err as Error).message}`,
    });
    return { ok: false, parsed: null, issues };
  }

  if (!isObject(parsed)) {
    issues.push({
      id: "not_object",
      severity: "error",
      message: "Top-level must be a JSON object.",
      where: "/",
    });
    return { ok: false, parsed, issues };
  }

  const inbounds = parsed["inbounds"];
  const outbounds = parsed["outbounds"];

  if (!Array.isArray(inbounds) || inbounds.length === 0) {
    issues.push({
      id: "missing_inbounds",
      severity: "error",
      message: "Required `inbounds[]` is missing or empty.",
      where: "/inbounds",
    });
  }
  if (!Array.isArray(outbounds) || outbounds.length === 0) {
    issues.push({
      id: "missing_outbounds",
      severity: "error",
      message: "Required `outbounds[]` is missing or empty.",
      where: "/outbounds",
    });
  }

  const inboundTags = new Set<string>();
  if (Array.isArray(inbounds)) {
    inbounds.forEach((ib, i) => validateInbound(ib, i, issues, inboundTags));
  }

  const outboundTags = new Set<string>();
  if (Array.isArray(outbounds)) {
    outbounds.forEach((ob, i) => validateOutbound(ob, i, issues, outboundTags));
  }

  /* routing rules cross-checks */
  const routing = parsed["routing"];
  if (isObject(routing) && Array.isArray(routing["rules"])) {
    (routing["rules"] as unknown[]).forEach((rule, i) => {
      if (!isObject(rule)) return;
      const path = `/routing/rules/${i}`;

      const ot = rule["outboundTag"];
      if (typeof ot === "string" && ot && !outboundTags.has(ot)) {
        issues.push({
          id: "dangling_outbound_tag",
          severity: "error",
          message: `routing.rule references unknown outboundTag "${ot}"`,
          where: `${path}/outboundTag`,
        });
      }

      const its = rule["inboundTag"];
      const itArr = Array.isArray(its) ? (its as unknown[]) : its ? [its] : [];
      itArr.forEach((tag, j) => {
        if (typeof tag === "string" && tag && !inboundTags.has(tag)) {
          issues.push({
            id: "dangling_inbound_tag",
            severity: "error",
            message: `routing.rule references unknown inboundTag "${tag}"`,
            where: `${path}/inboundTag/${j}`,
          });
        }
      });

      if (rule["type"] !== undefined && rule["type"] !== "field") {
        issues.push({
          id: "rule_type_must_be_field",
          severity: "warn",
          message: `routing.rule.type should be "field" (got ${JSON.stringify(rule["type"])})`,
          where: `${path}/type`,
        });
      }

      if (rule["outboundTag"] && rule["balancerTag"]) {
        issues.push({
          id: "rule_outbound_balancer_conflict",
          severity: "error",
          message: "routing.rule has both outboundTag and balancerTag (mutually exclusive).",
          where: path,
        });
      }
    });
  }

  const fatal = issues.some((i) => i.severity === "error");
  return { ok: !fatal, parsed, issues };
}

function validateStreamSettings(
  ss: unknown,
  basePath: string,
  issues: ValidationIssue[],
): void {
  if (!isObject(ss)) return;
  const ssPath = `${basePath}/streamSettings`;

  const network = ss["network"];
  if (network !== undefined && typeof network !== "string") {
    issues.push({
      id: "stream_network_not_string",
      severity: "error",
      message: "streamSettings.network must be a string.",
      where: `${ssPath}/network`,
    });
  } else if (typeof network === "string" && network) {
    const spec = transportByNetwork[network];
    if (!spec) {
      issues.push({
        id: "stream_network_unknown",
        severity: "warn",
        message: `Unknown streamSettings.network "${network}".`,
        where: `${ssPath}/network`,
      });
    } else {
      /* Validate the matching *Settings block. */
      const block = ss[spec.settingsKey];
      if (block !== undefined) {
        const r = spec.schema.safeParse(block);
        if (!r.success) {
          pushZodIssues(
            issues,
            `${ssPath}/${spec.settingsKey}`,
            r.error.issues,
            spec.settingsKey,
          );
        }
      }
      /* Cross-network leftovers: another *Settings present besides current? */
      for (const key of allSettingsKeys) {
        if (key === spec.settingsKey) continue;
        if (ss[key] !== undefined) {
          issues.push({
            id: "stream_settings_cross_network",
            severity: "warn",
            message: `streamSettings.network="${network}" but ${key} is also set — xray will ignore it.`,
            where: `${ssPath}/${key}`,
          });
        }
      }
    }
  }

  const security = ss["security"];
  if (security !== undefined && typeof security !== "string") {
    issues.push({
      id: "stream_security_not_string",
      severity: "error",
      message: "streamSettings.security must be a string.",
      where: `${ssPath}/security`,
    });
  } else if (typeof security === "string" && security && security !== "none") {
    const spec = securityByName[security];
    if (!spec) {
      issues.push({
        id: "stream_security_unknown",
        severity: "warn",
        message: `Unknown streamSettings.security "${security}".`,
        where: `${ssPath}/security`,
      });
    } else {
      const block = ss[spec.settingsKey];
      if (block !== undefined) {
        const r = spec.schema.safeParse(block);
        if (!r.success) {
          pushZodIssues(
            issues,
            `${ssPath}/${spec.settingsKey}`,
            r.error.issues,
            spec.settingsKey,
          );
        }
      }
      for (const key of allSecuritySettingsKeys) {
        if (key === spec.settingsKey) continue;
        if (ss[key] !== undefined) {
          issues.push({
            id: "stream_security_cross",
            severity: "warn",
            message: `streamSettings.security="${security}" but ${key} is also set — xray will ignore it.`,
            where: `${ssPath}/${key}`,
          });
        }
      }
    }
  }
}

function validateInbound(
  ib: unknown,
  i: number,
  issues: ValidationIssue[],
  tags: Set<string>,
): void {
  const path = `/inbounds/${i}`;
  if (!isObject(ib)) {
    issues.push({
      id: "inbound_not_object",
      severity: "error",
      message: "inbound entry must be an object.",
      where: path,
    });
    return;
  }

  const tag = ib["tag"];
  if (typeof tag !== "string" || !tag) {
    issues.push({
      id: "inbound_missing_tag",
      severity: "error",
      message: "inbound is missing required `tag`.",
      where: `${path}/tag`,
    });
  } else {
    if (tags.has(tag)) {
      issues.push({
        id: "duplicate_inbound_tag",
        severity: "error",
        message: `Duplicate inbound tag "${tag}".`,
        where: `${path}/tag`,
      });
    }
    tags.add(tag);
  }

  const proto = ib["protocol"];
  if (typeof proto !== "string" || !proto) {
    issues.push({
      id: "inbound_missing_protocol",
      severity: "error",
      message: "inbound is missing required `protocol`.",
      where: `${path}/protocol`,
    });
  } else if (!KNOWN_INBOUND_PROTOCOLS.has(proto)) {
    issues.push({
      id: "inbound_unknown_protocol",
      severity: "warn",
      message: `Unknown inbound protocol "${proto}". Known: ${[...KNOWN_INBOUND_PROTOCOLS].join(", ")}.`,
      where: `${path}/protocol`,
    });
  }

  const port = ib["port"];
  if (port !== undefined) {
    const okType =
      typeof port === "number" ||
      (typeof port === "string" && /^[0-9,\-]+$/.test(port));
    if (!okType) {
      issues.push({
        id: "inbound_bad_port_type",
        severity: "error",
        message: "inbound.port must be a number, range string, or comma-list.",
        where: `${path}/port`,
      });
    }
  }

  const listen = ib["listen"];
  if (listen !== undefined && typeof listen !== "string") {
    issues.push({
      id: "inbound_bad_listen_type",
      severity: "error",
      message: "inbound.listen must be a string IP/hostname.",
      where: `${path}/listen`,
    });
  }

  /* Per-protocol settings deep validation. */
  if (typeof proto === "string" && proto in inboundProtocolSchemas) {
    const settings = ib["settings"];
    if (settings === undefined) {
      issues.push({
        id: "inbound_missing_settings",
        severity: "warn",
        message: `inbound protocol "${proto}" usually requires settings{}.`,
        where: `${path}/settings`,
      });
    } else {
      const r = inboundProtocolSchemas[proto].safeParse(settings);
      if (!r.success) {
        pushZodIssues(issues, `${path}/settings`, r.error.issues, "inbound_settings");
      }
    }
  }

  /* Stream/transport/security validation. */
  if (ib["streamSettings"] !== undefined) {
    validateStreamSettings(ib["streamSettings"], path, issues);
  }
}

function validateOutbound(
  ob: unknown,
  i: number,
  issues: ValidationIssue[],
  tags: Set<string>,
): void {
  const path = `/outbounds/${i}`;
  if (!isObject(ob)) {
    issues.push({
      id: "outbound_not_object",
      severity: "error",
      message: "outbound entry must be an object.",
      where: path,
    });
    return;
  }

  const tag = ob["tag"];
  if (typeof tag === "string" && tag) {
    if (tags.has(tag)) {
      issues.push({
        id: "duplicate_outbound_tag",
        severity: "error",
        message: `Duplicate outbound tag "${tag}".`,
        where: `${path}/tag`,
      });
    }
    tags.add(tag);
  } else if (i > 0) {
    /* only the first/default outbound can omit tag in xray; warn for clarity. */
    issues.push({
      id: "outbound_missing_tag",
      severity: "warn",
      message: "outbound has no `tag`; routing.rules cannot reference it.",
      where: `${path}/tag`,
    });
  }

  const proto = ob["protocol"];
  if (typeof proto !== "string" || !proto) {
    issues.push({
      id: "outbound_missing_protocol",
      severity: "error",
      message: "outbound is missing required `protocol`.",
      where: `${path}/protocol`,
    });
  } else if (!KNOWN_OUTBOUND_PROTOCOLS.has(proto)) {
    issues.push({
      id: "outbound_unknown_protocol",
      severity: "warn",
      message: `Unknown outbound protocol "${proto}". Known: ${[...KNOWN_OUTBOUND_PROTOCOLS].join(", ")}.`,
      where: `${path}/protocol`,
    });
  }

  if (typeof proto === "string" && proto in outboundProtocolSchemas) {
    const settings = ob["settings"];
    /* Several outbound protocols (freedom, blackhole) don't require settings. */
    if (settings !== undefined) {
      const r = outboundProtocolSchemas[proto].safeParse(settings);
      if (!r.success) {
        pushZodIssues(issues, `${path}/settings`, r.error.issues, "outbound_settings");
      }
    }
  }

  if (ob["streamSettings"] !== undefined) {
    validateStreamSettings(ob["streamSettings"], path, issues);
  }
}
