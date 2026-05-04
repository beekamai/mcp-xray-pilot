/*
 * XTLS flow values + helper guards.
 * Source: docs/en/config/features/xtls.md
 *
 * The flow lives on the per-client/user object inside settings, not
 * inside streamSettings. Schema is just the enum; semantic compatibility
 * (vision requires raw + tls/reality) lives in lint rules.
 */

import { z } from "zod";

export const xtlsFlowValues = [
  "",
  "none",
  "xtls-rprx-vision",
  "xtls-rprx-vision-udp443",
] as const;

export const xtlsFlow = z.enum(xtlsFlowValues);
