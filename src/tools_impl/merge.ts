/*
 * xray_merge_configs — combine N xray configs into one.
 *
 * Strategy:
 *   - inbounds[]/outbounds[]/routing.rules[]/dns.servers[] are concatenated.
 *   - Tag conflicts are resolved by suffixing "-2", "-3", … on the second-and-later
 *     occurrence; warning emitted.
 *   - Inbound port collisions on the same `listen` (or default 0.0.0.0) → warning.
 *   - Top-level singletons (log, policy, api, stats, transport, fakeDns,
 *     observatory) take the value from the FIRST config that has it; warning
 *     if a later config disagrees.
 *   - routing.balancers[] concatenated, balancer tag conflict same suffixing.
 */

interface MergedRecord {
  [k: string]: unknown;
}

export interface MergeResult {
  merged: string;
  warnings: string[];
}

const SINGLETON_KEYS = [
  "log",
  "policy",
  "api",
  "stats",
  "transport",
  "fakeDns",
  "observatory",
  "metrics",
  "reverse",
  "burstObservatory",
];

interface Tagged {
  tag?: string;
  [k: string]: unknown;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function uniquifyTag(
  base: string,
  used: Set<string>,
  warnings: string[],
  source: string,
): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const next = `${base}-${n}`;
  warnings.push(`tag collision on "${base}" (from ${source}); renamed to "${next}".`);
  used.add(next);
  return next;
}

export function mergeConfigs(jsonStrings: string[]): MergeResult {
  const warnings: string[] = [];
  const out: MergedRecord = {
    inbounds: [],
    outbounds: [],
  };
  const usedInboundTags = new Set<string>();
  const usedOutboundTags = new Set<string>();
  const usedBalancerTags = new Set<string>();
  const portsByListen = new Map<string, Set<number | string>>();
  const routingRules: unknown[] = [];
  const routingBalancers: unknown[] = [];
  let routingMeta: Record<string, unknown> | null = null;
  const dnsServers: unknown[] = [];
  let dnsMeta: Record<string, unknown> | null = null;
  const singletons: Record<string, { source: number; value: unknown }> = {};

  jsonStrings.forEach((raw, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      warnings.push(`config[${idx}] failed to parse, skipped: ${(e as Error).message}`);
      return;
    }
    if (!isObject(parsed)) {
      warnings.push(`config[${idx}] is not an object, skipped.`);
      return;
    }

    const source = `config[${idx}]`;

    /* inbounds */
    const ib = parsed["inbounds"];
    if (Array.isArray(ib)) {
      for (const e of ib) {
        if (!isObject(e)) continue;
        const t = (e as Tagged);
        if (typeof t.tag === "string" && t.tag) {
          t.tag = uniquifyTag(t.tag, usedInboundTags, warnings, source);
        }
        /* port collision */
        const listen = typeof e["listen"] === "string" ? (e["listen"] as string) : "0.0.0.0";
        const port = e["port"];
        if (typeof port === "number" || typeof port === "string") {
          let set = portsByListen.get(listen);
          if (!set) {
            set = new Set();
            portsByListen.set(listen, set);
          }
          if (set.has(port)) {
            warnings.push(`inbound port collision: ${listen}:${port} (from ${source}).`);
          } else {
            set.add(port);
          }
        }
        (out["inbounds"] as unknown[]).push(e);
      }
    }

    /* outbounds */
    const ob = parsed["outbounds"];
    if (Array.isArray(ob)) {
      for (const e of ob) {
        if (!isObject(e)) continue;
        const t = (e as Tagged);
        if (typeof t.tag === "string" && t.tag) {
          t.tag = uniquifyTag(t.tag, usedOutboundTags, warnings, source);
        }
        (out["outbounds"] as unknown[]).push(e);
      }
    }

    /* routing */
    const r = parsed["routing"];
    if (isObject(r)) {
      if (!routingMeta) {
        routingMeta = { ...r };
        delete (routingMeta as Record<string, unknown>)["rules"];
        delete (routingMeta as Record<string, unknown>)["balancers"];
      }
      if (Array.isArray(r["rules"])) routingRules.push(...(r["rules"] as unknown[]));
      if (Array.isArray(r["balancers"])) {
        for (const b of r["balancers"] as unknown[]) {
          if (!isObject(b)) continue;
          const t = b as Tagged;
          if (typeof t.tag === "string" && t.tag) {
            t.tag = uniquifyTag(t.tag, usedBalancerTags, warnings, source);
          }
          routingBalancers.push(b);
        }
      }
    }

    /* dns */
    const d = parsed["dns"];
    if (isObject(d)) {
      if (!dnsMeta) {
        dnsMeta = { ...d };
        delete (dnsMeta as Record<string, unknown>)["servers"];
      }
      if (Array.isArray(d["servers"])) dnsServers.push(...(d["servers"] as unknown[]));
    }

    /* singletons */
    for (const key of SINGLETON_KEYS) {
      if (parsed[key] === undefined) continue;
      if (singletons[key] === undefined) {
        singletons[key] = { source: idx, value: parsed[key] };
      } else if (JSON.stringify(singletons[key].value) !== JSON.stringify(parsed[key])) {
        warnings.push(
          `singleton "${key}" differs between config[${singletons[key].source}] and config[${idx}]; kept the first.`,
        );
      }
    }
  });

  /* compose final */
  for (const key of SINGLETON_KEYS) {
    if (singletons[key] !== undefined) out[key] = singletons[key].value;
  }
  if (routingRules.length > 0 || routingBalancers.length > 0 || routingMeta) {
    out["routing"] = {
      ...(routingMeta ?? {}),
      rules: routingRules,
      ...(routingBalancers.length ? { balancers: routingBalancers } : {}),
    };
  }
  if (dnsServers.length > 0 || dnsMeta) {
    out["dns"] = {
      ...(dnsMeta ?? {}),
      servers: dnsServers,
    };
  }

  return {
    merged: JSON.stringify(out, null, 2),
    warnings,
  };
}
