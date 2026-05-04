#!/usr/bin/env node
/*
 * Pull every domain-list category name from v2fly/domain-list-community
 * and write it to data/geocatalogue.json so the runtime can hydrate the
 * full geosite catalogue.
 *
 * Usage:
 *   npm run fetch-geocatalogue
 *
 * Output: data/geocatalogue.json
 *   {
 *     "fetched_at": "...",
 *     "source": "github.com/v2fly/domain-list-community/tree/master/data",
 *     "count": <int>,
 *     "names": ["00-tier", "9gag", ..., "youtube", "yandex"]
 *   }
 *
 * Optional: set GITHUB_TOKEN env var to raise rate limit (60/h → 5000/h).
 *
 * Thin wrapper around refreshGeoCatalogue() in src/tools_impl/
 * geocatalogue_fetch.ts so the MCP tool xray_refresh_cache and this CLI
 * share one code path.
 */

import { refreshGeoCatalogue } from "../src/tools_impl/geocatalogue_fetch.js";

async function main(): Promise<void> {
  process.stderr.write(`[fetch-geocatalogue] querying upstream tree…\n`);
  const r = await refreshGeoCatalogue();
  process.stderr.write(
    `[fetch-geocatalogue] wrote ${r.written_to} (${r.count} categories)\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fetch-geocatalogue fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
