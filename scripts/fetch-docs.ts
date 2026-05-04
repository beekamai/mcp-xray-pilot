#!/usr/bin/env node
/*
 * Bulk-fetch every page in DOCS_CATALOGUE from XTLS/Xray-docs-next into
 * data/docs/.
 *
 * Thin CLI wrapper around `refreshDocs()` from src/docs.ts. The same logic
 * is exposed via the MCP tool `xray_refresh_cache`.
 *
 * Usage:
 *   npm run fetch-docs                      refetch only stale entries (>30d)
 *   npm run fetch-docs -- --refresh         force refetch all
 *   npm run fetch-docs -- --only=transports/xhttp,inbounds/vless
 *   npm run fetch-docs -- --discover        also report new upstream slugs
 *                                           not in DOCS_CATALOGUE
 *
 * Politeness: 200ms between requests, 10s per-request timeout, 3 retries.
 */

import { DOCS_CATALOGUE, discoverNewSlugs, refreshDocs } from "../src/docs.js";

interface CliArgs {
  refresh: boolean;
  only: Set<string> | null;
  discover: boolean;
  discoverOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    refresh: false,
    only: null,
    discover: false,
    discoverOnly: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--refresh") out.refresh = true;
    else if (a === "--discover") {
      /* When called bare it acts as discover-only (legacy behaviour). */
      out.discover = true;
      out.discoverOnly = true;
    } else if (a.startsWith("--only=")) {
      out.only = new Set(
        a
          .slice("--only=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.discoverOnly && !args.refresh && !args.only) {
    /* Backwards-compat: `--discover` alone just prints the diff, no fetch. */
    process.stderr.write(`[discover] querying upstream tree…\n`);
    const extra = await discoverNewSlugs();
    const known = new Set(DOCS_CATALOGUE.map((e) => e.slug));
    process.stderr.write(
      `[discover] catalogue has ${known.size} entries; upstream has ${extra.length} extras.\n`,
    );
    if (extra.length) {
      process.stderr.write(`[discover] new in upstream (consider adding to DOCS_CATALOGUE):\n`);
      for (const s of extra) process.stderr.write(`  + ${s}\n`);
    } else {
      process.stderr.write(`[discover] catalogue is in sync with upstream.\n`);
    }
    return;
  }

  /* `--only=` short-circuit: refetch just the explicit slugs (no staleness). */
  if (args.only) {
    const only = args.only;
    let done = 0;
    let ok = 0;
    let fail = 0;
    const total = only.size;
    /* Reuse refreshDocs by faking a per-slug filter via scope=all + force,
     * then post-filter. Cheaper: just reuse fetchOneRaw + persist via
     * refreshDocs with scope=all + force, but we want only N items. Easiest:
     * use refreshDocs scope=all + force, filter per_topic. But that fetches
     * everything which defeats --only. So inline a tiny loop here. */
    const { fetchOneRaw, rawUrlFor, siteUrlFor, titleFromMarkdown, catalogueEntry } =
      await import("../src/docs.js");
    const { buildFrontmatter, fileNameFor } = await import("../src/utils.js");
    const { loadIndex, saveIndex, writeTopic } = await import("../src/state.js");

    const idx = await loadIndex();
    const idxBySlug = new Map(idx.map((m) => [m.slug, m]));

    for (const slug of only) {
      done++;
      const entry = catalogueEntry(slug);
      if (!entry) {
        process.stderr.write(`[${done}/${total}] unknown slug: ${slug}\n`);
        fail++;
        continue;
      }
      const url = rawUrlFor(slug);
      process.stderr.write(`[${done}/${total}] GET ${url}\n`);
      try {
        const md = await fetchOneRaw(url);
        const title = titleFromMarkdown(slug, md);
        const topic = {
          slug,
          title,
          category: entry.category,
          url: siteUrlFor(slug),
          source_url: url,
          fetched_at: new Date().toISOString(),
          file: fileNameFor(entry.category, slug),
          markdown: md.trim() + "\n",
        };
        await writeTopic(topic, buildFrontmatter(topic));
        idxBySlug.set(slug, {
          slug,
          title,
          category: entry.category,
          url: topic.url,
          source_url: topic.source_url,
          fetched_at: topic.fetched_at,
          file: topic.file,
        });
        ok++;
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        process.stderr.write(`  FAIL: ${(e as Error).message}\n`);
        fail++;
      }
    }
    const finalIdx = [...idxBySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    await saveIndex(finalIdx);
    process.stderr.write(`\nDone (--only). updated=${ok} failed=${fail}\n`);
    return;
  }

  const result = await refreshDocs({
    scope: args.refresh ? "all" : "stale",
    max_age_days: 30,
    force: args.refresh,
    discover: args.discover,
    onProgress: (m) => process.stderr.write(`${m}\n`),
  });

  process.stderr.write(
    `\nDone. attempted=${result.attempted} updated=${result.updated} ` +
      `skipped=${result.skipped} failed=${result.failed} ` +
      `duration_ms=${result.duration_ms}\n`,
  );
  const failures = result.per_topic.filter((p) => p.status === "failed");
  if (failures.length) {
    process.stderr.write(`Failures:\n`);
    for (const f of failures) process.stderr.write(`  - ${f.slug}: ${f.reason}\n`);
  }
  if (result.new_slugs_discovered && result.new_slugs_discovered.length) {
    process.stderr.write(`\nNew slugs in upstream not in DOCS_CATALOGUE:\n`);
    for (const s of result.new_slugs_discovered) process.stderr.write(`  + ${s}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`fetch-docs fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
