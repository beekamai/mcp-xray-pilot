#!/usr/bin/env node
/* v0.12 smoke: dns_through_proxy_leaks_to_blocked_outbound +
 * geosite_not_in_xray_release. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, "..", "dist", "index.js");
const child = spawn("node", [ENTRY], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  const req = { jsonrpc: "2.0", id, method, params: params ?? {} };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

/* Case 1: DNS-leak — has proxy outbound, has DNS IPs, NO direct/53 rule. */
const dnsLeak = JSON.stringify({
  dns: { servers: ["1.1.1.1", "8.8.8.8", "https://1.0.0.1/dns-query"] },
  outbounds: [
    {
      tag: "proxy",
      protocol: "vless",
      settings: { vnext: [{ address: "x", port: 443, users: [{ id: "5783a3e7-e373-51cd-8642-c83782b807c5" }] }] },
    },
    { tag: "direct", protocol: "freedom" },
  ],
  routing: {
    rules: [{ type: "field", outboundTag: "direct", domain: ["regexp:.*\\.ru$"] }],
  },
});

/* Case 2: DNS-leak FIXED — has direct rule for DNS-IPs */
const dnsFixed = JSON.stringify({
  dns: { servers: ["1.1.1.1", "8.8.8.8"] },
  outbounds: [
    {
      tag: "proxy",
      protocol: "vless",
      settings: { vnext: [{ address: "x", port: 443, users: [{ id: "5783a3e7-e373-51cd-8642-c83782b807c5" }] }] },
    },
    { tag: "direct", protocol: "freedom" },
  ],
  routing: {
    rules: [
      { type: "field", outboundTag: "direct", port: "53" },
      { type: "field", outboundTag: "direct", domain: ["regexp:.*\\.ru$"] },
    ],
  },
});

/* Case 3: server-side config (only freedom outbound) — should NOT trigger */
const serverSide = JSON.stringify({
  dns: { servers: ["1.1.1.1"] },
  inbounds: [{ tag: "in", port: 443, protocol: "vless", settings: { decryption: "none", clients: [] } }],
  outbounds: [{ tag: "direct", protocol: "freedom" }],
});

/* Case 4: geosite_not_in_xray_release */
const geoBad = JSON.stringify({
  outbounds: [{ tag: "direct", protocol: "freedom" }],
  routing: {
    rules: [
      { type: "field", outboundTag: "direct", domain: ["geosite:geolocation-ru"] },
      { type: "field", outboundTag: "direct", domain: ["geosite:category-ru"] /* OK */ },
    ],
  },
});

(async () => {
  await call("initialize", {});

  let exitCode = 0;
  const fail = (m) => { console.error("FAIL:", m); exitCode = 1; };

  async function lint(label, cfg) {
    const r = await call("tools/call", { name: "xray_lint", arguments: { config: cfg } });
    const txt = r.result?.content?.[0]?.text ?? "";
    const parsed = JSON.parse(txt);
    const byRule = {};
    for (const i of parsed.issues) (byRule[i.rule] ??= []).push(i.severity);
    console.log(`\n[${label}] rules_run=${parsed.rules_run.length} err=${parsed.error_count} warn=${parsed.warn_count}`);
    console.log("  rules_run includes new:",
      parsed.rules_run.includes("dns_through_proxy_leaks_to_blocked_outbound"),
      parsed.rules_run.includes("geosite_not_in_xray_release"));
    for (const [k, v] of Object.entries(byRule)) console.log(`  - ${k}: [${v.join(",")}]`);
    return { parsed, byRule };
  }

  const c1 = await lint("dns_leak (broken)", dnsLeak);
  if (!c1.byRule["dns_through_proxy_leaks_to_blocked_outbound"]?.includes("error"))
    fail("dns_leak case did NOT trigger error-level dns_through_proxy_leaks_to_blocked_outbound");
  else console.log("OK dns_leak triggered");

  const c2 = await lint("dns_fixed", dnsFixed);
  if (c2.byRule["dns_through_proxy_leaks_to_blocked_outbound"])
    fail("dns_fixed case incorrectly triggered the rule");
  else console.log("OK dns_fixed did not trigger");

  const c3 = await lint("server_side", serverSide);
  if (c3.byRule["dns_through_proxy_leaks_to_blocked_outbound"])
    fail("server_side case incorrectly triggered the rule (no proxy outbound)");
  else console.log("OK server_side skipped");

  const c4 = await lint("geosite_release", geoBad);
  const geoIssues = c4.parsed.issues.filter((i) => i.rule === "geosite_not_in_xray_release");
  if (geoIssues.length === 0) fail("geosite:geolocation-ru did NOT trigger geosite_not_in_xray_release");
  else if (geoIssues.length > 1) fail(`expected 1 hit, got ${geoIssues.length}`);
  else console.log("OK geosite_not_in_xray_release triggered exactly once:", geoIssues[0].message.slice(0, 100));

  /* xray_geo_search must expose new flags */
  const gs = await call("tools/call", { name: "xray_geo_search", arguments: { query: "category-ru" } });
  const gsTxt = gs.result?.content?.[0]?.text ?? "";
  if (!/in_v2fly_source/.test(gsTxt) || !/in_xray_release/.test(gsTxt))
    fail("xray_geo_search response missing in_v2fly_source / in_xray_release fields");
  else console.log("OK xray_geo_search exposes new flags");

  child.stdin.end();
  setTimeout(() => process.exit(exitCode), 200);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
