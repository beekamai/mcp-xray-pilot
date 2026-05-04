/*
 * WireGuard settings schemas (inbound and outbound).
 * Source: docs/en/config/inbounds/wireguard.md, outbounds/wireguard.md
 */

import { z } from "zod";

const peer = z
  .object({
    publicKey: z.string().min(1).optional(),
    endpoint: z.string().optional(),
    allowedIPs: z.array(z.string()).optional(),
    preSharedKey: z.string().optional(),
    keepAlive: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const wireguardInbound = z
  .object({
    secretKey: z.string().min(1),
    peers: z.array(peer).min(1),
    mtu: z.number().int().positive().optional(),
    kernelMode: z.boolean().optional(),
  })
  .passthrough();

export const wireguardOutbound = z
  .object({
    secretKey: z.string().min(1),
    address: z.array(z.string()).optional(),
    peers: z.array(peer).min(1),
    mtu: z.number().int().positive().optional(),
    workers: z.number().int().nonnegative().optional(),
    domainStrategy: z.string().optional(),
    reserved: z.array(z.number().int()).optional(),
  })
  .passthrough();
