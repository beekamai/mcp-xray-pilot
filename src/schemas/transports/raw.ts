/*
 * Raw / TCP transport (streamSettings.network = "raw" or "tcp").
 * Source: docs/en/config/transports/raw.md, transports/tcp.md
 */

import { z } from "zod";

const headerObj = z
  .object({
    type: z.enum(["none", "http"]).optional(),
    request: z.unknown().optional(),
    response: z.unknown().optional(),
  })
  .passthrough();

export const rawSettings = z
  .object({
    acceptProxyProtocol: z.boolean().optional(),
    header: headerObj.optional(),
  })
  .passthrough();
