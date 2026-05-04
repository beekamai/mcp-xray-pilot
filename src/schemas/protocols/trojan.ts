/*
 * Trojan settings schemas.
 * Source: docs/en/config/inbounds/trojan.md, outbounds/trojan.md
 */

import { z } from "zod";
import { email, fallbacks, userLevel } from "./common.js";

const trojanClient = z
  .object({
    password: z.string().min(1),
    level: userLevel.optional(),
    email: email.optional(),
  })
  .passthrough();

export const trojanInbound = z
  .object({
    clients: z.array(trojanClient).min(1),
    fallbacks: fallbacks.optional(),
  })
  .passthrough();

const trojanServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    password: z.string().min(1),
    level: userLevel.optional(),
    email: email.optional(),
  })
  .passthrough();

export const trojanOutbound = z
  .object({
    servers: z.array(trojanServer).min(1),
  })
  .passthrough();
