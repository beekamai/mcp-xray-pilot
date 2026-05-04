/*
 * Transport registry.
 *
 * Maps streamSettings.network → schema for the corresponding *Settings block.
 * Tabular form so the validator can both:
 *   1. validate the *Settings shape, and
 *   2. detect a mismatch (network=ws but xhttpSettings present, etc).
 */

import type { z } from "zod";
import { rawSettings } from "./raw.js";
import { xhttpSettings } from "./xhttp.js";
import { grpcSettings } from "./grpc.js";
import { wsSettings } from "./websocket.js";
import { mkcpSettings } from "./mkcp.js";
import { httpUpgradeSettings } from "./httpupgrade.js";
import { hysteriaTransportSettings } from "./hysteria.js";

export interface TransportSpec {
  network: string;
  /* Field name inside streamSettings, e.g. "wsSettings". */
  settingsKey: string;
  schema: z.ZodTypeAny;
}

export const transportSpecs: TransportSpec[] = [
  { network: "raw", settingsKey: "rawSettings", schema: rawSettings },
  { network: "tcp", settingsKey: "tcpSettings", schema: rawSettings },
  { network: "xhttp", settingsKey: "xhttpSettings", schema: xhttpSettings },
  { network: "splithttp", settingsKey: "splithttpSettings", schema: xhttpSettings },
  { network: "grpc", settingsKey: "grpcSettings", schema: grpcSettings },
  { network: "ws", settingsKey: "wsSettings", schema: wsSettings },
  { network: "websocket", settingsKey: "wsSettings", schema: wsSettings },
  { network: "kcp", settingsKey: "kcpSettings", schema: mkcpSettings },
  { network: "mkcp", settingsKey: "kcpSettings", schema: mkcpSettings },
  { network: "httpupgrade", settingsKey: "httpupgradeSettings", schema: httpUpgradeSettings },
  { network: "hysteria", settingsKey: "hysteriaSettings", schema: hysteriaTransportSettings },
];

export const transportByNetwork: Record<string, TransportSpec> = Object.fromEntries(
  transportSpecs.map((t) => [t.network, t]),
);

/* All known *Settings keys, used to flag cross-network leftovers. */
export const allSettingsKeys = new Set(transportSpecs.map((t) => t.settingsKey));
