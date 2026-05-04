# mcp-xray-pilot

[Русская версия ниже / Russian version below](#mcp-xray-pilot-ru)

A Model Context Protocol (MCP) server that gives an LLM offline access to the
official **xray-core** documentation, plus deep structural validation,
best-practice lint, a protocol/transport/security compatibility matrix, a
geosite/geoip catalogue, an alternative-stack suggester and a multi-config
merge helper.

## What it does

- **Bundles ~60 docs pages** from the upstream
  [`XTLS/Xray-docs-next`](https://github.com/XTLS/Xray-docs-next) repo as
  raw markdown (no html→md mess).
- **Refreshes on demand**: `xray_fetch_topic` tries the network first and
  silently overwrites the bundled cache on success. If you're offline (or
  upstream is down), it falls back to the packaged copy and surfaces a
  `warning` field.
- **Searches the corpus** with a tiny title/body relevance scorer.
- **Validates** xray JSON config: required top-level fields, per-protocol
  Zod schemas (vless / vmess / trojan / shadowsocks / socks / http /
  wireguard / hysteria / freedom / blackhole / dns / loopback / dokodemo /
  tun), per-transport `*Settings` schemas (raw / xhttp / grpc / ws / mkcp /
  httpupgrade / hysteria), TLS / REALITY security blocks, routing tag
  cross-references.
- **Lints** ~20 best-practice rules: VLESS `decryption: "none"`, REALITY
  pubkey/shortId/target syntax, XTLS vision flow compatibility, TLS
  fingerprint enum, ALPN collisions, geosite/geoip typo catcher, protocol
  × transport × security incompatibilities, `xhttp.path` leading slash,
  `geoip:private` block rule, sniffing on 80/443 etc.
- **Geo catalogue**: search ~500 known geoip/geosite tags by substring.
- **Compares protocols**: side-by-side table of vless/vmess/trojan/ss/
  hysteria2/wireguard on transports, security, anti-DPI, mobile, battery.
- **Recommends a stack** for a stated goal (anti-DPI in RU/IR/CN, low
  latency, mobile battery, high throughput, stealth-CDN, getting started).
- **Merges configs**: joins inbounds/outbounds/routing.rules from N JSON
  configs, auto-resolves tag collisions, warns on port collisions.

## Tools

| Tool                       | What it does                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `xray_list_topics`         | List doc topics, grouped by category. Use first to discover slugs.                    |
| `xray_fetch_topic`         | Fetch one topic as markdown. Network → fall back to bundled cache → update cache.     |
| `xray_search`              | Full-text search over all cached docs. Returns ranked hits + snippets.                |
| `xray_validate_config`     | Structural+schema validation of an xray JSON config (Zod under the hood).             |
| `xray_lint`                | ~20 best-practice lint rules. Returns issues with severity, rule id, JSON-pointer.    |
| `xray_geo_search`          | Substring search over the embedded geosite/geoip catalogue.                           |
| `xray_diff_protocols`      | Side-by-side feature table for two protocols.                                         |
| `xray_suggest_alternative` | Recommend protocol+transport+security for a goal (anti-DPI / battery / latency / …). |
| `xray_merge_configs`       | Merge N xray configs with tag-collision resolution and conflict warnings.             |
| `xray_github_search`       | Search issues/PRs/discussions across XTLS GitHub repos (Xray-core/REALITY/docs).      |
| `xray_github_fetch_issue`  | Fetch one issue/PR/discussion with full body + top comments.                          |
| `xray_refresh_cache`       | Bulk re-fetch cached docs (`scope: all/stale/category`). Optional `discover` for new upstream slugs. |

It also exposes a single MCP **resource**: `xray://docs/index` — the raw
`_index.json` of cached topics.

## Examples

### Example 1 — lint a broken cascade config

Prompt:

> Lint this xray config and tell me what's wrong.
>
> ```json
> {
>   "inbounds":[{"tag":"in1","port":443,"protocol":"vless","settings":{"clients":[{"id":"00000000-0000-4000-8000-000000000000","flow":"xtls-rprx-vision"}]},"streamSettings":{"network":"ws","security":"reality","realitySettings":{"target":"yandex.com","privateKey":"short","shortIds":["zz"],"serverNames":["yandex.com"],"fingerprint":"netscape"}}}],
>   "outbounds":[{"tag":"out","protocol":"freedom"}],
>   "routing":{"rules":[{"type":"field","outboundTag":"missing","domain":["geosite:tinkoff-bank"]}]}
> }
> ```

`xray_lint` response (excerpt):

```json
{
  "summary": { "error_count": 6, "warn_count": 5, "info_count": 2 },
  "issues": [
    { "rule": "reality_pubkey_format", "severity": "error",
      "path": "/inbounds/0/streamSettings/realitySettings/privateKey",
      "message": "REALITY privateKey must be 43 base64url chars, got 'short'" },
    { "rule": "reality_shortid_format", "severity": "error",
      "path": "/inbounds/0/streamSettings/realitySettings/shortIds/0",
      "message": "shortIds[0] 'zz' must be hex (0..16 chars, even length)" },
    { "rule": "flow_requires_specific_transport", "severity": "error",
      "path": "/inbounds/0/streamSettings/network",
      "message": "flow=xtls-rprx-vision requires raw/tcp transport, got 'ws'" },
    { "rule": "routing_dangling_outbound", "severity": "error",
      "path": "/routing/rules/0/outboundTag",
      "message": "outboundTag 'missing' does not match any outbound tag" },
    { "rule": "tls_fingerprint_enum", "severity": "warn",
      "path": "/inbounds/0/streamSettings/realitySettings/fingerprint",
      "message": "'netscape' is not a known fingerprint (chrome/firefox/safari/ios/android/edge/360/qq/random/randomized)" },
    { "rule": "geo_unknown_category", "severity": "warn",
      "path": "/routing/rules/0/domain/0",
      "message": "geosite:tinkoff-bank is not in the bundled catalogue (typo? try geosite:category-ru)" }
  ]
}
```

### Example 2 — research RKN bypass via GitHub

Prompt:

> Find recent xray issues about RKN/TSPU and suggest an anti-DPI stack for Russia.

Step 1 — `xray_github_search`:

```jsonc
// args
{ "query": "RKN", "type": "issue", "repo": "all", "sort": "updated" }
// response (excerpt)
{
  "total_count": 47,
  "items": [
    { "repo": "XTLS/Xray-core", "number": 5747, "state": "open",
      "title": "REALITY blocked by TSPU after recent RKN update",
      "comments": 38, "reactions": { "+1": 21 },
      "snippet": "Starting last week our REALITY inbound on :443 stops responding after ~30s of traffic from RU clients. xhttp+REALITY survives longer than raw+vision…" },
    { "repo": "XTLS/Xray-core", "number": 5332, "state": "closed",
      "title": "RKN: shortId enumeration probe",
      "comments": 22,
      "snippet": "TSPU appears to brute-force shortIds. Recommendation: rotate, keep list >=4 entries, do not include empty string…" }
  ]
}
```

Step 2 — `xray_suggest_alternative`:

```jsonc
// args
{ "goal": "anti-dpi-russia" }
// response (excerpt)
{
  "recommendation": {
    "protocol": "vless",
    "transport": "xhttp",
    "security": "reality",
    "flow": null,
    "rationale": [
      "xhttp survives TSPU active probing better than raw/tcp+vision in 2025",
      "REALITY hides SNI; pick a target popular in RU (yandex.com, mail.ru)",
      "Rotate shortIds[] (>=4 entries, hex, no empty string)",
      "Keep packet padding default; do not enable kcp on top of REALITY"
    ]
  },
  "see_also": ["xray_fetch_topic transports/xhttp", "xray_fetch_topic features/reality"]
}
```

## Install

```bash
npm i -g mcp-xray-pilot
```

Or run from source:

```bash
git clone https://github.com/beekamai/mcp-xray-pilot.git
cd mcp-xray-pilot
npm install
npm run build
npm run fetch-docs    # fills data/docs/ if you cloned without it
```

## Add to Claude Code

```bash
claude mcp add xray-pilot --scope user -- npx -y mcp-xray-pilot
```

With a GitHub PAT (raises `xray_github_*` rate limit, enables discussions):

```bash
claude mcp add xray-pilot --scope user --env GITHUB_TOKEN=ghp_xxx -- npx -y mcp-xray-pilot
```

Or, from a local clone:

```bash
claude mcp add xray-pilot --scope user -- node /absolute/path/to/mcp-xray-pilot/dist/index.js
```

## Add to Cursor / Windsurf / Cline

```jsonc
{
  "mcpServers": {
    "xray-pilot": {
      "command": "npx",
      "args": ["-y", "mcp-xray-pilot"]
    }
  }
}
```

## Offline cache vs. online refresh

The `data/docs/` directory ships with the package. Each call to
`xray_fetch_topic`:

1. If `force_offline=true` → reads only the packaged copy.
2. Otherwise → tries the upstream raw markdown URL (10s timeout). On HTTP
   200, the response body replaces the on-disk markdown and the index
   entry's `fetched_at` is updated. Subsequent calls in the same process
   serve from in-memory cache.
3. On any network failure → falls back to the packaged copy, returning the
   markdown plus `warning: "network fetch failed: …"`.

To refresh everything in bulk, run `npm run fetch-docs -- --refresh`. To
discover newly-added pages upstream without writing them: `npm run
fetch-docs -- --discover`.

### Keeping cache fresh

There are three complementary ways to keep `data/docs/` aligned with
upstream:

1. **On-demand per page** — every `xray_fetch_topic` call already tries
   the network first and silently overwrites the on-disk copy on success.
   No action needed.
2. **Bulk via MCP tool** — call `xray_refresh_cache` from the LLM:
   - `{ "scope": "stale", "max_age_days": 30 }` (default) re-fetches only
     entries older than N days.
   - `{ "scope": "all" }` re-fetches every page (~60).
   - `{ "scope": "category", "category": "transports" }` restricts to one
     category.
   - Add `"discover": true` to also report slugs that exist upstream but
     are missing from `DOCS_CATALOGUE` in `src/docs.ts`.
3. **CI weekly cron** — `.github/workflows/refresh-docs.yml` runs
   `npm run fetch-docs -- --refresh` every Monday 06:00 UTC and opens a
   PR if anything changed (also triggerable manually via `workflow_dispatch`).

## Optional `GITHUB_TOKEN` env variable

`xray_github_search` and `xray_github_fetch_issue` work anonymously, but
the GitHub API caps unauthenticated requests at **60/hour**. Setting
`GITHUB_TOKEN` to any classic or fine-grained PAT (no scopes needed for
public repos) raises the limit to **5000/hour** and additionally enables
the **discussions** endpoint (GraphQL), which has no anonymous access.

```bash
export GITHUB_TOKEN=ghp_xxx           # Linux / macOS
$env:GITHUB_TOKEN = "ghp_xxx"         # PowerShell
```

When `X-RateLimit-Remaining` drops below 10, the tool surfaces an inline
warning in the response.

## Roadmap

See [ROADMAP.md](./ROADMAP.md). All v0.1–v0.10 milestones are checked off.

## License

MIT.

---

<a id="mcp-xray-pilot-ru"></a>

# mcp-xray-pilot (RU)

MCP-сервер, дающий LLM офлайн-доступ к официальной документации **xray-core**,
плюс глубокую валидацию по схемам, lint best-practice, матрицу
совместимости протоколов/транспортов/security, каталог geosite/geoip,
рекомендатор альтернативного стека и helper для слияния конфигов.

## Что делает

- **Упаковывает ~60 страниц** документации из upstream-репозитория
  [`XTLS/Xray-docs-next`](https://github.com/XTLS/Xray-docs-next) как
  raw markdown (без html→md мусора).
- **Обновляется по запросу**: `xray_fetch_topic` сначала идёт в сеть и при
  успехе молча перезаписывает упакованный кеш. Если оффлайн (или upstream
  лёг), возвращает упакованную копию и выставляет `warning`.
- **Поиск по корпусу** простым title/body relevance scorer.
- **Валидирует** xray JSON: обязательные top-level поля, per-protocol
  Zod-схемы (vless / vmess / trojan / shadowsocks / socks / http /
  wireguard / hysteria / freedom / blackhole / dns / loopback / dokodemo /
  tun), per-transport `*Settings` (raw / xhttp / grpc / ws / mkcp /
  httpupgrade / hysteria), security блоки TLS/REALITY, routing tag
  cross-references.
- **Lint** ~20 правил: VLESS `decryption: "none"`, REALITY pubkey/shortId/
  target syntax, XTLS vision flow compatibility, TLS fingerprint enum,
  ALPN collisions, geo typo catcher, protocol × transport × security
  несовместимости, `xhttp.path` слеш, `geoip:private` block, sniffing на
  80/443 и т.д.
- **Geo catalogue**: поиск по ~500 известным geoip/geosite тегам.
- **Сравнение протоколов**: таблица vless/vmess/trojan/ss/hysteria2/
  wireguard по transports, security, anti-DPI, mobile, battery.
- **Рекомендует стек** под цель (anti-DPI в РФ/Иране/КНР, low-latency,
  mobile-battery, high-throughput, stealth-CDN, getting started).
- **Сливает конфиги**: объединяет inbounds/outbounds/routing.rules из N
  JSON конфигов, авто-резолвит коллизии тегов, варнит на коллизиях портов.

## Тулы

| Тул                        | Что делает                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `xray_list_topics`         | Список тем по категориям. Дёргать первым.                                               |
| `xray_fetch_topic`         | Получить тему как markdown. Сеть → fallback на кеш → обновление кеша.                   |
| `xray_search`              | Полнотекстовый поиск по докам. Хиты + сниппеты.                                         |
| `xray_validate_config`     | Структурная валидация + Zod-схемы по протоколу/transport/security.                      |
| `xray_lint`                | ~20 правил best-practice. Issues с severity, rule id, JSON-pointer.                     |
| `xray_geo_search`          | Поиск по embedded каталогу geosite/geoip по подстроке.                                  |
| `xray_diff_protocols`      | Side-by-side таблица фич двух протоколов.                                               |
| `xray_suggest_alternative` | Рекомендация protocol+transport+security под цель.                                      |
| `xray_merge_configs`       | Слить N конфигов с разрешением коллизий тегов.                                          |
| `xray_github_search`       | Поиск issues/PR/discussions по XTLS GitHub репозиториям.                                |
| `xray_github_fetch_issue`  | Получить одну issue/PR/discussion с полным body + топ комментариев.                     |
| `xray_refresh_cache`       | Bulk перезатяжка кеша доков (`scope: all/stale/category`). Опц. `discover` для новых slug'ов. |

Также один MCP **ресурс**: `xray://docs/index`.

## Примеры

### Пример 1 — линт сломанного каскадного конфига

Промпт:

> Прогони линт по этому xray конфигу и скажи что не так.
>
> ```json
> {
>   "inbounds":[{"tag":"in1","port":443,"protocol":"vless","settings":{"clients":[{"id":"00000000-0000-4000-8000-000000000000","flow":"xtls-rprx-vision"}]},"streamSettings":{"network":"ws","security":"reality","realitySettings":{"target":"yandex.com","privateKey":"short","shortIds":["zz"],"serverNames":["yandex.com"],"fingerprint":"netscape"}}}],
>   "outbounds":[{"tag":"out","protocol":"freedom"}],
>   "routing":{"rules":[{"type":"field","outboundTag":"missing","domain":["geosite:tinkoff-bank"]}]}
> }
> ```

Ответ `xray_lint` (выжимка):

```json
{
  "summary": { "error_count": 6, "warn_count": 5, "info_count": 2 },
  "issues": [
    { "rule": "reality_pubkey_format", "severity": "error",
      "path": "/inbounds/0/streamSettings/realitySettings/privateKey",
      "message": "REALITY privateKey must be 43 base64url chars, got 'short'" },
    { "rule": "reality_shortid_format", "severity": "error",
      "path": "/inbounds/0/streamSettings/realitySettings/shortIds/0",
      "message": "shortIds[0] 'zz' must be hex (0..16 chars, even length)" },
    { "rule": "flow_requires_specific_transport", "severity": "error",
      "path": "/inbounds/0/streamSettings/network",
      "message": "flow=xtls-rprx-vision requires raw/tcp transport, got 'ws'" },
    { "rule": "routing_dangling_outbound", "severity": "error",
      "path": "/routing/rules/0/outboundTag",
      "message": "outboundTag 'missing' does not match any outbound tag" },
    { "rule": "tls_fingerprint_enum", "severity": "warn",
      "path": "/inbounds/0/streamSettings/realitySettings/fingerprint",
      "message": "'netscape' is not a known fingerprint (chrome/firefox/safari/ios/android/edge/360/qq/random/randomized)" },
    { "rule": "geo_unknown_category", "severity": "warn",
      "path": "/routing/rules/0/domain/0",
      "message": "geosite:tinkoff-bank is not in the bundled catalogue (typo? try geosite:category-ru)" }
  ]
}
```

### Пример 2 — ресёрч обхода РКН через GitHub

Промпт:

> Найди свежие xray issues про РКН/ТСПУ и предложи anti-DPI стек под Россию.

Шаг 1 — `xray_github_search`:

```jsonc
// args
{ "query": "RKN", "type": "issue", "repo": "all", "sort": "updated" }
// response (выжимка)
{
  "total_count": 47,
  "items": [
    { "repo": "XTLS/Xray-core", "number": 5747, "state": "open",
      "title": "REALITY blocked by TSPU after recent RKN update",
      "comments": 38, "reactions": { "+1": 21 },
      "snippet": "Starting last week our REALITY inbound on :443 stops responding after ~30s of traffic from RU clients. xhttp+REALITY survives longer than raw+vision…" },
    { "repo": "XTLS/Xray-core", "number": 5332, "state": "closed",
      "title": "RKN: shortId enumeration probe",
      "comments": 22,
      "snippet": "TSPU appears to brute-force shortIds. Recommendation: rotate, keep list >=4 entries, do not include empty string…" }
  ]
}
```

Шаг 2 — `xray_suggest_alternative`:

```jsonc
// args
{ "goal": "anti-dpi-russia" }
// response (выжимка)
{
  "recommendation": {
    "protocol": "vless",
    "transport": "xhttp",
    "security": "reality",
    "flow": null,
    "rationale": [
      "xhttp survives TSPU active probing better than raw/tcp+vision in 2025",
      "REALITY hides SNI; pick a target popular in RU (yandex.com, mail.ru)",
      "Rotate shortIds[] (>=4 entries, hex, no empty string)",
      "Keep packet padding default; do not enable kcp on top of REALITY"
    ]
  },
  "see_also": ["xray_fetch_topic transports/xhttp", "xray_fetch_topic features/reality"]
}
```

## Установка

```bash
npm i -g mcp-xray-pilot
```

Или из исходников:

```bash
git clone https://github.com/beekamai/mcp-xray-pilot.git
cd mcp-xray-pilot
npm install
npm run build
npm run fetch-docs
```

## Подключить к Claude Code

```bash
claude mcp add xray-pilot --scope user -- npx -y mcp-xray-pilot
```

С GitHub PAT (поднимает rate-limit `xray_github_*`, включает discussions):

```bash
claude mcp add xray-pilot --scope user --env GITHUB_TOKEN=ghp_xxx -- npx -y mcp-xray-pilot
```

Или из локального клона:

```bash
claude mcp add xray-pilot --scope user -- node /absolute/path/to/mcp-xray-pilot/dist/index.js
```

## Офлайн-кеш vs онлайн-обновление

Папка `data/docs/` едет в пакете. Каждый вызов `xray_fetch_topic`:

1. При `force_offline=true` → читает только упакованную копию.
2. Иначе → пробует upstream raw URL (10s таймаут). При HTTP 200 ответ
   перезаписывает markdown на диске, `fetched_at` обновляется. Последующие
   вызовы в том же процессе отдаются из in-memory кеша.
3. При любой сетевой ошибке → fallback на упакованную копию, возвращает
   markdown плюс `warning: "network fetch failed: …"`.

Bulk-обновление — `npm run fetch-docs -- --refresh`. Discover новых
страниц в upstream без записи — `npm run fetch-docs -- --discover`.

### Поддержание кеша актуальным

Три способа держать `data/docs/` в синхроне с upstream:

1. **На каждый запрос** — `xray_fetch_topic` сам ходит в сеть и при HTTP
   200 перезаписывает on-disk копию. Ничего делать не надо.
2. **Bulk через MCP-тул** — позови `xray_refresh_cache`:
   - `{ "scope": "stale", "max_age_days": 30 }` (default) — только
     устаревшие старше N дней.
   - `{ "scope": "all" }` — все ~60 страниц.
   - `{ "scope": "category", "category": "transports" }` — одна категория.
   - `"discover": true` — дополнительно вернёт список slug'ов, которые
     появились upstream, но отсутствуют в `DOCS_CATALOGUE` (`src/docs.ts`).
3. **CI weekly cron** — `.github/workflows/refresh-docs.yml` каждый
   понедельник 06:00 UTC гоняет `npm run fetch-docs -- --refresh` и
   открывает PR если что-то поменялось (есть `workflow_dispatch` для
   ручного триггера).

## Опциональный `GITHUB_TOKEN`

`xray_github_search` и `xray_github_fetch_issue` работают анонимно, но
GitHub API лимитирует unauth запросы **60/час**. Установка `GITHUB_TOKEN`
(любой classic или fine-grained PAT, для публичных репо scope не нужен)
поднимает лимит до **5000/час** и дополнительно включает поиск/чтение
**discussions** (GraphQL, у него нет anon-доступа).

```bash
export GITHUB_TOKEN=ghp_xxx           # Linux / macOS
$env:GITHUB_TOKEN = "ghp_xxx"         # PowerShell
```

Когда `X-RateLimit-Remaining` падает ниже 10, тул возвращает inline-warning
в ответе.

## Roadmap

См. [ROADMAP.md](./ROADMAP.md) — все вехи v0.1–v0.10 закрыты.

## Лицензия

MIT.
