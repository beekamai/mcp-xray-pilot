/*
 * SOCKS settings schemas.
 * Source: docs/en/config/inbounds/socks.md, outbounds/socks.md
 */

import { z } from "zod";
import { userLevel } from "./common.js";

const socksAccount = z
  .object({
    user: z.string().min(1),
    pass: z.string().min(1),
  })
  .passthrough();

export const socksInbound = z
  .object({
    auth: z.enum(["noauth", "password"]).optional(),
    accounts: z.array(socksAccount).optional(),
    udp: z.boolean().optional(),
    ip: z.string().optional(),
    userLevel: userLevel.optional(),
  })
  .passthrough();

const socksUser = z
  .object({
    user: z.string().min(1),
    pass: z.string().min(1),
    level: userLevel.optional(),
  })
  .passthrough();

const socksServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    users: z.array(socksUser).optional(),
  })
  .passthrough();

export const socksOutbound = z
  .object({
    servers: z.array(socksServer).min(1),
    version: z.enum(["4", "4a", "5"]).optional(),
  })
  .passthrough();
