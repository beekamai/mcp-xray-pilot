/*
 * TUN settings schemas (xray inbound on Linux/macOS).
 * Source: docs/en/config/inbounds/tun.md
 */

import { z } from "zod";

export const tunInbound = z
  .object({
    interface_name: z.string().optional(),
    address: z.array(z.string()).optional(),
    mtu: z.number().int().positive().optional(),
    auto_route: z.boolean().optional(),
    strict_route: z.boolean().optional(),
    inet4_route_address: z.array(z.string()).optional(),
    inet6_route_address: z.array(z.string()).optional(),
    endpoint_independent_nat: z.boolean().optional(),
    stack: z.string().optional(),
  })
  .passthrough();
