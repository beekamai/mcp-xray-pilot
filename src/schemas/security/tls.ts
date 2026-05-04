/*
 * TLS streamSettings.tlsSettings.
 * Source: docs/en/config/transport.md (security section)
 */

import { z } from "zod";

export const tlsFingerprints = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
  "unsafe",
] as const;

export const alpnValues = ["h2", "http/1.1", "h3"] as const;

const certificate = z
  .object({
    usage: z.enum(["encipherment", "verify", "issue"]).optional(),
    certificateFile: z.string().optional(),
    keyFile: z.string().optional(),
    certificate: z.array(z.string()).optional(),
    key: z.array(z.string()).optional(),
  })
  .passthrough();

export const tlsSettings = z
  .object({
    serverName: z.string().optional(),
    rejectUnknownSni: z.boolean().optional(),
    allowInsecure: z.boolean().optional(),
    alpn: z.array(z.enum(alpnValues)).optional(),
    minVersion: z.string().optional(),
    maxVersion: z.string().optional(),
    cipherSuites: z.string().optional(),
    fingerprint: z.enum(tlsFingerprints).optional(),
    certificates: z.array(certificate).optional(),
    disableSystemRoot: z.boolean().optional(),
    enableSessionResumption: z.boolean().optional(),
    pinnedPeerCertificateChainSha256: z.array(z.string()).optional(),
    masterKeyLog: z.string().optional(),
  })
  .passthrough();
