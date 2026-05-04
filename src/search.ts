/*
 * Tiny full-text search over cached docs.
 *
 * Approach: tokenise both query and docs, score by:
 *   - exact phrase hits in body          ×10
 *   - exact phrase hit in title          ×25
 *   - per-token frequency in body        ×1
 *   - per-token hit in title             ×5
 * No stemming, no IDF — the corpus is small (~50 docs) and the query is
 * usually 1-3 keywords. Returns top N hits with snippets.
 */

import { readAllTopics } from "./state.js";
import { snippet } from "./utils.js";
import type { SearchHit, Topic } from "./types.js";

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

function scoreTopic(topic: Topic, query: string, tokens: string[]): number {
  const titleLower = topic.title.toLowerCase();
  const bodyLower = topic.markdown.toLowerCase();
  const phrase = query.trim().toLowerCase();

  let score = 0;
  if (phrase.length >= 2) {
    if (titleLower.includes(phrase)) score += 25;
    /* count phrase occurrences in body, capped at 5 to avoid runaway. */
    let from = 0;
    let phraseHits = 0;
    while (phraseHits < 5) {
      const i = bodyLower.indexOf(phrase, from);
      if (i < 0) break;
      phraseHits++;
      from = i + phrase.length;
    }
    score += phraseHits * 10;
  }

  for (const t of tokens) {
    if (titleLower.includes(t)) score += 5;
    /* token frequency in body. */
    let from = 0;
    let hits = 0;
    while (hits < 50) {
      const i = bodyLower.indexOf(t, from);
      if (i < 0) break;
      hits++;
      from = i + t.length;
    }
    score += hits;
  }

  return score;
}

export async function search(
  query: string,
  maxResults = 10,
): Promise<SearchHit[]> {
  const tokens = tokenise(query);
  if (tokens.length === 0 && query.trim().length < 2) return [];

  const topics = await readAllTopics();
  const scored: SearchHit[] = [];
  for (const t of topics) {
    const s = scoreTopic(t, query, tokens);
    if (s <= 0) continue;
    scored.push({
      slug: t.slug,
      title: t.title,
      category: t.category,
      score: s,
      snippet: snippet(t.markdown, query, 240),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, maxResults));
}
