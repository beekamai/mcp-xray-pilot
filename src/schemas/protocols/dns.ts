/*
 * DNS outbound settings.
 * Source: docs/en/config/outbounds/dns.md
 */

import { z } from "zod";

export const dnsOutbound = z
  .object({
    network: z.enum(["tcp", "udp", "tcp,udp"]).optional(),
    address: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    nonIPQuery: z.enum(["drop", "skip"]).optional(),
  })
  .passthrough();
