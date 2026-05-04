/*
 * Freedom outbound settings.
 * Source: docs/en/config/outbounds/freedom.md
 */

import { z } from "zod";

export const freedomOutbound = z
  .object({
    domainStrategy: z
      .enum([
        "AsIs",
        "UseIP",
        "UseIPv4",
        "UseIPv6",
        "UseIPv4v6",
        "UseIPv6v4",
        "ForceIP",
        "ForceIPv4",
        "ForceIPv6",
        "ForceIPv4v6",
        "ForceIPv6v4",
      ])
      .optional(),
    redirect: z.string().optional(),
    userLevel: z.number().int().nonnegative().optional(),
    fragment: z
      .object({
        packets: z.string().optional(),
        length: z.string().optional(),
        interval: z.string().optional(),
      })
      .passthrough()
      .optional(),
    noises: z
      .array(
        z
          .object({
            type: z.string().optional(),
            packet: z.string().optional(),
            delay: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      )
      .optional(),
    proxyProtocol: z.number().int().optional(),
  })
  .passthrough();
