/*
 * HTTPUpgrade transport.
 * Source: docs/en/config/transports/httpupgrade.md
 */

import { z } from "zod";

export const httpUpgradeSettings = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    headers: z.record(z.string()).optional(),
    acceptProxyProtocol: z.boolean().optional(),
  })
  .passthrough();
