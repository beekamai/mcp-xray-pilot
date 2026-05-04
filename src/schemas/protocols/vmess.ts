/*
 * VMess settings schemas.
 * Source: docs/en/config/inbounds/vmess.md, outbounds/vmess.md
 */

import { z } from "zod";
import { email, userLevel, uuid } from "./common.js";

const vmessClient = z
  .object({
    id: uuid,
    level: userLevel.optional(),
    email: email.optional(),
  })
  .passthrough();

export const vmessInbound = z
  .object({
    clients: z.array(vmessClient).min(1),
    default: z
      .object({
        level: userLevel.optional(),
      })
      .passthrough()
      .optional(),
    detour: z.object({ to: z.string() }).passthrough().optional(),
  })
  .passthrough();

const vmessUser = z
  .object({
    id: uuid,
    security: z
      .enum(["aes-128-gcm", "chacha20-poly1305", "auto", "none", "zero"])
      .optional(),
    level: userLevel.optional(),
    email: email.optional(),
  })
  .passthrough();

const vmessServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    users: z.array(vmessUser).min(1),
  })
  .passthrough();

export const vmessOutbound = z
  .object({
    vnext: z.array(vmessServer).min(1),
  })
  .passthrough();
