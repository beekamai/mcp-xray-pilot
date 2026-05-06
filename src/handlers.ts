/*
 * Tool dispatcher. Returns MCP-shaped { content: [...] } responses.
 */

import { fetchTopic, DOCS_CATALOGUE } from "./docs.js";
import { search } from "./search.js";
import { validateConfig } from "./validate.js";
import { lintConfig } from "./lint.js";
import { loadIndex } from "./state.js";
import { searchGeoCatalogue } from "./data/geocatalogue.js";
import { diffProtocols } from "./tools_impl/diff.js";
import { suggestAlternative, SUPPORTED_GOALS, type Goal } from "./tools_impl/suggest.js";
import { mergeConfigs } from "./tools_impl/merge.js";
import { runRefresh, type RefreshArgs } from "./tools_impl/refresh.js";
import {
  searchGithub,
  fetchGithubIssue,
  type RepoKey,
  type RepoKeyOrAll,
} from "./tools_impl/github.js";
import { generateShortIds, type GenShortIdsArgs } from "./tools_impl/gen_short_ids.js";
import { generateRealityKeypair } from "./tools_impl/gen_reality_keypair.js";
import { validateSniTarget, type ValidateSniArgs } from "./tools_impl/validate_sni.js";
import { testRealityLive, type TestRealityLiveArgs } from "./tools_impl/test_reality_live.js";
import {
  suggestSniForCountry,
  listSupportedCountries,
  type SuggestSniArgs,
} from "./tools_impl/suggest_sni.js";
import type { Category } from "./types.js";

interface McpContent {
  type: "text";
  text: string;
}
interface McpResponse {
  content: McpContent[];
  isError?: boolean;
}

function ok(text: string): McpResponse {
  return { content: [{ type: "text", text }] };
}
function err(text: string): McpResponse {
  return { content: [{ type: "text", text }], isError: true };
}
function json(obj: unknown): McpResponse {
  return ok(JSON.stringify(obj, null, 2));
}

async function listTopics(args: { category?: string } = {}): Promise<McpResponse> {
  const cat = (args.category ?? "all") as Category | "all";
  const index = await loadIndex();

  const known = new Map<string, { slug: string; category: Category; title?: string }>();
  for (const e of DOCS_CATALOGUE) known.set(e.slug, { slug: e.slug, category: e.category });
  for (const m of index)
    known.set(m.slug, { slug: m.slug, category: m.category, title: m.title });

  const items = [...known.values()]
    .filter((x) => cat === "all" || x.category === cat)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const grouped: Record<string, { slug: string; title?: string }[]> = {};
  for (const it of items) {
    (grouped[it.category] ??= []).push({ slug: it.slug, title: it.title });
  }
  return json({
    total: items.length,
    cached: index.length,
    by_category: grouped,
  });
}

async function fetchTopicHandler(args: {
  slug?: string;
  force_offline?: boolean;
}): Promise<McpResponse> {
  if (!args.slug) return err("Missing required parameter: slug");
  try {
    const r = await fetchTopic(args.slug, { force_offline: args.force_offline });
    const header = [
      `# ${r.topic.title}`,
      `URL: ${r.topic.url}`,
      r.topic.source_url ? `Source: ${r.topic.source_url}` : null,
      `Category: ${r.topic.category}`,
      `Origin: ${r.source}${r.warning ? `  (warning: ${r.warning})` : ""}`,
      `Fetched: ${r.topic.fetched_at}`,
      "",
      "---",
      "",
    ]
      .filter((x): x is string => x !== null)
      .join("\n");
    return ok(header + r.topic.markdown);
  } catch (e) {
    return err(`xray_fetch_topic failed: ${(e as Error).message}`);
  }
}

async function searchHandler(args: {
  query?: string;
  max_results?: number;
}): Promise<McpResponse> {
  if (!args.query || args.query.trim().length < 2)
    return err("Missing or too-short `query` (need >=2 chars).");
  const hits = await search(args.query, args.max_results ?? 10);
  return json({ query: args.query, hits });
}

