/*
 * mKCP transport.
 * Source: docs/en/config/transports/mkcp.md
 */

import { z } from "zod";

const headerObj = z
  .object({
    type: z
      .enum([
        "none",
        "srtp",
        "utp",
        "wechat-video",
        "dtls",
        "wireguard",
        "dns",
      ])
      .optional(),
  })
  .passthrough();

export const mkcpSettings = z
  .object({
    mtu: z.number().int().min(576).max(1460).optional(),
    tti: z.number().int().min(10).max(100).optional(),
    uplinkCapacity: z.number().int().nonnegative().optional(),
    downlinkCapacity: z.number().int().nonnegative().optional(),
    congestion: z.boolean().optional(),
    readBufferSize: z.number().int().nonnegative().optional(),
    writeBufferSize: z.number().int().nonnegative().optional(),
    header: headerObj.optional(),
    seed: z.string().optional(),
  })
  .passthrough();
