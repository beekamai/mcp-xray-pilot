/*
 * Protocol × transport × security compatibility matrix.
 *
 * Hand-curated from XTLS docs + battle-tested config recipes (Hiddify, v2rayN,
 * Remnawave). Used by lint to flag impossible combos and by suggest tools to
 * pick a sane next step.
 *
 * Conservative: only mark combos as "supported" if there's a documented or
 * widely-deployed example. Unknown combos = warn, not error.
 */

export type Transport =
  | "raw"
  | "tcp"
  | "xhttp"
  | "splithttp"
  | "grpc"
  | "ws"
  | "websocket"
  | "kcp"
  | "mkcp"
  | "httpupgrade"
  | "hysteria";

export type Security = "none" | "tls" | "reality";

export interface FlowRequirement {
  transport: Transport[];
  security: Security[];
}

export interface ProtocolMatrix {
  transports: Transport[];
  security: Security[];
  /* Flow values supported by this protocol's clients/users.
   * Map: flow value → required transport+security combos. */
  flows?: Record<string, FlowRequirement>;
  notes?: string;
}

export const matrix: Record<string, ProtocolMatrix> = {
  vless: {
    transports: ["raw", "tcp", "xhttp", "splithttp", "grpc", "ws", "websocket", "httpupgrade", "kcp", "mkcp"],
    security: ["none", "tls", "reality"],
    flows: {
      "xtls-rprx-vision": { transport: ["raw", "tcp"], security: ["tls", "reality"] },
      "xtls-rprx-vision-udp443": { transport: ["raw", "tcp"], security: ["tls", "reality"] },
    },
    notes: "VLESS is the most permissive — supports REALITY, vision flow, all transports.",
  },
  vmess: {
    transports: ["raw", "tcp", "xhttp", "grpc", "ws", "websocket", "httpupgrade", "kcp", "mkcp"],
    security: ["none", "tls"],
    notes: "VMess does NOT support REALITY (no protocol header to hide).",
  },
  trojan: {
    transports: ["raw", "tcp", "xhttp", "grpc", "ws", "websocket", "httpupgrade"],
    security: ["tls"],
    notes: "Trojan requires TLS. REALITY is unsupported on inbound.",
  },
  shadowsocks: {
    transports: ["raw", "tcp", "ws", "websocket", "grpc", "kcp", "mkcp", "httpupgrade"],
    security: ["none"],
    notes: "Shadowsocks ciphers are self-encrypting. REALITY/TLS not supported.",
  },
  socks: {
    transports: ["raw", "tcp"],
    security: ["none", "tls"],
    notes: "SOCKS over TLS (stunnel-style) is supported but rare.",
  },
  http: {
    transports: ["raw", "tcp"],
    security: ["none", "tls"],
  },
  wireguard: {
    transports: ["raw"],
    security: ["none"],
    notes: "WireGuard is its own transport over UDP; xray exposes it as a protocol.",
  },
  hysteria: {
    transports: ["hysteria"],
    security: ["tls"],
    notes: "Hysteria(2) brings its own QUIC-based transport.",
  },
  hysteria2: {
    transports: ["hysteria"],
    security: ["tls"],
  },
};

export interface CompatCheck {
  ok: boolean;
  reason?: string;
}

export function isProtocolSecuritySupported(
  protocol: string,
  security: string,
): CompatCheck {
  const m = matrix[protocol];
  if (!m) return { ok: true }; /* unknown protocol — let validate.ts handle */
  if (!m.security.includes(security as Security)) {
    return {
      ok: false,
      reason: `protocol "${protocol}" does not support security "${security}". Allowed: ${m.security.join(", ")}.`,
    };
  }
  return { ok: true };
}

export function isProtocolTransportSupported(
  protocol: string,
  transport: string,
): CompatCheck {
  const m = matrix[protocol];
  if (!m) return { ok: true };
  if (!m.transports.includes(transport as Transport)) {
    return {
      ok: false,
      reason: `protocol "${protocol}" does not support transport "${transport}". Allowed: ${m.transports.join(", ")}.`,
    };
  }
  return { ok: true };
}

export function checkFlow(
  protocol: string,
  flow: string,
  transport: string,
  security: string,
): CompatCheck {
  if (!flow) return { ok: true };
  const m = matrix[protocol];
  if (!m || !m.flows || !m.flows[flow]) {
    return { ok: true }; /* no rule registered → don't complain. */
  }
  const req = m.flows[flow];
  const tOk = req.transport.includes(transport as Transport);
  const sOk = req.security.includes(security as Security);
  if (!tOk || !sOk) {
    return {
      ok: false,
      reason: `flow "${flow}" requires transport ∈ {${req.transport.join(", ")}} and security ∈ {${req.security.join(", ")}} (got transport=${transport}, security=${security}).`,
    };
  }
  return { ok: true };
}

/* Property bags for diff_protocols. Hand-rated 1..5 (5 = best/most). */
export interface ProtocolFeatures {
  transports: string[];
  security: string[];
  multiplexing: 0 | 1; /* 1 = supports xmux/grpc multimode */
  padding: 0 | 1;      /* 1 = built-in padding for length obfuscation */
  antiDpi: 1 | 2 | 3 | 4 | 5;
  mobileFriendly: 1 | 2 | 3 | 4 | 5;
  battery: 1 | 2 | 3 | 4 | 5;
  ease: 1 | 2 | 3 | 4 | 5;
  notes: string;
}

export const protocolFeatures: Record<string, ProtocolFeatures> = {
  vless: {
    transports: matrix.vless.transports.slice(),
    security: matrix.vless.security.slice(),
    multiplexing: 1,
    padding: 1,
    antiDpi: 5,
    mobileFriendly: 4,
    battery: 4,
    ease: 3,
    notes: "Best DPI resistance via REALITY+xhttp/raw+vision. Steeper config.",
  },
  vmess: {
    transports: matrix.vmess.transports.slice(),
    security: matrix.vmess.security.slice(),
    multiplexing: 1,
    padding: 0,
    antiDpi: 2,
    mobileFriendly: 4,
    battery: 4,
    ease: 4,
    notes: "Legacy. AEAD only post-2022. No REALITY. UUID-based auth.",
  },
  trojan: {
    transports: matrix.trojan.transports.slice(),
    security: matrix.trojan.security.slice(),
    multiplexing: 1,
    padding: 0,
    antiDpi: 3,
    mobileFriendly: 4,
    battery: 4,
    ease: 4,
    notes: "Looks like vanilla TLS HTTPS. Needs a real cert.",
  },
  shadowsocks: {
    transports: matrix.shadowsocks.transports.slice(),
    security: matrix.shadowsocks.security.slice(),
    multiplexing: 0,
    padding: 0,
    antiDpi: 2,
    mobileFriendly: 5,
    battery: 5,
    ease: 5,
    notes: "Lightest, broadest client support. SS-2022 ciphers required for serious DPI environments.",
  },
  hysteria2: {
    transports: matrix.hysteria2.transports.slice(),
    security: matrix.hysteria2.security.slice(),
    multiplexing: 1,
    padding: 1,
    antiDpi: 4,
    mobileFriendly: 3,
    battery: 2,
    ease: 4,
    notes: "QUIC over UDP. Best throughput on lossy links. Battery-hungry on phones.",
  },
  wireguard: {
    transports: matrix.wireguard.transports.slice(),
    security: matrix.wireguard.security.slice(),
    multiplexing: 0,
    padding: 0,
    antiDpi: 1,
    mobileFriendly: 5,
    battery: 5,
    ease: 5,
    notes: "Easiest, best battery, but trivially DPI-blockable in 2025 RU.",
  },
};
