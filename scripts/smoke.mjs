#!/usr/bin/env node
/*
 * Smoke test runner — speaks JSON-RPC over stdio with dist/index.js.
 *
 * Usage: node scripts/smoke.mjs
 *
 * Prints: tools count, sample fetch_topic output length, validate result on
 * a known-good and known-bad config, and a couple of new-tool calls.
 */

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
    } catch {
      /* ignore non-JSON */
    }
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

const goodConfig = JSON.stringify({
  log: { loglevel: "warning" },
  inbounds: [
    {
      tag: "in-vless",
      port: 443,
      protocol: "vless",
      settings: {
        clients: [{ id: "5783a3e7-e373-51cd-8642-c83782b807c5", flow: "xtls-rprx-vision" }],
        decryption: "none",
      },
      streamSettings: {
        network: "raw",
        security: "reality",
        realitySettings: {
          target: "www.microsoft.com:443",
          serverNames: ["www.microsoft.com"],
          privateKey: "x".repeat(43),
          publicKey: "y".repeat(43),
          shortIds: ["abcd"],
          fingerprint: "chrome",
        },
      },
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
    },
  ],
  outbounds: [{ tag: "out-direct", protocol: "freedom" }],
});

const badConfig = JSON.stringify({
  inbounds: [
    {
      tag: "x",
      port: 443,
      protocol: "vless",
      settings: { clients: "wat" /* not array */ },
      streamSettings: {
        network: "ws",
        security: "reality" /* incompatible */,
      },
    },
  ],
  outbounds: [],
  routing: { rules: [{ outboundTag: "ghost" }] },
});

