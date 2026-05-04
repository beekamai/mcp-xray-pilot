/*
 * dokodemo-door settings schemas.
 * Source: docs/en/config/inbounds/dokodemo.md
 */

import { z } from "zod";
import { network, userLevel } from "./common.js";

export const dokodemoInbound = z
  .object({
    address: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    network: network.optional(),
    timeout: z.number().int().nonnegative().optional(),
    followRedirect: z.boolean().optional(),
    userLevel: userLevel.optional(),
  })
  .passthrough();
