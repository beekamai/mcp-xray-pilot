/*
 * Hysteria transport (rare — usually used as a protocol).
 * Source: docs/en/config/transports/hysteria.md
 */

import { z } from "zod";

export const hysteriaTransportSettings = z
  .object({
    password: z.string().optional(),
    security: z
      .object({
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    congestion: z
      .object({
        type: z.string().optional(),
        up_mbps: z.number().int().nonnegative().optional(),
        down_mbps: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