(async () => {
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.1" } });
  const tools = await call("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  console.log("TOOLS:", names.length, names.join(", "));

  const fetched = await call("tools/call", { name: "xray_fetch_topic", arguments: { slug: "inbounds/vless", force_offline: true } });
  const md = fetched.result?.content?.[0]?.text ?? "";
  console.log("FETCH inbounds/vless len =", md.length, "first 80:", JSON.stringify(md.slice(0, 80)));

  const v1 = await call("tools/call", { name: "xray_validate_config", arguments: { config: goodConfig } });
  console.log("VALIDATE good:", v1.result?.content?.[0]?.text?.slice(0, 200));

  const v2 = await call("tools/call", { name: "xray_validate_config", arguments: { config: badConfig } });
  console.log("VALIDATE bad:", v2.result?.content?.[0]?.text?.slice(0, 400));

  const l1 = await call("tools/call", { name: "xray_lint", arguments: { config: goodConfig } });
  console.log("LINT good:", l1.result?.content?.[0]?.text?.slice(0, 400));

  /* v0.4+ tools (may not exist yet on early phases — guarded) */
  if (names.includes("xray_geo_search")) {
    const g = await call("tools/call", { name: "xray_geo_search", arguments: { query: "ru" } });
    console.log("GEO_SEARCH ru:", g.result?.content?.[0]?.text?.slice(0, 200));
  }
  if (names.includes("xray_diff_protocols")) {
    const d = await call("tools/call", { name: "xray_diff_protocols", arguments: { a: "vless", b: "vmess" } });
    console.log("DIFF vless/vmess:", d.result?.content?.[0]?.text?.slice(0, 200));
  }
  if (names.includes("xray_suggest_alternative")) {
    const s = await call("tools/call", { name: "xray_suggest_alternative", arguments: { goal: "anti-dpi-russia" } });
    console.log("SUGGEST:", s.result?.content?.[0]?.text?.slice(0, 300));
  }
  if (names.includes("xray_merge_configs")) {
    const m = await call("tools/call", { name: "xray_merge_configs", arguments: { configs: [goodConfig, goodConfig] } });
    console.log("MERGE:", m.result?.content?.[0]?.text?.slice(0, 300));
  }

  /* v0.11+ generators / curators */
  let exitCode = 0;
  if (names.includes("xray_generate_short_ids")) {
    const r = await call("tools/call", { name: "xray_generate_short_ids", arguments: { count: 4 } });
    console.log("SHORT_IDS:", r.result?.content?.[0]?.text?.slice(0, 300));
  }
  if (names.includes("xray_generate_reality_keypair")) {
    const r = await call("tools/call", { name: "xray_generate_reality_keypair", arguments: {} });
    const txt = r.result?.content?.[0]?.text ?? "";
    console.log("KEYPAIR:", txt.slice(0, 400));
    /* Parse + assert: 43-char base64url for both keys + lint must pass. */
    let priv = "", pub = "";
    try {
      const obj = JSON.parse(txt);
      priv = obj.privateKey;
      pub = obj.publicKey;
    } catch (e) { console.error("KEYPAIR parse failed:", e); exitCode = 1; }
    if (priv.length !== 43 || pub.length !== 43) {
      console.error(`KEYPAIR length wrong: priv=${priv.length} pub=${pub.length} (need 43)`);
      exitCode = 1;
    } else {
      console.log("KEYPAIR length OK (43 chars each)");
    }
    /* Plug into a config and lint to confirm reality_pubkey_format passes. */
    const cfgWithGenKeys = JSON.stringify({
      log: { loglevel: "warning" },
      inbounds: [
        {
          tag: "in", port: 443, protocol: "vless",
          settings: { clients: [{ id: "5783a3e7-e373-51cd-8642-c83782b807c5", flow: "xtls-rprx-vision" }], decryption: "none" },
          streamSettings: {
            network: "raw", security: "reality",
            realitySettings: {
              target: "www.onet.pl:443",
              serverNames: ["www.onet.pl"],
              privateKey: priv,
              publicKey: pub,
              shortIds: ["abcd"],
              fingerprint: "chrome",
            },
          },
          sniffing: { enabled: true, destOverride: ["http", "tls"] },
        },
      ],
      outbounds: [{ tag: "out", protocol: "freedom" }],
    });
    const l = await call("tools/call", { name: "xray_lint", arguments: { config: cfgWithGenKeys } });
    const lintTxt = l.result?.content?.[0]?.text ?? "";
    if (/"reality_pubkey_format"/.test(lintTxt) && /"severity":\s*"error"/.test(lintTxt) && /reality_pubkey_format[\s\S]{0,80}error/.test(lintTxt)) {
      console.error("LINT failed: reality_pubkey_format errored on generated keys");
      console.error(lintTxt.slice(0, 800));
      exitCode = 1;
    } else {
      console.log("LINT reality_pubkey_format passes on generated keys");
    }
  }
  if (names.includes("xray_suggest_sni_for_country")) {
    const r = await call("tools/call", { name: "xray_suggest_sni_for_country", arguments: { country_code: "PL" } });
    const txt = r.result?.content?.[0]?.text ?? "";
    console.log("SUGGEST_SNI PL:", txt.slice(0, 400));
    if (!/onet\.pl/.test(txt) || !/allegro\.pl/.test(txt)) {
      console.error("SUGGEST_SNI: missing expected onet.pl / allegro.pl");
      exitCode = 1;
    }
  }
  if (names.includes("xray_geo_search")) {
    const r = await call("tools/call", { name: "xray_geo_search", arguments: { query: "yandex" } });
    const txt = r.result?.content?.[0]?.text ?? "";
    console.log("GEO_SEARCH yandex:", txt.slice(0, 400));
    if (!/geosite:yandex/.test(txt)) {
      console.error("GEO_SEARCH: yandex not found — geocatalogue.json missing or stale");
      exitCode = 1;
    }
  }
  console.log("TOOLS COUNT:", names.length);

  child.stdin.end();
  setTimeout(() => process.exit(exitCode), 200);
})().catch((e) => {
  console.error("smoke failed:", e);
  child.kill();
  process.exit(1);
});
