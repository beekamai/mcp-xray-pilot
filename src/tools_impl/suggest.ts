/*
 * xray_suggest_alternative — pick a sane protocol+transport+security stack.
 *
 * Goal-driven. Each goal hard-codes the recipe that works in 2025-26 reality.
 * If `current_config` is provided we also flag what's wrong with it.
 */

import { lintConfig } from "../lint.js";

export type Goal =
  | "anti-dpi-russia"
  | "anti-dpi-iran"
  | "anti-dpi-china"
  | "low-latency"
  | "mobile-battery"
  | "high-throughput"
  | "stealth-cdn"
  | "simple-getting-started";

export interface Suggestion {
  goal: Goal;
  recommendation: {
    protocol: string;
    transport: string;
    security: string;
    flow?: string;
    extras: Record<string, string>;
  };
  reasoning: string[];
  warnings: string[];
  current_config_issues?: string[];
}

const RECIPES: Record<Goal, Suggestion["recommendation"] & { reasoning: string[]; warnings: string[] }> = {
  "anti-dpi-russia": {
    protocol: "vless",
    transport: "xhttp",
    security: "reality",
    flow: "",
    extras: {
      "realitySettings.serverNames[0]": "yandex.com (or any RU CDN you actually visit)",
      "realitySettings.shortIds": '["", "abcd"] — empty + one custom for client choice',
      "xhttpSettings.mode": "auto",
      "domainStrategy": "IPIfNonMatch",
    },
    reasoning: [
      "VLESS+REALITY+xhttp survives 2024-2026 RKN/TSPU active probing.",
      "REALITY hides the SNI behind a real Russian-friendly host.",
      "xhttp multiplexing dodges per-connection rate limits.",
    ],
    warnings: [
      "Vision flow does NOT work with xhttp — leave flow empty.",
      "Verify the chosen serverName actually resolves from a Russian residential IP, not just from the VPS.",
    ],
  },
  "anti-dpi-iran": {
    protocol: "vless",
    transport: "ws",
    security: "tls",
    extras: {
      "tlsSettings.serverName": "your real domain (must have a valid Let's Encrypt cert)",
      "wsSettings.path": "/something-not-obvious",
      "wsSettings.host": "match the cert SAN",
    },
    reasoning: [
      "Iran's DPI fingerprints REALITY signatures aggressively in 2025.",
      "Plain TLS+WS behind a CDN-fronted domain remains the safest bet.",
    ],
    warnings: [
      "Avoid Cloudflare for the cert if you also use CF as upstream — circular routing.",
    ],
  },
  "anti-dpi-china": {
    protocol: "vless",
    transport: "xhttp",
    security: "reality",
    extras: {
      "realitySettings.serverNames[0]": "a domain whose IP is allowed in CN",
      "realitySettings.fingerprint": "chrome",
    },
    reasoning: [
      "GFW does not yet (2025) actively probe REALITY when target SNI is a real CN-friendly host.",
      "TLS-1.3 fingerprint must look like a real browser.",
    ],
    warnings: [
      "Test from inside CN — VPS-side traceroute is meaningless.",
    ],
  },
  "low-latency": {
    protocol: "vless",
    transport: "raw",
    security: "reality",
    flow: "xtls-rprx-vision",
    extras: {
      "realitySettings.fingerprint": "chrome",
    },
    reasoning: [
      "raw + vision = zero post-handshake protocol overhead.",
      "Single TCP connection per session, no multiplex re-fragmentation cost.",
    ],
    warnings: [
      "vision flow only works with raw/tcp transport.",
    ],
  },
  "mobile-battery": {
    protocol: "shadowsocks",
    transport: "raw",
    security: "none",
    extras: {
      "method": "2022-blake3-aes-128-gcm",
    },
    reasoning: [
      "Shadowsocks-2022 AEAD is light on CPU — best Wh/MB on Android.",
      "No TLS handshake on every connection.",
    ],
    warnings: [
      "SS-2022 is detectable by sophisticated DPI; use only where DPI is lazy (most non-RU/CN/IR networks).",
    ],
  },
  "high-throughput": {
    protocol: "hysteria2",
    transport: "hysteria",
    security: "tls",
    extras: {
      "bandwidth.up": "200 mbps",
      "bandwidth.down": "1 gbps",
    },
    reasoning: [
      "Hysteria2 over QUIC saturates lossy links faster than TCP-based transports.",
    ],
    warnings: [
      "Battery drain on phones; heavy on the CPU.",
      "UDP often de-prioritised — measure before deploying widely.",
    ],
  },
  "stealth-cdn": {
    protocol: "trojan",
    transport: "ws",
    security: "tls",
    extras: {
      "wsSettings.path": "/api/health",
      "tlsSettings.serverName": "your CDN-fronted domain",
    },
    reasoning: [
      "Trojan over WS+TLS behind a real CDN looks like vanilla HTTPS to inspectors.",
    ],
    warnings: [
      "Some CDNs (CF free tier) throttle WebSocket idle connections.",
    ],
  },
  "simple-getting-started": {
    protocol: "vless",
    transport: "raw",
    security: "tls",
    extras: {
      "tlsSettings.serverName": "your domain (with cert)",
    },
    reasoning: [
      "Simplest stack that still gives you encryption + auth.",
      "Migrate to REALITY/xhttp once you understand the moving parts.",
    ],
    warnings: [],
  },
};

export function suggestAlternative(
  goal: Goal,
  currentConfig?: string,
): Suggestion {
  const r = RECIPES[goal];
  if (!r) {
    throw new Error(
      `unknown goal "${goal}". Known: ${Object.keys(RECIPES).join(", ")}`,
    );
  }
  const result: Suggestion = {
    goal,
    recommendation: {
      protocol: r.protocol,
      transport: r.transport,
      security: r.security,
      flow: r.flow,
      extras: r.extras,
    },
    reasoning: r.reasoning,
    warnings: r.warnings,
  };

  if (currentConfig) {
    try {
      const lr = lintConfig(currentConfig);
      const errs = lr.issues.filter((i) => i.severity === "error");
      result.current_config_issues = errs.map(
        (i) => `[${i.severity}] ${i.id} @ ${i.where ?? "?"}: ${i.message}`,
      );
    } catch (e) {
      result.current_config_issues = [`could not lint current_config: ${(e as Error).message}`];
    }
  }

  return result;
}

export const SUPPORTED_GOALS: Goal[] = Object.keys(RECIPES) as Goal[];
