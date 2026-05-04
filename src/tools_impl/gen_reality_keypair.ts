/*
 * Tool: xray_generate_reality_keypair
 *
 * Equivalent of `xray x25519`: produces a fresh X25519 keypair,
 * encoded as 43-char base64url (no padding) — REALITY's wire format.
 *
 * The raw 32-byte keys are extracted from Node's DER output:
 *   - PKCS#8 private DER for x25519 ends with the 32-byte key
 *     (the inner OCTET STRING).
 *   - SPKI public DER for x25519 ends with the 32-byte key
 *     (the BIT STRING payload).
 * Trailing-32-byte slice works for both because Node emits the
 * canonical short-form encoding.
 */

import { generateKeyPairSync } from "node:crypto";

export interface GenRealityKeypairResult {
  privateKey: string;
  publicKey: string;
  note: string;
}

export function generateRealityKeypair(): GenRealityKeypairResult {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");

  const privDer = privateKey.export({ format: "der", type: "pkcs8" });
  const pubDer = publicKey.export({ format: "der", type: "spki" });

  /* Canonical PKCS8 x25519 = 48 bytes; SPKI x25519 = 44 bytes. Last 32 = key. */
  const privRaw = privDer.subarray(privDer.length - 32);
  const pubRaw = pubDer.subarray(pubDer.length - 32);

  const priv = Buffer.from(privRaw).toString("base64url");
  const pub = Buffer.from(pubRaw).toString("base64url");

  if (priv.length !== 43 || pub.length !== 43) {
    throw new Error(
      `Internal: expected 43-char base64url keys, got priv=${priv.length} pub=${pub.length}`,
    );
  }

  return {
    privateKey: priv,
    publicKey: pub,
    note: "Server: paste privateKey into inbound realitySettings.privateKey. Clients: paste publicKey into outbound realitySettings.publicKey. Format matches `xray x25519` output exactly.",
  };
}