async function validateHandler(args: { config?: string }): Promise<McpResponse> {
  if (typeof args.config !== "string") return err("Missing required parameter: config (string)");
  const r = validateConfig(args.config);
  return json({
    ok: r.ok,
    error_count: r.issues.filter((i) => i.severity === "error").length,
    warn_count: r.issues.filter((i) => i.severity === "warn").length,
    info_count: r.issues.filter((i) => i.severity === "info").length,
    issues: r.issues,
  });
}

async function lintHandler(args: { config?: string }): Promise<McpResponse> {
  if (typeof args.config !== "string") return err("Missing required parameter: config (string)");
  const r = lintConfig(args.config);
  return json({
    ok: r.ok,
    rules_run: r.ranRules,
    error_count: r.issues.filter((i) => i.severity === "error").length,
    warn_count: r.issues.filter((i) => i.severity === "warn").length,
    info_count: r.issues.filter((i) => i.severity === "info").length,
    issues: r.issues,
  });
}

async function geoSearchHandler(args: {
  query?: string;
  max_results?: number;
}): Promise<McpResponse> {
  if (!args.query || args.query.trim().length < 1)
    return err("Missing required parameter: query");
  const hits = searchGeoCatalogue(args.query, args.max_results ?? 30);
  return json({ query: args.query, total: hits.length, hits });
}

async function diffHandler(args: { a?: string; b?: string }): Promise<McpResponse> {
  if (!args.a || !args.b) return err("Missing required parameters: a, b");
  try {
    const r = diffProtocols(args.a, args.b);
    return json(r);
  } catch (e) {
    return err((e as Error).message);
  }
}

async function suggestHandler(args: {
  goal?: string;
  current_config?: string;
}): Promise<McpResponse> {
  if (!args.goal) return err(`Missing required parameter: goal. Supported: ${SUPPORTED_GOALS.join(", ")}`);
  if (!SUPPORTED_GOALS.includes(args.goal as Goal)) {
    return err(`Unknown goal "${args.goal}". Supported: ${SUPPORTED_GOALS.join(", ")}`);
  }
  try {
    const r = suggestAlternative(args.goal as Goal, args.current_config);
    return json(r);
  } catch (e) {
    return err((e as Error).message);
  }
}

async function githubSearchHandler(args: {
  query?: string;
  repo?: string;
  state?: string;
  type?: string;
  sort?: string;
  order?: string;
  max_results?: number;
}): Promise<McpResponse> {
  if (!args.query || !args.query.trim())
    return err("Missing required parameter: query");
  try {
    const r = await searchGithub({
      query: args.query,
      repo: (args.repo as RepoKeyOrAll | undefined) ?? "xray-core",
      state: (args.state as "open" | "closed" | "all" | undefined) ?? "all",
      type: (args.type as "issue" | "pr" | "discussion" | "all" | undefined) ?? "all",
      sort: (args.sort as "updated" | "created" | "reactions" | "comments" | undefined) ?? "updated",
      order: (args.order as "desc" | "asc" | undefined) ?? "desc",
      max_results: args.max_results ?? 10,
    });
    return json(r);
  } catch (e) {
    return err(`xray_github_search failed: ${(e as Error).message}`);
  }
}

async function githubFetchIssueHandler(args: {
  repo?: string;
  number?: number;
  type?: string;
  max_comments?: number;
}): Promise<McpResponse> {
  if (typeof args.number !== "number")
    return err("Missing required parameter: number (positive integer)");
  try {
    const r = await fetchGithubIssue({
      repo: (args.repo as RepoKey | undefined) ?? "xray-core",
      number: args.number,
      type: (args.type as "issue" | "pr" | "discussion" | undefined) ?? "issue",
      max_comments: args.max_comments ?? 10,
    });
    return json(r);
  } catch (e) {
    return err(`xray_github_fetch_issue failed: ${(e as Error).message}`);
  }
}

