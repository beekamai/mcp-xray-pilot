/*
 * Shadowsocks settings schemas.
 * Source: docs/en/config/inbounds/shadowsocks.md, outbounds/shadowsocks.md
 *
 * Includes Shadowsocks-2022 AEAD (2022-blake3-*) ciphers.
 */

import { z } from "zod";
import { email, network, userLevel } from "./common.js";

export const shadowsocksMethod = z.enum([
  "none",
  "plain",
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-poly1305",
  "chacha20-ietf-poly1305",
  "xchacha20-poly1305",
  "xchacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
]);

const ssUser = z
  .object({
    password: z.string().min(1),
    method: shadowsocksMethod.optional(),
    level: userLevel.optional(),
    email: email.optional(),
  })
  .passthrough();

export const shadowsocksInbound = z
  .object({
    method: shadowsocksMethod.optional(),
    password: z.string().min(1).optional(),
    network: network.optional(),
    clients: z.array(ssUser).optional(),
    ivCheck: z.boolean().optional(),
  })
  .passthrough()
  .refine((s) => Boolean(s.password) || (Array.isArray(s.clients) && s.clients.length > 0), {
    message: "Shadowsocks inbound needs either `password` (single-user) or `clients[]` (multi-user)",
  });

const ssServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    method: shadowsocksMethod,
    password: z.string().min(1),
    level: userLevel.optional(),
    email: email.optional(),
    ivCheck: z.boolean().optional(),
    uot: z.boolean().optional(),
    UoTVersion: z.number().int().optional(),
  })
  .passthrough();

export const shadowsocksOutbound = z
  .object({
    servers: z.array(ssServer).min(1),
  })
  .passthrough();
