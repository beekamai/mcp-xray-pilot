/*
 * Loopback outbound settings.
 * Source: docs/en/config/outbounds/loopback.md
 */

import { z } from "zod";

export const loopbackOutbound = z
  .object({
    inboundTag: z.string().min(1),
  })
  .passthrough();