async function refreshHandler(args: RefreshArgs): Promise<McpResponse> {
  try {
    const r = await runRefresh(args);
    return json(r);
  } catch (e) {
    return err(`xray_refresh_cache failed: ${(e as Error).message}`);
  }
}

async function genShortIdsHandler(args: GenShortIdsArgs): Promise<McpResponse> {
  try {
    return json(generateShortIds(args));
  } catch (e) {
    return err((e as Error).message);
  }
}

async function genRealityKeypairHandler(): Promise<McpResponse> {
  try {
    return json(generateRealityKeypair());
  } catch (e) {
    return err(`xray_generate_reality_keypair failed: ${(e as Error).message}`);
  }
}

async function validateSniHandler(args: ValidateSniArgs): Promise<McpResponse> {
  if (!args.host || !args.host.trim()) return err("Missing required parameter: host");
  try {
    return json(await validateSniTarget(args));
  } catch (e) {
    return err(`xray_validate_sni_target failed: ${(e as Error).message}`);
  }
}

async function testRealityLiveHandler(args: TestRealityLiveArgs): Promise<McpResponse> {
  if (!args.target_host || !args.target_host.trim())
    return err("Missing required parameter: target_host");
  try {
    return json(await testRealityLive(args));
  } catch (e) {
    return err(`xray_test_reality_live failed: ${(e as Error).message}`);
  }
}

async function suggestSniHandler(args: SuggestSniArgs): Promise<McpResponse> {
  if (!args.country_code) {
    return err(
      `Missing required parameter: country_code. Supported: ${listSupportedCountries().join(", ")}`,
    );
  }
  try {
    return json(suggestSniForCountry(args));
  } catch (e) {
    return err((e as Error).message);
  }
}

async function mergeHandler(args: { configs?: string[] }): Promise<McpResponse> {
  if (!Array.isArray(args.configs) || args.configs.length < 2) {
    return err("Need at least 2 configs in `configs[]`.");
  }
  try {
    const r = mergeConfigs(args.configs);
    return json(r);
  } catch (e) {
    return err((e as Error).message);
  }
}

export async function dispatch(
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpResponse> {
  switch (name) {
    case "xray_list_topics":
      return listTopics(args as { category?: string });
    case "xray_fetch_topic":
      return fetchTopicHandler(args as { slug?: string; force_offline?: boolean });
    case "xray_search":
      return searchHandler(args as { query?: string; max_results?: number });
    case "xray_validate_config":
      return validateHandler(args as { config?: string });
    case "xray_lint":
      return lintHandler(args as { config?: string });
    case "xray_geo_search":
      return geoSearchHandler(args as { query?: string; max_results?: number });
    case "xray_diff_protocols":
      return diffHandler(args as { a?: string; b?: string });
    case "xray_suggest_alternative":
      return suggestHandler(args as { goal?: string; current_config?: string });
    case "xray_merge_configs":
      return mergeHandler(args as { configs?: string[] });
    case "xray_generate_short_ids":
      return genShortIdsHandler(args as GenShortIdsArgs);
    case "xray_generate_reality_keypair":
      return genRealityKeypairHandler();
    case "xray_validate_sni_target":
      return validateSniHandler(args as ValidateSniArgs);
    case "xray_test_reality_live":
      return testRealityLiveHandler(args as TestRealityLiveArgs);
    case "xray_suggest_sni_for_country":
      return suggestSniHandler(args as SuggestSniArgs);
    case "xray_refresh_cache":
      return refreshHandler(args as RefreshArgs);
    case "xray_github_search":
      return githubSearchHandler(
        args as {
          query?: string;
          repo?: string;
          state?: string;
          type?: string;
          sort?: string;
          order?: string;
          max_results?: number;
        },
      );
    case "xray_github_fetch_issue":
      return githubFetchIssueHandler(
        args as { repo?: string; number?: number; type?: string; max_comments?: number },
      );
    default:
      return err(`Unknown tool: ${name}`);
  }
}
