/*
 * xray_github_search + xray_github_fetch_issue.
 *
 * Thin wrapper over the GitHub REST search API for issues/PRs and the
 * GraphQL endpoint for discussions. No third-party deps — node 18+ ships
 * `fetch` natively.
 *
 * Auth: optional. If `process.env.GITHUB_TOKEN` is set, it is sent as
 * `Authorization: Bearer …` which raises the unauth rate limit from 60/h
 * to 5000/h and is *required* for discussions (GraphQL).
 *
 * Rate-limit warnings are surfaced inline in the response when
 * `X-RateLimit-Remaining` < 10.
 */

const USER_AGENT = "mcp-xray-pilot/0.10";

const REPO_MAP = {
  "xray-core": "XTLS/Xray-core",
  reality: "XTLS/REALITY",
  "xray-docs-next": "XTLS/Xray-docs-next",
} as const;

export type RepoKey = keyof typeof REPO_MAP;
export type RepoKeyOrAll = RepoKey | "all";

type IssueType = "issue" | "pr" | "discussion" | "all";
type StateFilter = "open" | "closed" | "all";
type SortBy = "updated" | "created" | "reactions" | "comments";
type Order = "desc" | "asc";

export interface SearchParams {
  query: string;
  repo?: RepoKeyOrAll;
  state?: StateFilter;
  type?: IssueType;
  sort?: SortBy;
  order?: Order;
  max_results?: number;
}

export interface SearchHit {
  repo: string;
  type: "issue" | "pr" | "discussion";
  number: number;
  title: string;
  state: string;
  url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  reactions: number;
  author: string;
  body_snippet: string;
}

export interface SearchResult {
  query: string;
  total: number;
  truncated: boolean;
  warnings?: string[];
  hits: SearchHit[];
}

export interface FetchIssueParams {
  repo?: RepoKey;
  number: number;
  type?: "issue" | "pr" | "discussion";
  max_comments?: number;
}

export interface IssueComment {
  author: string;
  created_at: string;
  body: string;
}

export interface FetchIssueResult {
  repo: string;
  type: string;
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  created_at: string;
  updated_at: string;
  body: string;
  reactions: Record<string, number>;
  comments: IssueComment[];
  warnings?: string[];
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const tok = process.env.GITHUB_TOKEN;
  if (tok && tok.trim()) h.Authorization = `Bearer ${tok.trim()}`;
  return h;
}

function rateLimitWarning(res: Response): string | null {
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "");
  if (Number.isFinite(remaining) && remaining < 10) {
    const reset = res.headers.get("x-ratelimit-reset");
    const hint = process.env.GITHUB_TOKEN
      ? ""
      : " (set GITHUB_TOKEN env var to raise limit from 60/h to 5000/h)";
    return `GitHub rate limit nearly exhausted: ${remaining} remaining (resets at unix=${reset})${hint}`;
  }
  return null;
}

function snippet(body: string | null | undefined, n = 240): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}

function sumReactions(reactions: Record<string, unknown> | undefined | null): number {
  if (!reactions) return 0;
  const total = (reactions as Record<string, unknown>).total_count;
  if (typeof total === "number") return total;
  let s = 0;
  for (const [k, v] of Object.entries(reactions)) {
    if (k === "url") continue;
    if (typeof v === "number") s += v;
  }
  return s;
}

async function ghJson(
  url: string,
): Promise<{ data: unknown; warning: string | null; status: number; raw: Response }> {
  const res = await fetch(url, { headers: authHeaders() });
  const warning = rateLimitWarning(res);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 403) {
      hint = process.env.GITHUB_TOKEN
        ? " (token may lack scope or be invalid)"
        : " — likely rate limit; set GITHUB_TOKEN env var to raise to 5000/h";
    } else if (res.status === 404) {
      hint = " — repo or item does not exist";
    }
    throw new Error(
      `GitHub API ${res.status} ${res.statusText} for ${url}${hint}\n${txt.slice(0, 300)}`,
    );
  }
  const data = await res.json();
  return { data, warning, status: res.status, raw: res };
}

