/*
 * XHTTP transport.
 * Source: docs/en/config/transports/xhttp.md (stub) + Xray-core/discussions/4113
 *
 * The official .md is a stub linking to the discussion. Field set is encoded
 * here from the discussion + observed configs in the wild.
 */

import { z } from "zod";

const xmux = z
  .object({
    maxConcurrency: z.union([z.number().int(), z.string()]).optional(),
    maxConnections: z.union([z.number().int(), z.string()]).optional(),
    cMaxReuseTimes: z.union([z.number().int(), z.string()]).optional(),
    hMaxRequestTimes: z.union([z.number().int(), z.string()]).optional(),
    hMaxReusableSecs: z.union([z.number().int(), z.string()]).optional(),
    hKeepAlivePeriod: z.union([z.number().int(), z.string()]).optional(),
  })
  .passthrough();

export const xhttpSettings = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    mode: z.enum(["auto", "packet-up", "stream-up", "stream-one"]).optional(),
    extra: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    xmux: xmux.optional(),
    noGRPCHeader: z.boolean().optional(),
    xPaddingBytes: z.union([z.number().int(), z.string()]).optional(),
    scMaxEachPostBytes: z.union([z.number().int(), z.string()]).optional(),
    scMinPostsIntervalMs: z.union([z.number().int(), z.string()]).optional(),
    scStreamUpServerSecs: z.union([z.number().int(), z.string()]).optional(),
  })
  .passthrough();
