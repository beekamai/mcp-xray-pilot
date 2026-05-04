#!/usr/bin/env node
/* Targeted smoke for new lint rules. */

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

/* Config that should trigger many new rules at once. */
const dirty = JSON.stringify({
  inbounds: [
    {
      tag: "in-ss-with-reality",
      port: 443,
      protocol: "shadowsocks",
      settings: { method: "aes-128-gcm", password: "x" },
      streamSettings: {
        network: "ws",
        security: "reality" /* SS+REALITY incompatible */,
        realitySettings: {
          target: "no-port",
          serverNames: ["x"],
          privateKey: "too-short",
          publicKey: "also-bad",
          shortIds: ["xyz"] /* not hex, odd */,
          fingerprint: "internet-explorer" /* not in enum */,
        },
        wsSettings: { path: "good" },
      },
    },
    {
      tag: "in-vless-vision-on-ws",
      port: 8443,
      protocol: "vless",
      settings: {
        clients: [
          {
            id: "11111111-2222-3333-4444-555555555555",
            flow: "xtls-rprx-vision" /* needs raw + tls/reality */,
          },
        ],
        decryption: "none",
      },
      streamSettings: { network: "ws", security: "tls", wsSettings: { path: "/x" } },
    },
  ],
  outbounds: [{ tag: "direct", protocol: "freedom" }],
  routing: {
    rules: [
      { type: "field", domain: ["geosite:made-up-thing"], outboundTag: "direct" },
      { type: "field", ip: ["geoip:zz"], outboundTag: "direct" },
    ],
  },
});

(async () => {
  await call("initialize", {});
  const lint = await call("tools/call", { name: "xray_lint", arguments: { config: dirty } });
  const text = lint.result?.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text);
  console.log("rules_run:", parsed.rules_run.length);
  console.log("error_count:", parsed.error_count, "warn_count:", parsed.warn_count, "info_count:", parsed.info_count);
  /* group by rule */
  const byRule = {};
  for (const i of parsed.issues) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
  console.log("issues_by_rule:", JSON.stringify(byRule, null, 2));

  const validate = await call("tools/call", { name: "xray_validate_config", arguments: { config: dirty } });
  const vparsed = JSON.parse(validate.result.content[0].text);
  console.log("validate error_count:", vparsed.error_count, "warn:", vparsed.warn_count);
  for (const i of vparsed.issues.slice(0, 6)) console.log("  -", i.id, "@", i.where, "=>", i.message);

  /* merge with tag collision */
  const m = await call("tools/call", { name: "xray_merge_configs", arguments: { configs: [dirty, dirty] } });
  const mp = JSON.parse(m.result.content[0].text);
  console.log("merge warnings:", mp.warnings.length);
  for (const w of mp.warnings.slice(0, 5)) console.log("  -", w);

  child.stdin.end();
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
