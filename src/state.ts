/*
 * Global server state — process-wide, in-memory.
 *
 * Resolves the on-disk docs directory next to the package, lazily loads
 * the bundled `_index.json`, and caches Topic bodies after first read.
 *
 * This is the only module that knows the actual filesystem layout.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { parseFrontmatter } from "./utils.js";
import type { Topic, TopicMeta } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/* dist/state.js → ../data/docs/   (same layout when running from src via tsx). */
export const DOCS_DIR = path.resolve(here, "..", "data", "docs");
export const INDEX_FILE = path.join(DOCS_DIR, "_index.json");

interface State {
  index: TopicMeta[] | null;
  bodyCache: Map<string, Topic>;
}

const state: State = {
  index: null,
  bodyCache: new Map(),
};

export async function loadIndex(forceReload = false): Promise<TopicMeta[]> {
  if (state.index && !forceReload) return state.index;
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    state.index = Array.isArray(parsed) ? parsed : [];
  } catch {
    /* Bundle may be absent during first-time dev before fetch-docs ran. */
    state.index = [];
  }
  return state.index;
}

export async function saveIndex(index: TopicMeta[]): Promise<void> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  state.index = index;
}

export async function readTopic(slug: string): Promise<Topic | null> {
  const cached = state.bodyCache.get(slug);
  if (cached) return cached;

  const index = await loadIndex();
  const meta = index.find((m) => m.slug === slug);
  if (!meta) return null;

  const filePath = path.join(DOCS_DIR, meta.file);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const { meta: fm, body } = parseFrontmatter(raw);
  const topic: Topic = {
    ...meta,
    title: fm.title || meta.title,
    markdown: body,
  };
  state.bodyCache.set(slug, topic);
  return topic;
}

export async function writeTopic(topic: Topic, frontmatter: string): Promise<void> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  const filePath = path.join(DOCS_DIR, topic.file);
  await fs.writeFile(filePath, frontmatter + topic.markdown + "\n", "utf8");
  state.bodyCache.set(topic.slug, topic);
}

export function dropCache(slug?: string): void {
  if (slug) state.bodyCache.delete(slug);
  else state.bodyCache.clear();
}

export async function readAllTopics(): Promise<Topic[]> {
  const index = await loadIndex();
  const topics: Topic[] = [];
  for (const m of index) {
    const t = await readTopic(m.slug);
    if (t) topics.push(t);
  }
  return topics;
}
