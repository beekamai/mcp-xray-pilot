/*
 * Protocol registry: maps protocol name → Zod schema for `settings` block.
 *
 * Used by validate.ts to deep-check inbound/outbound settings shape per
 * protocol. Anything not registered falls back to the legacy "is it a
 * known string" check.
 */

import type { z } from "zod";
import { vlessInbound, vlessOutbound } from "./vless.js";
import { vmessInbound, vmessOutbound } from "./vmess.js";
import { trojanInbound, trojanOutbound } from "./trojan.js";
import { shadowsocksInbound, shadowsocksOutbound } from "./shadowsocks.js";
import { socksInbound, socksOutbound } from "./socks.js";
import { httpInbound, httpOutbound } from "./http.js";
import { wireguardInbound, wireguardOutbound } from "./wireguard.js";
import { dokodemoInbound } from "./dokodemo.js";
import { tunInbound } from "./tun.js";
import { hysteriaInbound, hysteriaOutbound } from "./hysteria.js";
import { freedomOutbound } from "./freedom.js";
import { blackholeOutbound } from "./blackhole.js";
import { dnsOutbound } from "./dns.js";
import { loopbackOutbound } from "./loopback.js";

export type AnySchema = z.ZodTypeAny;

export const inboundProtocolSchemas: Record<string, AnySchema> = {
  vless: vlessInbound,
  vmess: vmessInbound,
  trojan: trojanInbound,
  shadowsocks: shadowsocksInbound,
  socks: socksInbound,
  http: httpInbound,
  wireguard: wireguardInbound,
  "dokodemo-door": dokodemoInbound,
  tun: tunInbound,
  hysteria: hysteriaInbound,
  hysteria2: hysteriaInbound,
};

export const outboundProtocolSchemas: Record<string, AnySchema> = {
  vless: vlessOutbound,
  vmess: vmessOutbound,
  trojan: trojanOutbound,
  shadowsocks: shadowsocksOutbound,
  socks: socksOutbound,
  http: httpOutbound,
  wireguard: wireguardOutbound,
  hysteria: hysteriaOutbound,
  hysteria2: hysteriaOutbound,
  freedom: freedomOutbound,
  blackhole: blackholeOutbound,
  dns: dnsOutbound,
  loopback: loopbackOutbound,
};