async function ghGraphQL(query: string, variables: Record<string, unknown>): Promise<unknown> {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(
      "GitHub Discussions require a GITHUB_TOKEN env variable (GraphQL API has no anonymous access)",
    );
  }
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length) {
    throw new Error(`GitHub GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data;
}

/* ---------- search: issues/PRs via REST ---------- */

interface IssueSearchItem {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  body?: string | null;
  user?: { login?: string } | null;
  pull_request?: unknown;
  reactions?: Record<string, unknown>;
  repository_url?: string;
}

function repoFromUrl(repoUrl: string | undefined, fallback: string): string {
  if (!repoUrl) return fallback;
  /* repository_url shape: https://api.github.com/repos/OWNER/NAME */
  const m = repoUrl.match(/repos\/([^/]+\/[^/]+)$/);
  return m ? m[1] : fallback;
}

async function searchIssuesOneRepo(
  repoFull: string,
  params: SearchParams,
): Promise<{ items: SearchHit[]; total: number; warning: string | null }> {
  const qParts = [params.query.trim(), `repo:${repoFull}`];
  if (params.type === "issue") qParts.push("is:issue");
  else if (params.type === "pr") qParts.push("is:pr");
  if (params.state && params.state !== "all") qParts.push(`state:${params.state}`);
  const q = qParts.join(" ");
  const per = Math.min(params.max_results ?? 10, 50);
  const sort = params.sort ?? "updated";
  const order = params.order ?? "desc";
  const url =
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}` +
    `&sort=${sort}&order=${order}&per_page=${per}`;
  const { data, warning } = await ghJson(url);
  const d = data as { total_count: number; items: IssueSearchItem[] };
  const hits: SearchHit[] = (d.items || []).map((it) => ({
    repo: repoFromUrl(it.repository_url, repoFull),
    type: it.pull_request ? "pr" : "issue",
    number: it.number,
    title: it.title,
    state: it.state,
    url: it.html_url,
    created_at: it.created_at,
    updated_at: it.updated_at,
    comments: it.comments,
    reactions: sumReactions(it.reactions),
    author: it.user?.login ?? "unknown",
    body_snippet: snippet(it.body ?? ""),
  }));
  return { items: hits, total: d.total_count ?? hits.length, warning };
}

/* ---------- search: discussions via GraphQL ---------- */

interface GqlDiscussionNode {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  bodyText?: string;
  comments?: { totalCount: number };
  reactions?: { totalCount: number };
  author?: { login?: string } | null;
  repository?: { nameWithOwner: string };
  closed?: boolean;
}

async function searchDiscussionsOneRepo(
  repoFull: string,
  params: SearchParams,
): Promise<{ items: SearchHit[]; total: number }> {
  const per = Math.min(params.max_results ?? 10, 50);
  const stateFilter =
    params.state === "open" ? " is:open" : params.state === "closed" ? " is:closed" : "";
  const q = `${params.query.trim()} repo:${repoFull}${stateFilter}`;
  const query = `
    query($q: String!, $first: Int!) {
      search(query: $q, type: DISCUSSION, first: $first) {
        discussionCount
        nodes {
          ... on Discussion {
            number
            title
            url
            createdAt
            updatedAt
            bodyText
            closed
            comments { totalCount }
            reactions { totalCount }
            author { login }
            repository { nameWithOwner }
          }
        }
      }
    }`;
  const data = (await ghGraphQL(query, { q, first: per })) as {
    search: { discussionCount: number; nodes: GqlDiscussionNode[] };
  };
  const nodes = data.search?.nodes ?? [];
  const items: SearchHit[] = nodes.map((n) => ({
    repo: n.repository?.nameWithOwner ?? repoFull,
    type: "discussion",
    number: n.number,
    title: n.title,
    state: n.closed ? "closed" : "open",
    url: n.url,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    comments: n.comments?.totalCount ?? 0,
    reactions: n.reactions?.totalCount ?? 0,
    author: n.author?.login ?? "unknown",
    body_snippet: snippet(n.bodyText ?? ""),
  }));
  return { items, total: data.search?.discussionCount ?? items.length };
}

export async function searchGithub(params: SearchParams): Promise<SearchResult> {
  if (!params.query || !params.query.trim()) {
    throw new Error("`query` is required");
  }
  const repoKey: RepoKeyOrAll = params.repo ?? "xray-core";
  const type: IssueType = params.type ?? "all";
  const repos: RepoKey[] =
    repoKey === "all" ? (Object.keys(REPO_MAP) as RepoKey[]) : [repoKey as RepoKey];
  const warnings: string[] = [];

  const tasks: Array<Promise<{ items: SearchHit[]; total: number }>> = [];

  for (const r of repos) {
    const repoFull = REPO_MAP[r];
    if (type === "discussion") {
      tasks.push(searchDiscussionsOneRepo(repoFull, params));
    } else if (type === "all") {
      tasks.push(
        searchIssuesOneRepo(repoFull, params).then((x) => {
          if (x.warning) warnings.push(x.warning);
          return { items: x.items, total: x.total };
        }),
      );
      /* discussions only if we have a token; otherwise skip silently with warn */
      if (process.env.GITHUB_TOKEN) {
        tasks.push(
          searchDiscussionsOneRepo(repoFull, params).catch((e) => {
            warnings.push(`discussion search failed for ${repoFull}: ${(e as Error).message}`);
            return { items: [] as SearchHit[], total: 0 };
          }),
        );
      } else {
        warnings.push(
          `discussions skipped for ${repoFull} (no GITHUB_TOKEN; GraphQL needs auth)`,
        );
      }
    } else {
      tasks.push(
        searchIssuesOneRepo(repoFull, params).then((x) => {
          if (x.warning) warnings.push(x.warning);
          return { items: x.items, total: x.total };
        }),
      );
    }
  }

  const results = await Promise.all(tasks);
  let allHits: SearchHit[] = [];
  let totalSum = 0;
  for (const r of results) {
    allHits = allHits.concat(r.items);
    totalSum += r.total;
  }

  /* Sort merged across repos. Default sort=updated desc. */
  const sortKey = params.sort ?? "updated";
  const order = params.order ?? "desc";
  const dir = order === "asc" ? 1 : -1;
  allHits.sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    if (sortKey === "updated") {
      av = a.updated_at;
      bv = b.updated_at;
    } else if (sortKey === "created") {
      av = a.created_at;
      bv = b.created_at;
    } else if (sortKey === "comments") {
      av = a.comments;
      bv = b.comments;
    } else if (sortKey === "reactions") {
      av = a.reactions;
      bv = b.reactions;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const limit = params.max_results ?? 10;
  const truncated = allHits.length > limit;
  if (truncated) allHits = allHits.slice(0, limit);

  return {
    query: params.query,
    total: totalSum,
    truncated,
    warnings: warnings.length ? warnings : undefined,
    hits: allHits,
  };
}

/* ---------- fetch single issue/PR/discussion ---------- */

interface IssueFull {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string | null;
  user?: { login?: string } | null;
  created_at: string;
  updated_at: string;
  reactions?: Record<string, unknown>;
  pull_request?: unknown;
}

interface IssueCommentRest {
  user?: { login?: string } | null;
  created_at: string;
  body?: string | null;
}

function reactionsObject(raw: Record<string, unknown> | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  const map: Record<string, string> = {
    "+1": "thumbs_up",
    "-1": "thumbs_down",
    laugh: "laugh",
    hooray: "hooray",
    confused: "confused",
    heart: "heart",
    rocket: "rocket",
    eyes: "eyes",
    total_count: "total",
  };
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "number") continue;
    const mapped = map[k] ?? k;
    out[mapped] = v;
  }
  return out;
}

