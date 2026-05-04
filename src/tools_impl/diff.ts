/*
 * xray_diff_protocols — side-by-side comparison of two protocols.
 *
 * Output is plain JSON the agent can render as a table. No markdown formatting
 * here so callers can pretty-print however they like.
 */

import { matrix, protocolFeatures } from "../data/compatibility.js";

export interface DiffRow {
  feature: string;
  a: string | number | boolean;
  b: string | number | boolean;
  same: boolean;
}

export interface DiffResult {
  a: string;
  b: string;
  rows: DiffRow[];
  summary: string;
}

const featureOrder: { key: keyof typeof protocolFeatures.vless; label: string }[] = [
  { key: "transports", label: "Transports" },
  { key: "security", label: "Security" },
  { key: "multiplexing", label: "Multiplexing (xmux/grpc)" },
  { key: "padding", label: "Built-in padding" },
  { key: "antiDpi", label: "Anti-DPI rating (1-5)" },
  { key: "mobileFriendly", label: "Mobile friendliness (1-5)" },
  { key: "battery", label: "Battery score (1-5, higher=better)" },
  { key: "ease", label: "Ease of setup (1-5)" },
  { key: "notes", label: "Notes" },
];

function fmt(v: unknown): string | number | boolean {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

export function diffProtocols(a: string, b: string): DiffResult {
  const fa = protocolFeatures[a];
  const fb = protocolFeatures[b];
  if (!fa) throw new Error(`unknown protocol "${a}"; known: ${Object.keys(protocolFeatures).join(", ")}`);
  if (!fb) throw new Error(`unknown protocol "${b}"; known: ${Object.keys(protocolFeatures).join(", ")}`);

  const rows: DiffRow[] = [];
  for (const { key, label } of featureOrder) {
    const va = fa[key as keyof typeof fa];
    const vb = fb[key as keyof typeof fb];
    rows.push({
      feature: label,
      a: fmt(va),
      b: fmt(vb),
      same: JSON.stringify(va) === JSON.stringify(vb),
    });
  }

  const ma = matrix[a];
  const mb = matrix[b];
  const summary = [
    `${a} ↔ ${b}: `,
    ma && mb
      ? `${a} supports ${ma.security.join("/")}; ${b} supports ${mb.security.join("/")}.`
      : "(matrix incomplete)",
    ` ${a} score (anti-DPI×mobile×battery) = ${fa.antiDpi * fa.mobileFriendly * fa.battery}, ${b} = ${fb.antiDpi * fb.mobileFriendly * fb.battery}.`,
  ].join("");

  return { a, b, rows, summary };
}
