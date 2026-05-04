/*
 * Tool: xray_refresh_cache
 *
 * Thin wrapper around docs.refreshDocs() with input validation. The actual
 * fetch loop lives in src/docs.ts so the CLI script (scripts/fetch-docs.ts)
 * and the MCP tool share one code path.
 */

import { refreshDocs, type RefreshResult, type RefreshScope } from "../docs.js";
import type { Category } from "../types.js";

const VALID_SCOPES: RefreshScope[] = ["all", "stale", "category"];
const VALID_CATEGORIES: Category[] = [
  "basic",
  "features",
  "inbounds",
  "outbounds",
  "transports",
];

export interface RefreshArgs {
  scope?: string;
  category?: string;
  max_age_days?: number;
  discover?: boolean;
}

export async function runRefresh(args: RefreshArgs): Promise<RefreshResult> {
  const scope = (args.scope ?? "stale") as RefreshScope;
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(
      `Invalid scope "${args.scope}". Expected one of: ${VALID_SCOPES.join(", ")}`,
    );
  }
  let category: Category | undefined;
  if (scope === "category") {
    if (!args.category) {
      throw new Error("scope=category requires `category`");
    }
    if (!VALID_CATEGORIES.includes(args.category as Category)) {
      throw new Error(
        `Invalid category "${args.category}". Expected one of: ${VALID_CATEGORIES.join(", ")}`,
      );
    }
    category = args.category as Category;
  }

  const max_age_days = args.max_age_days ?? 30;
  if (
    typeof max_age_days !== "number" ||
    !Number.isFinite(max_age_days) ||
    max_age_days < 1 ||
    max_age_days > 365
  ) {
    throw new Error("max_age_days must be a number in [1, 365]");
  }

  return refreshDocs({
    scope,
    category,
    max_age_days,
    discover: !!args.discover,
  });
}
