/*
 * gRPC transport.
 * Source: docs/en/config/transports/grpc.md
 */

import { z } from "zod";

export const grpcSettings = z
  .object({
    serviceName: z.string().min(1),
    multiMode: z.boolean().optional(),
    idle_timeout: z.number().int().nonnegative().optional(),
    health_check_timeout: z.number().int().nonnegative().optional(),
    permit_without_stream: z.boolean().optional(),
    initial_windows_size: z.number().int().nonnegative().optional(),
    user_agent: z.string().optional(),
    authority: z.string().optional(),
  })
  .passthrough();
