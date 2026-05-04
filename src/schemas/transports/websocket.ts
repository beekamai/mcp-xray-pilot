/*
 * WebSocket transport.
 * Source: docs/en/config/transports/websocket.md
 */

import { z } from "zod";

export const wsSettings = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    headers: z.record(z.string()).optional(),
    acceptProxyProtocol: z.boolean().optional(),
    heartbeatPeriod: z.number().int().nonnegative().optional(),
  })
  .passthrough();
