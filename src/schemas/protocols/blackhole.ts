/*
 * Blackhole outbound settings.
 * Source: docs/en/config/outbounds/blackhole.md
 */

import { z } from "zod";

export const blackholeOutbound = z
  .object({
    response: z
      .object({
        type: z.enum(["none", "http"]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
