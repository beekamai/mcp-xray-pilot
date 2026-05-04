/*
 * Shared sub-schemas for protocol settings.
 *
 * Kept loose-by-default (`.passthrough()`) — xray-core often adds undocumented
 * fields, and we don't want to error on a brand-new property the agent might
 * legitimately want to set. Validate only fields with known shape; surface
 * unknown fields as info via the validator (not the schema).
 */

import { z } from "zod";

export const uuid = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  "must be a UUID v4 (8-4-4-4-12 hex)",
);

export const userLevel = z.number().int().min(0).max(99);

export const email = z.string().email().or(z.string().min(1));

export const vlessFlow = z.enum([
  "",
  "none",
  "xtls-rprx-vision",
  "xtls-rprx-vision-udp443",
]);

/* TCP/UDP/etc. — used inside settings.network for dokodemo, ss inbound. */
export const network = z.enum(["tcp", "udp", "tcp,udp"]);

export const fallbackEntry = z
  .object({
    name: z.string().optional(),
    alpn: z.string().optional(),
    path: z.string().optional(),
    type: z.string().optional(),
    dest: z.union([z.string(), z.number().int()]).optional(),
    xver: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const fallbacks = z.array(fallbackEntry);
