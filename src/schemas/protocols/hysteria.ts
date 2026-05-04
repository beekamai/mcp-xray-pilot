/*
 * Hysteria(2) settings schemas (inbound and outbound).
 * Source: docs/en/config/inbounds/hysteria.md, outbounds/hysteria.md
 */

import { z } from "zod";

const bandwidth = z
  .object({
    up: z.union([z.string(), z.number()]).optional(),
    down: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const hysteriaInbound = z
  .object({
    obfs: z
      .object({
        type: z.string().optional(),
        password: z.string().optional(),
      })
      .passthrough()
      .optional(),
    auth: z
      .object({
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    bandwidth: bandwidth.optional(),
    ignore_client_bandwidth: z.boolean().optional(),
  })
  .passthrough();

const hysteriaServer = z
  .object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    auth_str: z.string().optional(),
  })
  .passthrough();

export const hysteriaOutbound = z
  .object({
    servers: z.array(hysteriaServer).min(1).optional(),
    obfs: z
      .object({
        type: z.string().optional(),
        password: z.string().optional(),
      })
      .passthrough()
      .optional(),
    bandwidth: bandwidth.optional(),
  })
  .passthrough();
