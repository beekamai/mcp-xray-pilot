/*
 * Tool: xray_generate_short_ids
 *
 * Cryptographically random REALITY shortIds. Each `length` is the byte
 * count; the resulting hex string is 2× that many chars (so [4,8,16] →
 * "8/16/32 hex chars"). Always prepends an empty string when count > 1
 * for legacy-client compatibility.
 */

import { randomBytes } from "node:crypto";

export interface GenShortIdsArgs {
  count?: number;
  lengths?: number[];
}

export interface GenShortIdsResult {
  short_ids: string[];
  notes: string[];
}

const DEFAULT_LENGTHS = [4, 8, 16];

export function generateShortIds(args: GenShortIdsArgs = {}): GenShortIdsResult {
  const count = args.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error("count must be an integer in [1, 10]");
  }
  const lengths = (args.lengths && args.lengths.length ? args.lengths : DEFAULT_LENGTHS).slice();
  for (const l of lengths) {
    if (!Number.isInteger(l) || l < 1 || l > 32) {
      throw new Error(`lengths[] entries must be integers in [1, 32] bytes. Got: ${l}`);
    }
  }

  const out: string[] = [];
  const notes: string[] = [];
  if (count > 1) {
    out.push("");
    notes.push('First entry is empty string for legacy compatibility (older REALITY clients send no shortId).');
  }

  /* Round-robin through the requested lengths until we have `count` items. */
  for (let i = 0; out.length < count; i++) {
    const bytes = lengths[i % lengths.length];
    out.push(randomBytes(bytes).toString("hex"));
  }

  notes.push(`Generated ${out.length} shortIds using lengths=[${lengths.join(",")}] bytes (hex chars = bytes×2).`);
  notes.push("Drop the entire array into realitySettings.shortIds on inbound. Clients pick one.");
  if (lengths.some((l) => l > 8)) {
    notes.push("WARNING: REALITY shortId max is 8 bytes / 16 hex chars in xray-core. Entries longer than 8 bytes will be rejected by xray. Override `lengths` to stay ≤ 8.");
  }
  return { short_ids: out, notes };
}
