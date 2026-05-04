/*
 * REALITY streamSettings.realitySettings.
 * Source: docs/en/config/transport.md
 *
 * Validates field shape; semantic checks (key length, hex shortIds, target
 * grammar) are also enforced as separate lint rules so they show up as
 * structured issues with explicit rule ids.
 */

import { z } from "zod";
import { tlsFingerprints } from "./tls.js";

const base64url43 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "REALITY key must be 43 base64url chars (no padding)");

const shortIdHex = z
  .string()
  .regex(
    /^([0-9a-fA-F]{2}){0,8}$/,
    "REALITY shortId must be hex, even length 0..16",
  );

export const realitySettings = z
  .object({
    show: z.boolean().optional(),
    target: z.string().optional(),
    dest: z.string().optional(),
    xver: z.number().int().nonnegative().optional(),
    serverNames: z.array(z.string().min(1)).min(1).optional(),
    privateKey: base64url43.optional(),
    publicKey: base64url43.optional(),
    minClientVer: z.string().optional(),
    maxClientVer: z.string().optional(),
    maxTimeDiff: z.number().int().nonnegative().optional(),
    shortIds: z.array(shortIdHex).optional(),
    spiderX: z.string().optional(),
    fingerprint: z.enum(tlsFingerprints).optional(),
    serverName: z.string().optional(),
  })
  .passthrough();
