/*
 * VLESS settings schemas (inbound and outbound).
 * Source: docs/en/config/inbounds/vless.md, outbounds/vless.md
 */

import { z } from "zod";
import { email, fallbacks, userLevel, uuid, vlessFlow } from "./common.js";

const vlessClient = z
  .object({
    id: uuid,
    level: userLevel.optional(),
    email: email.optional(),
    flow: vlessFlow.optional(),
  })
  .passthrough();

export const vlessInbound = z
  .object({
    clients: z.array(vlessClient).min(1, "VLESS inbound needs at least one client"),
    /* xray refuses to start without explicit "none" or a real encryption block. */
    decryption: z.string().min(1, 'decryption is required (use "none" if unset)'),
    fallbacks: fallbacks.optional(),
  })
  .passthrough();

const vlessUser = z
  .object({
    id: uuid,
    level: userLevel.optional(),
    email: email.optional(),
    flow: vlessFlow.optional(),
    encryption: z.string().optional(),
  })
  .passthrough();

const vlessServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    users: z.array(vlessUser).min(1),
  })
  .passthrough();

export const vlessOutbound = z
  .object({
    vnext: z.array(vlessServer).min(1, "VLESS outbound needs vnext[]"),
  })
  .passthrough();