async function fetchIssueRest(
  repoFull: string,
  num: number,
  maxComments: number,
): Promise<FetchIssueResult> {
  const issueUrl = `https://api.github.com/repos/${repoFull}/issues/${num}`;
  const { data, warning } = await ghJson(issueUrl);
  const issue = data as IssueFull;
  const warnings: string[] = [];
  if (warning) warnings.push(warning);

  let comments: IssueComment[] = [];
  if (maxComments > 0) {
    const cUrl = `${issueUrl}/comments?per_page=${Math.min(maxComments, 50)}`;
    const { data: cData, warning: cWarn } = await ghJson(cUrl);
    if (cWarn) warnings.push(cWarn);
    const arr = cData as IssueCommentRest[];
    comments = arr.map((c) => ({
      author: c.user?.login ?? "unknown",
      created_at: c.created_at,
      body: c.body ?? "",
    }));
  }

  return {
    repo: repoFull,
    type: issue.pull_request ? "pr" : "issue",
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    author: issue.user?.login ?? "unknown",
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    body: issue.body ?? "",
    reactions: reactionsObject(issue.reactions),
    comments,
    warnings: warnings.length ? warnings : undefined,
  };
}

async function fetchDiscussionGraphQL(
  repoFull: string,
  num: number,
  maxComments: number,
): Promise<FetchIssueResult> {
  const [owner, name] = repoFull.split("/");
  const first = Math.max(0, Math.min(maxComments, 50));
  const query = `
    query($owner: String!, $name: String!, $num: Int!, $first: Int!) {
      repository(owner: $owner, name: $name) {
        discussion(number: $num) {
          number
          title
          url
          body
          createdAt
          updatedAt
          closed
          author { login }
          reactionGroups { content reactors { totalCount } }
          comments(first: $first) {
            nodes {
              author { login }
              createdAt
              body
            }
          }
        }
      }
    }`;
  const data = (await ghGraphQL(query, { owner, name, num, first })) as {
    repository: {
      discussion: {
        number: number;
        title: string;
        url: string;
        body: string;
        createdAt: string;
        updatedAt: string;
        closed: boolean;
        author?: { login?: string } | null;
        reactionGroups?: Array<{ content: string; reactors: { totalCount: number } }>;
        comments?: { nodes: Array<{ author?: { login?: string } | null; createdAt: string; body: string }> };
      } | null;
    };
  };
  const d = data.repository?.discussion;
  if (!d) throw new Error(`Discussion #${num} not found in ${repoFull}`);
  const reactions: Record<string, number> = {};
  const reactionMap: Record<string, string> = {
    THUMBS_UP: "thumbs_up",
    THUMBS_DOWN: "thumbs_down",
    LAUGH: "laugh",
    HOORAY: "hooray",
    CONFUSED: "confused",
    HEART: "heart",
    ROCKET: "rocket",
    EYES: "eyes",
  };
  let total = 0;
  for (const g of d.reactionGroups ?? []) {
    const k = reactionMap[g.content] ?? g.content.toLowerCase();
    reactions[k] = g.reactors.totalCount;
    total += g.reactors.totalCount;
  }
  reactions.total = total;
  const comments: IssueComment[] = (d.comments?.nodes ?? []).map((c) => ({
    author: c.author?.login ?? "unknown",
    created_at: c.createdAt,
    body: c.body ?? "",
  }));
  return {
    repo: repoFull,
    type: "discussion",
    number: d.number,
    title: d.title,
    state: d.closed ? "closed" : "open",
    url: d.url,
    author: d.author?.login ?? "unknown",
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    body: d.body ?? "",
    reactions,
    comments,
  };
}

export async function fetchGithubIssue(params: FetchIssueParams): Promise<FetchIssueResult> {
  if (typeof params.number !== "number" || !Number.isFinite(params.number)) {
    throw new Error("`number` is required and must be a positive integer");
  }
  const repoKey: RepoKey = params.repo ?? "xray-core";
  const repoFull = REPO_MAP[repoKey];
  if (!repoFull) throw new Error(`Unknown repo: ${repoKey}`);
  const type = params.type ?? "issue";
  const maxComments = params.max_comments ?? 10;

  if (type === "discussion") {
    return fetchDiscussionGraphQL(repoFull, params.number, maxComments);
  }
  return fetchIssueRest(repoFull, params.number, maxComments);
}
