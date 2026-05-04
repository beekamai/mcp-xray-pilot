/*
 * HTTP proxy settings schemas.
 * Source: docs/en/config/inbounds/http.md, outbounds/http.md
 */

import { z } from "zod";
import { userLevel } from "./common.js";

const httpAccount = z
  .object({
    user: z.string().min(1),
    pass: z.string().min(1),
  })
  .passthrough();

export const httpInbound = z
  .object({
    accounts: z.array(httpAccount).optional(),
    allowTransparent: z.boolean().optional(),
    userLevel: userLevel.optional(),
  })
  .passthrough();

const httpUser = z
  .object({
    user: z.string().min(1),
    pass: z.string().min(1),
  })
  .passthrough();

const httpServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    users: z.array(httpUser).optional(),
  })
  .passthrough();

export const httpOutbound = z
  .object({
    servers: z.array(httpServer).min(1),
  })
  .passthrough();
