/*
 * Security registry.
 *
 * Maps streamSettings.security → schema for the matching settings block.
 */

import type { z } from "zod";
import { tlsSettings } from "./tls.js";
import { realitySettings } from "./reality.js";

export interface SecuritySpec {
  security: string;
  settingsKey: string;
  schema: z.ZodTypeAny;
}

export const securitySpecs: SecuritySpec[] = [
  { security: "tls", settingsKey: "tlsSettings", schema: tlsSettings },
  { security: "reality", settingsKey: "realitySettings", schema: realitySettings },
];

export const securityByName: Record<string, SecuritySpec> = Object.fromEntries(
  securitySpecs.map((s) => [s.security, s]),
);

export const allSecuritySettingsKeys = new Set(securitySpecs.map((s) => s.settingsKey));

export { tlsFingerprints, alpnValues } from "./tls.js";
export { xtlsFlowValues } from "./xtls.js";
