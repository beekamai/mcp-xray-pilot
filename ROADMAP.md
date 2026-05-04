# Roadmap

Incremental plan for deepening `xray_validate_config` and `xray_lint`.

## v0.1 — done

- 53 docs pages cached offline (`data/docs/`).
- Tools: `xray_list_topics`, `xray_fetch_topic` (online + offline fallback),
  `xray_search`, `xray_validate_config`, `xray_lint`.
- Validation: JSON parse, required `inbounds[]`/`outbounds[]`, known protocol
  enums, basic types of `port`/`listen`/`settings.clients`, routing tag
  cross-references, `outboundTag` ⊥ `balancerTag`, `type === "field"` warning.
- Lint: 10 rules covering VLESS decryption, REALITY shortIds/target, DNS
  outbound vs `dns.servers`, dangling tags, geosite/geoip + domainStrategy,
  xhttp leading slash, `geoip:private` block, sniffing on 80/443.

## v0.2 — done (Phase 0 + Phase 1)

- ✅ Documentation source switched from `xtls.github.io/en/config/*.html`
  parsed via turndown to **raw markdown** in
  `XTLS/Xray-docs-next/main/docs/en/config/*.md`. Drops the html→md mess
  (anchor permalinks, code-block language on its own line, zero-width spaces).
- ✅ `turndown` and `node-html-parser` removed from dependencies.
- ✅ Catalogue grew from 53 to 59 pages (added `dokodemo`, `tcp`, `splithttp`,
  `h2`, `http`, `quic` from upstream).
- ✅ Per-protocol Zod schemas for **VLESS / VMess / Trojan / Shadowsocks /
  SOCKS / HTTP / WireGuard / Hysteria(2) / dokodemo-door / TUN / Freedom /
  Blackhole / DNS / Loopback** (inbound + outbound).
- ✅ `xray_validate_config` deep-validates `settings` per protocol via Zod,
  surfacing per-field errors with JSON-pointer paths.

## v0.3 — done (Phase 2)

- ✅ Schemas for `streamSettings.network` ∈
  `{ raw, tcp, xhttp, splithttp, grpc, ws, websocket, kcp/mkcp, httpupgrade,
  hysteria }` and the matching `*Settings` blocks.
- ✅ Cross-network leftover detection: warns when `wsSettings` is set but
  `network` is `xhttp`, etc.

## v0.4 — done (Phase 3)

- ✅ REALITY: `target`/`dest` host:port grammar; `serverNames[]` non-empty;
  `privateKey`/`publicKey` length (43 chars base64url, no padding);
  `shortIds[]` hex 0..16 chars (even length); `fingerprint` enum.
- ✅ XTLS `flow="xtls-rprx-vision"` only with `raw`/`tcp` + `tls`/`reality`.
- ✅ TLS fingerprint enum (chrome/firefox/safari/ios/android/edge/360/qq/
  random/randomized/unsafe).
- ✅ ALPN value validation + collision hints (xhttp without h2/h3, grpc with
  http/1.1).
- ✅ Cross-security leftover detection (`security="tls"` but `realitySettings`
  present, etc).

## v0.5 — done (Phase 4)

- ✅ Embedded geosite/geoip catalogue: ~250 ISO country codes (geoip:xx +
  geosite:geolocation-xx), special tags (private, tor, telegram, …) and
  ~80 well-known domain lists (apple, youtube, openai, category-ru, …).
- ✅ Lint rule `geo_unknown_category` warns on typos.
- ✅ New tool `xray_geo_search` for substring lookup.

## v0.6 — done (Phase 5)

- ✅ Compatibility matrix: per-protocol allowed transports, security, flow
  requirements (data/compatibility.ts).
- ✅ Lint rules:
  - `incompatible_protocol_security` (e.g. shadowsocks+reality)
  - `incompatible_protocol_transport` (e.g. trojan+kcp)
  - `flow_requires_specific_transport` (vision on ws → error)

## v0.7 — done (Phase 6)

- ✅ `xray_diff_protocols`: side-by-side feature comparison
  (transports/security/multiplexing/padding/anti-DPI/mobile/battery/ease/notes).
- ✅ `xray_suggest_alternative`: goal-driven recommender for
  `anti-dpi-russia | anti-dpi-iran | anti-dpi-china | low-latency |
  mobile-battery | high-throughput | stealth-cdn | simple-getting-started`.
  Optionally lints a `current_config` and reports its issues.

## v0.9 — done (Phase 8: GitHub integration)

- ✅ `xray_github_search`: search issues/PRs across `XTLS/Xray-core`,
  `XTLS/REALITY`, `XTLS/Xray-docs-next` (or `all`) via GitHub REST search API.
  Filters by state/type/sort/order. Returns title, number, state, dates,
  comments, reactions, author, body snippet (~240 chars).
- ✅ `xray_github_search` extends to **discussions** via GraphQL when
  `GITHUB_TOKEN` env var is set; gracefully degrades to issues+PRs only
  with a warning if no token.
- ✅ `xray_github_fetch_issue`: full body + top N comments for one
  issue/PR (REST) or discussion (GraphQL). Exposes reactions object.
- ✅ Optional `GITHUB_TOKEN` env var raises rate limit from 60/h to 5000/h.
  Inline warning in the response when `X-RateLimit-Remaining < 10`.
- ✅ Friendly errors on 403 (rate limit / no token for discussions) and
  404 (item not found).

## v0.8 — done (Phase 7)

- ✅ `xray_merge_configs`: merges N configs, auto-renames tag collisions
  (-2/-3 suffix), warns on inbound port collisions and disagreeing
  singletons (log/policy/api/...).

## v0.10 — done (Phase 9: cache refresh tool + CI)

- ✅ `xray_refresh_cache` MCP tool: `scope: all | stale | category`,
  `max_age_days` (1..365, default 30), optional `discover` to also report
  upstream slugs missing from `DOCS_CATALOGUE`. Returns per-topic status
  (`updated`/`skipped`/`failed`) with reason and previous age.
- ✅ GitHub Actions `.github/workflows/refresh-docs.yml`: weekly Monday
  06:00 UTC cron + `workflow_dispatch`. Opens a PR via
  `peter-evans/create-pull-request` when `data/docs/` diff is non-empty.
- ✅ DRY: `refreshDocs()` lives in `src/docs.ts` and is shared between
  the CLI script (`scripts/fetch-docs.ts`) and the MCP tool wrapper
  (`src/tools_impl/refresh.ts`).

## Maybe-next (no version assigned)

- Per-rule severity overrides via env / args.
- More transport schemas: ECH inside TLS once xray-core stabilises it.
- "Profile linter": run a known-good `subscription` profile and lint each
  variant.
- ~~Bundle the xray-core JSON schema directly~~ — upstream doesn't ship one;
  we'll keep the hand-curated Zod approach.
