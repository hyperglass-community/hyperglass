# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Forced refresh, off by default. With `cache.refresh.enable: true`, `POST /api/query` accepts `"force": true`, which runs a cached query on the device again and replaces its cache entry. The server answers a forced query from the cache when the query ran less than `cache.refresh.min_interval` (default 30 seconds) ago, or while another forced request for the same query is in progress, so at most one forced run of each query starts per interval. Successful responses include `refresh_in`, the seconds until a forced query would run. `force` must be a boolean: a value that cannot be read as one is rejected with HTTP 400, even when forced refresh is disabled. With metrics enabled, a forced run counts as `result="bypass"` in `hyperglass_query_cache_total`, and a forced query answered from the cache counts as `hit` ([#552](https://github.com/hyperglass-community/hyperglass/issues/552)).
- Per-browser query history. Each browser saves its successful queries, with their output, in local storage (`hyperglass.history`) and lists them under "Recent queries" on the landing page, with the time each was saved in the viewer's time zone. A saved query opens read-only, without a request to the server; the browser's Back button closes it. Visitors can delete one query, or all of them after a confirmation; all tabs of a browser share one history, so a query deleted or cleared in one tab is gone from the others. Nothing is sent to the server. History is on by default and keeps 10 queries; `web.history.enable` and `web.history.limit` (1 to 50) change that, and turning it off also deletes the history a browser has already saved. Turn it off on kiosks and shared terminals. New `web.text` keys: `history_title`, `history_open`, `history_delete`, `history_clear_all`, `history_clear_confirm`, `history_clear_cancel`, `history_back` and `history_saved_at`. History saved by hyperglass-ng under `hyperglass.queryHistory` is not migrated: each browser deletes it when it loads the page, whether history is on or off ([#556](https://github.com/hyperglass-community/hyperglass/issues/556), [#590](https://github.com/hyperglass-community/hyperglass/issues/590)).
- Run a saved query again, or with a new target, from "Recent queries" or from an opened saved query. **Run again** fills the form with the saved locations, query type, target and variables and submits it through the form, so a required greeting, hostname resolution and validation still apply; **New target** fills in everything but the target and focuses the target field. Values the configuration no longer has are left out, and removed locations and variable values are named on their fields. **Run again** only submits the query as it was saved; when anything was left out or changed, it only fills the form. Nothing runs a query from a link. New `web.text` keys: `history_rerun`, `history_new_target`, `history_location_unavailable` and `history_variable_unavailable` ([#557](https://github.com/hyperglass-community/hyperglass/issues/557)).
- The requery button forces a fresh run when `cache.refresh.enable` is `true`, instead of returning the cached result. Pressed before the server allows the next forced run, it sends nothing and shows the time left under the result's header, from the new `web.text.refresh_cooldown` (default `Refresh available in {seconds}s`), which screen readers announce once per press. `params.cache.refresh.enable` is now sent to the UI ([#553](https://github.com/hyperglass-community/hyperglass/issues/553)).
- Keep a directive's results out of query history with `retain: false` in `directives.yaml` (default `true`; built-in directives always retain). In a query of several locations, only the locations whose own directive retains its results are saved. Results saved before a directive was set to `retain: false` are deleted from each browser's history when it next shows the query form. The flag is exported to the UI with each directive ([#558](https://github.com/hyperglass-community/hyperglass/issues/558)).
- Fill in the query form from URL parameters: `?location=<id>&type=<id or name>&target=<value>&var.<variable>=<value>`, with `location` repeated for several locations. Values the configuration doesn't offer are left out. The link only fills in the form: the query runs when the user submits it, so a required greeting still applies. See the [user guide](https://github.com/hyperglass-community/hyperglass/blob/main/docs/content/user-guide.mdx#link-to-a-filled-in-form) ([#554](https://github.com/hyperglass-community/hyperglass/issues/554)).
- Copy a link to the submitted query from the results view. The link fills in the form with the same locations, query type, target and variables, on the page's current address (its origin and path, without its other parameters or fragment); the recipient submits it to run the query. When the browser can't copy, the link is shown in a read-only field to copy by hand. New `web.text` keys: `copy_link`, `link_copied`, `query_link` ([#577](https://github.com/hyperglass-community/hyperglass/issues/577)).
- Share snapshots, off by default. With `share.enable: true`, `POST /api/share` with a query response's `id` copies that cached result into a snapshot that `GET /api/share/{id}` returns until it expires, not extended by reads. The request can pick how long with `expiresIn`, one of `share.timeout_choices` (default 7, 30 and 90 days, capped by `share.max_timeout`, default 90 days, at most a year); without it the snapshot is kept for `share.timeout` (default 30 days). Sharing the same result again from the same client returns the existing snapshot unchanged, whatever `expiresIn` says. `share.timeout` and the choices are sent to the UI. `DELETE /api/share/{id}` deletes a snapshot with the delete token returned at creation, sent in the `X-Delete-Token` header. Snapshots are kept in Redis under `hyperglass.share:`, outside the state cleared on start, so they survive a restart of Hyperglass; to survive a restart of Redis, Redis must persist its data (the shipped `compose.yaml` doesn't). Creation is limited per client (an IPv4 address or an IPv6 /64) and globally by `share.quota` (default 10 and 100 per hour), reads and delete requests by `share.read_quota`, the number of live snapshots by `share.max_entries` (default 1000; never makes room by deleting) and each snapshot's size by `share.max_size` (default 256 KiB), so storage is at most 256 MiB with the defaults. A directive with `retain: false` can't be shared, and a snapshot whose directive is later set to `retain: false` or removed is no longer served. Stored snapshots are validated before they are returned. Share responses are never cached (`Cache-Control: no-store`), and `POST /api/share` takes only `application/json` bodies. Operators can list and delete snapshots with `hyperglass share list`, `hyperglass share delete <id>` and `hyperglass share clear`. New `messages` keys: `share_result_expired`, `share_pending`, `share_not_allowed`, `share_too_large`, `share_unavailable`, `share_not_found`, `share_unsupported`, `share_invalid_expiry`. With metrics enabled, `hyperglass_share_requests_total` counts share requests. The query cache entry now also holds the query, its labels, format and runtime. Any result in the query cache can be snapshotted by anyone who can query it. See [Share Snapshots](https://github.com/hyperglass-community/hyperglass/blob/main/docs/content/configuration/config/share.mdx). Fork users: hyperglass-ng's `cache.share_*` keys, `params.public_url` and `/result/<id>` links don't carry over ([#559](https://github.com/hyperglass-community/hyperglass/issues/559)).
- Open a share link: `/?share=<id>` shows the shared result in place of the form, read-only, with the time the device ran the query and when the link expires, both in the viewer's time zone. The output can be copied; there is no requery, polling or AS path lookup, and the page makes no request but `GET /api/share/<id>`. **Run this query** fills the form with the shared query for the visitor to submit (a required greeting still applies), and **New query** shows an empty form; both remove `share` from the address. Form parameters in a share link (`location`, `type`, `target`, `var.*`) are ignored. A missing, expired or deleted share shows `messages.share_not_found`, an unsupported snapshot `messages.share_unsupported`, and other failures the new `web.text.share_error`. Pages served from the UI now have `Referrer-Policy: same-origin` (and the same policy as a `<meta name="referrer">` tag, for a UI served by something else), and the shared result page asks search engines not to index it. New `web.text` keys: `share_title`, `share_loading`, `share_error`, `share_result_time`, `share_expires`, `share_run_query`, `share_new_query` ([#560](https://github.com/hyperglass-community/hyperglass/issues/560)).
- Share a result from the results view. With `share.enable: true`, each successful result has a Share button next to copy and requery, except while its AS path enrichment is still running and for a directive with `retain: false`. It opens a popover to choose how long to keep the link (`share.timeout_choices`, with `share.timeout` selected) and create it; then it shows the link (`<page address>?share=<id>`) to copy, its expiry, a notice that anyone with the link can see the result and its target, and **Delete Link**. The delete token is kept in the page's memory only and sent only in the `X-Delete-Token` header of the delete request: never in a URL, the link, web storage or logs, and it is gone when the page is closed or reloaded. Links made from earlier results of the same query, before it ran again, stay in the popover. A delete answered with 404 checks once whether the link still exists: if it does (shared again elsewhere, which replaced the token), the link is kept and a note replaces the delete button. A link's lifetime is counted from the server's clock, so a browser clock that is off doesn't drop it. Refused requests show the matching `messages` entry, never the server's response. `share.enable` is now sent to the UI. New `web.text` keys: `share_result`, `share_keep_for`, `share_create`, `share_link`, `share_notice`, `share_delete`, `share_deleted`, `share_earlier_link`, `share_delete_scope`, `share_delete_rotated`, `share_link_expired`, `share_minute`, `share_minutes`, `share_hour`, `share_hours`, `share_day`, `share_days` ([#561](https://github.com/hyperglass-community/hyperglass/issues/561)).
- Share a result from the query history, and keep the links created in this browser. With sharing on, each result of an opened saved query has the Share button, and so does the row of a saved query of one location; the request sends the saved result's `timestamp`, so the server shares that result or answers 404, and a saved result the server no longer holds shows `messages.share_result_expired` with a **Run again** button (the query is never run again on its own). The links created in a browser, from live results or saved queries, are now kept in its local storage under `hyperglass.shares` with their delete tokens, instead of the page's memory, and listed under "Your shared links" on the landing page, whether query history is on or off, to copy or delete later, from any tab and after a reload; **Forget all** forgets them after a confirmation, and the links keep working until they expire. Saved queries whose result has a live link are marked. Deleting saved queries or clearing the history keeps the links; the Clear all confirmation says so. Expired links are removed with their tokens. With `share.enable: false`, browsers forget their saved links. New `web.text` keys: `shares_title`, `shares_forget`, `shares_clear_all`, `shares_clear_confirm`, `shares_clear_cancel`, `history_shared`, `history_share_kept`; the defaults of `share_delete_scope` and `share_delete_rotated` now say "this browser" ([#562](https://github.com/hyperglass-community/hyperglass/issues/562)).
- Optional rate limit on `POST /api/query`, off by default. With `query_limit.enable: true`, each client (an IPv4 address or an IPv6 /64, read through `web.client_ip` behind trusted proxies) can send `query_limit.client_limit` queries (default 30; the UI sends one per selected location) per `query_limit.window` seconds (default 60), and all clients together `query_limit.global_limit` (default 300). Queries answered from the cache count; requests rejected by validation don't. A query over the limit gets HTTP 429 with `Retry-After` and the new `messages.rate_limited` text, and no device is contacted. When Redis is unreachable the limit is not checked. With metrics enabled, rejected queries count as `reason="rate_limited"`. See [Query Rate Limit](https://github.com/hyperglass-community/hyperglass/blob/main/docs/content/configuration/config/query-limit.mdx) ([#584](https://github.com/hyperglass-community/hyperglass/issues/584)).

### Changed

- Show the cached-result time in the viewer's locale and time zone, with the zone name or offset, for example `Nov 20, 2026, 3:00:00 AM EST`. The locale decides the 12- or 24-hour clock. The backend's timestamp is UTC without a zone designator, and the tooltip showed it as received ([#564](https://github.com/hyperglass-community/hyperglass/pull/564), [#551](https://github.com/hyperglass-community/hyperglass/issues/551)). **Default change:** `web.text.cache_icon` is now `Cached from {time}`; it was `Cached from {time} UTC`. A configuration that sets `cache_icon` to the old text now labels a local time as UTC; remove the setting or the word `UTC`.
- Upgrade the UI to zustand 5 (from 3.7.2). A greeting acknowledgement saved in the browser, including one saved by an earlier version, still keeps the greeting closed when the page loads ([#575](https://github.com/hyperglass-community/hyperglass/issues/575)).

### Fixed

- Return HTTP 400 with the failed fields for malformed query requests. Request validation errors previously returned HTTP 200 and were logged as critical ([#412](https://github.com/hyperglass-community/hyperglass/pull/412), [#490](https://github.com/hyperglass-community/hyperglass/issues/490)). **API change:** this applies to every route, and external clients that received HTTP 200 with `"status_code": 422` in the body now receive HTTP 400 with the same body keys.
- Resolve a query type by its exact directive id. A query for a custom directive such as `ping` could run another directive whose id contains it, such as `ping6`, depending on the process hash seed ([#426](https://github.com/hyperglass-community/hyperglass/pull/426), [#491](https://github.com/hyperglass-community/hyperglass/issues/491)). **API change:** `queryType` is now matched exactly and case-sensitively. A direct API client that sends a partial or differently cased id, such as `bgp_route` or `PING`, now gets `QueryTypeNotFound`. The UI already sends exact ids.
- Stop returning internal error messages to API clients. An internal error raised during a request, such as a parsing error from an output plugin or a configuration error found while running a query, was returned with its internal message. It is now logged, and the client gets `messages.general` ([#543](https://github.com/hyperglass-community/hyperglass/pull/543), [#539](https://github.com/hyperglass-community/hyperglass/issues/539)). **API change:** these internal errors returned HTTP 400 with the internal message, level and keywords. They now return HTTP 500 with `messages.general`, level `danger` and empty keywords. A state error, raised when state is missing from Redis during a request, returned HTTP 400 and now returns HTTP 503 with the same body as a Redis outage. Public errors, whose messages come from `messages`, keep their status and body.
- Count a query either as a success or as an error, never both. `POST /api/query` read the configuration from Redis again after recording the query as a success, so a Redis failure at that point also counted it as an error ([#582](https://github.com/hyperglass-community/hyperglass/issues/582)).
- Keep a stable directive order across restarts. Each device lists its custom directives in the order of the directives file, then its built-in directives. The order changed on every restart, which reordered the query type menu and rebuilt the UI on every start ([#492](https://github.com/hyperglass-community/hyperglass/issues/492)).

## 3.0.0-rc.2 - 2026-11-19

This release candidate replaces 3.0.0-rc.1, which was not released. Lab testing of 3.0.0-rc.1 found defects that block it.

This is a release candidate. Use it to test an upgrade from 2.0.4; do not treat it as a stable release. The image is `ghcr.io/hyperglass-community/hyperglass:3.0.0-rc.2`. The `latest` tag does not move. Report a defect as a [new issue](https://github.com/hyperglass-community/hyperglass/issues/new/choose) that names this version.

Hyperglass 3.0.0 incorporates the Ultraglass 3.6.2 implementation through the staged migration in [#390](https://github.com/hyperglass-community/hyperglass/issues/390). It adds router support, structured results, configuration controls, onboarding and runtime recovery. The Python package, CLI, configuration paths, environment variables and service names remain `hyperglass`. Ultraglass release numbers are separate from Hyperglass release numbers.

### Upgrading from 2.0.4

Back up `config.yaml`, `devices.yaml` and `directives.yaml`, then read [Migrating from Hyperglass 2.0.4](https://github.com/hyperglass-community/hyperglass/blob/v3.0.0-rc.2/docs/content/installation/upgrading.mdx). These changes can require a configuration change:

- Structured output requires explicit `structured_output: true` on every supported platform, including FRR, Juniper aliases and Arista. Omitted, `null` and `false` settings return text.
- Forwarding headers require a trusted proxy. Configure `web.client_ip.trusted_proxies` with the actual connecting proxy addresses. Set `web.client_ip.header` only for a single-address header that the trusted proxy overwrites; otherwise Hyperglass processes `X-Forwarded-For` from right to left.
- My IP defaults to server-side detection. It returns `null` for non-public addresses, including private proxy addresses, without automatically contacting a public service. Select `web.my_ip: external` explicitly to use the external lookup, or `off` to hide the control.
- `/api/dns` and `/api/aspath/enrich` are disabled by default. `web.dns_provider.name: server` and `web.aspath_enrichment: true` enable them.
- Server DNS uses a fixed public resolver and returns public A/AAAA answers only. Internal DNS resolution is unsupported.
- The default listen address is `::1`. A reverse proxy must use `[::1]:8001`, or `HYPERGLASS_HOST` must name another address.
- Docker Compose publishes the application directly. For host nginx, set `HYPERGLASS_BIND_ADDRESS=127.0.0.1` and trust the proxy address seen inside the container. Keep the container listener at `HYPERGLASS_HOST=0.0.0.0`.
- IP rules enforce `allow_loopback`, `allow_reserved` and `allow_unspecified`. These options default to `false`. Address and prefix inputs normalize before validation; `192.0.2.1/24`, for example, becomes `192.0.2.0/24`.
- BIRD AS-path queries accept ASN sequences with `^`, `$` and `_`. OpenBGPD AS-path queries accept one ASN. Built-in BGP targets reject command syntax.
- Cisco IOS and NX-OS IPv6 BGP Route queries require a prefix no longer than `/127`.
- Use `vyos_1_3` for legacy VyOS commands. Set device `os_version` for version-specific commands, including RouterOS 6 and classic IOS IPv6 traceroute.
- VRF identifiers accept command-safe names or numbers. Numeric values normalize to strings; spaces and slashes remain invalid. A VRF device offers only applicable built-ins and configured custom directives.
- Python 3.11 or later and Node.js 22.13 or later are required for a manual installation.
- Docker Compose pulls the published image and runs Valkey 8 as the `redis` service. It no longer builds the checkout, so `docker compose build` has no effect; add `compose.build.yaml` for a source build. Existing `HYPERGLASS_REDIS_*` settings keep their meaning, and the bundled cache starts empty.
- The automatic worker count follows CPU affinity and the container CPU quota, and stops at eight. Set `HYPERGLASS_WORKERS` to keep a higher count.
- Custom directives quote substituted arguments on shell-backed platforms. Review templates that depend on shell expansion or that split one target into several arguments.

### Security

- Reject control characters and line separators in query targets, including targets accepted by custom directives. Restrict IPv6 zone identifiers to letters, digits and hyphens before command construction ([#392](https://github.com/hyperglass-community/hyperglass/pull/392)). Part of [#383](https://github.com/hyperglass-community/hyperglass/issues/383).
- Validate built-in directive targets again at the command boundary and quote shell-backed built-in arguments after target substitution ([#393](https://github.com/hyperglass-community/hyperglass/pull/393)).
- Quote custom-directive arguments on shell-backed platforms, including fallback and VRF commands ([#407](https://github.com/hyperglass-community/hyperglass/pull/407)).
- Limit the server DNS and ASN lookup endpoints with shared Redis request quotas, caches, concurrency leases and deadlines. Both endpoints are off by default; server DNS rejects non-public answers ([#399](https://github.com/hyperglass-community/hyperglass/pull/399)).
- Read forwarding headers only from the proxies in `web.client_ip.trusted_proxies` ([#399](https://github.com/hyperglass-community/hyperglass/pull/399)).
- Filter ArcOS BGP Route responses to the requested exact prefix in both text and structured modes. The device command still retrieves the full BGP instance. Malformed or incomplete responses return a parsing error instead of raw device output ([#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- Support bundles export metadata only. They no longer include free-form messages or exception values ([#402](https://github.com/hyperglass-community/hyperglass/pull/402)).
- Update Python, frontend and container dependencies from the migrated baseline, including patched image packages and transitive frontend dependencies ([#394](https://github.com/hyperglass-community/hyperglass/pull/394), [#395](https://github.com/hyperglass-community/hyperglass/pull/395)).

### Added

- Structured BGP tables and traceroute results across supported router platforms, with route attributes, hop timing and loss, communities and AS-path visualization. BGP stays text on platforms with traceroute-only structured support. See the [platform reference](https://github.com/hyperglass-community/hyperglass/blob/v3.0.0-rc.2/docs/content/platforms.mdx) for per-platform capabilities ([#398](https://github.com/hyperglass-community/hyperglass/pull/398), [#400](https://github.com/hyperglass-community/hyperglass/pull/400), [#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- Built-in directives for `aruba_aoscx`, `arrcus_arcos`, `cumulus_linux`, `dell_force10`, `dell_os10`, `extreme_exos`, `extreme_vsp`, `fortinet`, `hp_comware`, `ipinfusion_ocnos`, `paloalto_panos`, `sonic` and `vyos_1_3` ([#400](https://github.com/hyperglass-community/hyperglass/pull/400), [#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- VRF queries through built-in directives and device `vrf` settings ([#397](https://github.com/hyperglass-community/hyperglass/pull/397)).
- Named directive variables with fixed choices, required fields and optional command fragments. Selected values participate in query cache identity ([#293](https://github.com/hyperglass-community/hyperglass/issues/293), [#397](https://github.com/hyperglass-community/hyperglass/pull/397)).
- Device `os_version`, rule `fallback_command` and `fallback_os_version` settings for version-specific commands and fallback after a device rejects the primary command ([#397](https://github.com/hyperglass-community/hyperglass/pull/397)).
- Named BGP communities through `structured.communities.mode: name` and `names`, preserving unmatched community values ([#313](https://github.com/hyperglass-community/hyperglass/issues/313)).
- Routinator as an external RPKI backend, alongside Cloudflare, with batched validation and provider-aware caches ([#398](https://github.com/hyperglass-community/hyperglass/pull/398)).
- Optional BGP and traceroute IP/ASN enrichment, inline or asynchronous. Global controls can disable structured BGP or traceroute independently ([#398](https://github.com/hyperglass-community/hyperglass/pull/398), [#399](https://github.com/hyperglass-community/hyperglass/pull/399)).
- Mixed-vendor query selection, directive-variable controls and server-side DNS resolution in the UI ([#174](https://github.com/hyperglass-community/hyperglass/issues/174), [#270](https://github.com/hyperglass-community/hyperglass/issues/270), [#399](https://github.com/hyperglass-community/hyperglass/pull/399)).
- The `hyperglass onboard` command, which creates and tests device entries, checks feature settings and scaffolds custom directives ([#402](https://github.com/hyperglass-community/hyperglass/pull/402)).
- Support bundle export for defect reports ([#402](https://github.com/hyperglass-community/hyperglass/pull/402)).
- Connection retry, readiness checks and state recovery for device transports ([#396](https://github.com/hyperglass-community/hyperglass/pull/396)).
- `HYPERGLASS_WORKERS` to set an explicit worker count, device `connect_retries` to control SSH connection retries, and `disable_paging: false` to suppress driver paging commands ([#338](https://github.com/hyperglass-community/hyperglass/issues/338), [#396](https://github.com/hyperglass-community/hyperglass/pull/396)). Automatic sizing respects affinity and visible cgroup quotas, including inherited limits, and caps the worker count at eight, so a container on a high-core host no longer starts enough workers to exhaust its memory ([#356](https://github.com/hyperglass-community/hyperglass/issues/356), [#357](https://github.com/hyperglass-community/hyperglass/pull/357)).
- Optional SSH session logs and rotating JSONL query samples containing selected raw and parsed output. Both are disabled by default ([#336](https://github.com/hyperglass-community/hyperglass/issues/336), [#402](https://github.com/hyperglass-community/hyperglass/pull/402)).
- A containerlab test lab under `lab/` ([#400](https://github.com/hyperglass-community/hyperglass/pull/400), [#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- New documentation site content, platform guides, onboarding instructions and a complete configuration sample. Tests keep the embedded reference synchronized with the sample ([#403](https://github.com/hyperglass-community/hyperglass/pull/403)). Source release history remains in the [Ultraglass repository](https://github.com/WilhelmZA/ultraglass/blob/90e2f3ab260820f49cd99872d779dc8083d9e9b3/CHANGELOG.md).
- [#304](https://github.com/thatmattlove/hyperglass/pull/304): Add FRR structured output for BGP Routes - @chriswiggins

### Changed

- Updated the Python package, runtime metadata, UI package and documentation package to 3.0.0-rc.2.
- Python packaging and the container image install from locked requirements, and Click is constrained below 8.2 for Typer compatibility ([#394](https://github.com/hyperglass-community/hyperglass/pull/394), [#389](https://github.com/hyperglass-community/hyperglass/pull/389)).
- The UI builds with pnpm 11 and Node.js 22.13 or later ([#395](https://github.com/hyperglass-community/hyperglass/pull/395)).
- UI fonts are served locally. ASN links use bgp.tools, and the browser no longer calls CAIDA AS Rank ([#255](https://github.com/hyperglass-community/hyperglass/issues/255), [#312](https://github.com/hyperglass-community/hyperglass/issues/312)).
- Browser Back returns to the populated query form. BGP tables paginate at 50 rows, and the AS-path graph shares ASN nodes across routes ([#286](https://github.com/hyperglass-community/hyperglass/issues/286), [#328](https://github.com/hyperglass-community/hyperglass/issues/328), [#345](https://github.com/hyperglass-community/hyperglass/issues/345)).
- Slack and Teams deliveries use the configured webhook host, authentication, headers, timeout and TLS settings. Teams uses an Adaptive Card ([#398](https://github.com/hyperglass-community/hyperglass/pull/398), [#402](https://github.com/hyperglass-community/hyperglass/pull/402)).
- HTTP devices receive default HTTP configuration when the `http` block is omitted. Unknown device keys produce warnings with spelling suggestions ([#397](https://github.com/hyperglass-community/hyperglass/pull/397)).
- Redis recovery verifies complete plugin registration and generation state. Recovery waits and output-plugin execution run outside the request event loop; state clearing preserves unrelated Redis keys ([#396](https://github.com/hyperglass-community/hyperglass/pull/396), [#398](https://github.com/hyperglass-community/hyperglass/pull/398)).
- The Docker image is published to `ghcr.io/hyperglass-community/hyperglass` on version tags only. A vulnerability scan with a fixable HIGH or CRITICAL finding blocks the merge gate and publication ([#389](https://github.com/hyperglass-community/hyperglass/pull/389), [#404](https://github.com/hyperglass-community/hyperglass/pull/404), [#422](https://github.com/hyperglass-community/hyperglass/pull/422)).
- Compose deploys the published image with Valkey 8 without requiring a source clone. `compose.build.yaml` enables source builds. Dependency layers remain cached when application source changes. The image excludes repository metadata ([#424](https://github.com/hyperglass-community/hyperglass/pull/424), [#420](https://github.com/hyperglass-community/hyperglass/pull/420)).
- CI tests Python 3.11 and 3.12 with Redis and Valkey, the frontend, clean package installation and the real SSH transport. Publication uses the scanned image, and a weekly workflow scans the published image ([#389](https://github.com/hyperglass-community/hyperglass/pull/389), [#410](https://github.com/hyperglass-community/hyperglass/pull/410), [#424](https://github.com/hyperglass-community/hyperglass/pull/424)).
- Renovate proposes dependency changes with release-age checks and maintainer review. Automerge is disabled; Python dependencies remain excluded from automated updates ([#411](https://github.com/hyperglass-community/hyperglass/pull/411)).

### Fixed

- Return the configured timeout response when a device query exceeds its request deadline ([#409](https://github.com/hyperglass-community/hyperglass/pull/409)).
- Require explicit structured-output opt-in on every supported platform, including FRR, Juniper aliases and Arista ([#413](https://github.com/hyperglass-community/hyperglass/issues/413)).
- Retry a built-in MikroTik BGP query once after a transport read fault with a higher delay factor. Both attempts share one request deadline; skip the retry when less than one second remains. Complete genuine zero-route replies immediately ([#415](https://github.com/hyperglass-community/hyperglass/issues/415)).
- Restore bounded PTR enrichment for missing traceroute hostnames after sending the initial response. Resolve only global unicast addresses, excluding site-local IPv6, and preserve router-provided names ([#414](https://github.com/hyperglass-community/hyperglass/issues/414)).
- Accept Juniper route entries without a peer ASN while preserving route attributes ([#273](https://github.com/hyperglass-community/hyperglass/issues/273)).
- Treat BIRD text replies containing only banners and table headers as empty results ([#166](https://github.com/hyperglass-community/hyperglass/issues/166)).
- Target the BGP peer for lab ping and traceroute. Apply core link addresses before readiness checks, enable MikroTik and OS9 BGP peers, use Cumulus 5.4 NVUE syntax with a matching default lab image, and wait for OS9 host-key generation before startup configuration ([#419](https://github.com/hyperglass-community/hyperglass/pull/419), [#425](https://github.com/hyperglass-community/hyperglass/pull/425)).
- Size each worker's Redis connection pool for its thread pool, so the eight-worker cap does not exhaust connections on a busy worker ([#420](https://github.com/hyperglass-community/hyperglass/pull/420)).
- Cancel only the superseded CI run of the same pull request, so pull requests with the same branch name do not cancel each other ([#420](https://github.com/hyperglass-community/hyperglass/pull/420)).
- Arista diagnostics enter privileged mode before ping; failed enable authentication returns an authentication error ([#353](https://github.com/hyperglass-community/hyperglass/issues/353)).
- Parse Juniper confederations and ASDOT paths, including repeated BGP attribute blocks. Shared ASN parsing normalizes dotted ASNs ([#339](https://github.com/hyperglass-community/hyperglass/issues/339), [#333](https://github.com/hyperglass-community/hyperglass/issues/333)).
- Handle RouterOS 6/7 command differences, timing-based interactive reads and repeated traceroute output. Valid zero-route MikroTik results complete without repeated SSH sessions ([#310](https://github.com/hyperglass-community/hyperglass/issues/310), [#379](https://github.com/hyperglass-community/hyperglass/pull/379)).
- Load TNSR with Netmiko's generic SSH driver and suppress unsupported paging setup ([#317](https://github.com/hyperglass-community/hyperglass/issues/317)).
- Resolve shared query types to each selected device's directive, fixing mixed-vendor selections ([#320](https://github.com/hyperglass-community/hyperglass/issues/320)).
- Support legacy VyOS 1.3 commands through `vyos_1_3` ([#245](https://github.com/hyperglass-community/hyperglass/issues/245), [#331](https://github.com/hyperglass-community/hyperglass/issues/331)). Original command update by ServerForge.
- Handle empty BIRD and FortiGate structured route results without returning device banners as routes. Preserve leading setup-command silence correctly in text output ([#287](https://github.com/hyperglass-community/hyperglass/issues/287), [#400](https://github.com/hyperglass-community/hyperglass/pull/400), [#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- Reject malformed FRR/OpenBGPD JSON, accept empty Cisco AS paths, and derive Comware route origin from the final ASN ([#400](https://github.com/hyperglass-community/hyperglass/pull/400), [#401](https://github.com/hyperglass-community/hyperglass/pull/401)).
- Restore Slack payload construction and webhook delivery ([#282](https://github.com/hyperglass-community/hyperglass/issues/282)).
- Reuse a successful UI build when the configuration hash and exported version match. Report missing or unsupported Node.js versions clearly ([#278](https://github.com/hyperglass-community/hyperglass/issues/278), [#326](https://github.com/hyperglass-community/hyperglass/issues/326)).
- Normalize logo width settings, remove duplicate text/table query choices, and document the correct `builtins` selection key ([#259](https://github.com/hyperglass-community/hyperglass/issues/259), [#283](https://github.com/hyperglass-community/hyperglass/issues/283), [#337](https://github.com/hyperglass-community/hyperglass/issues/337)).
- [#280](https://github.com/thatmattlove/hyperglass/issues/280): Fix: `condition: None` caused error in directive @Jimmy01240397
- [#306](https://github.com/thatmattlove/hyperglass/issues/306): Fix: allow integer values in ext_community_list_raw field for Arista BGP - @cooperwinser
- [#311](https://github.com/thatmattlove/hyperglass/issues/311): Fix: device and directive errors. - @Computroniks
- [#315](https://github.com/thatmattlove/hyperglass/issues/315): Impossibile to use command "BGP Route" with Huawei NetEngine 8000 - @JelsonRodrigues
- [#187](https://github.com/thatmattlove/hyperglass/issues/187): Error in bgp_router query on Huawei - @JelsonRodrigues
- [#325](https://github.com/thatmattlove/hyperglass/pull/325): Fix code block padding in the documentation - @jagardaniel
- [#332](https://github.com/thatmattlove/hyperglass/pull/332): Fix custom proxy port support in SSH proxy tunnels @jessiebryan 
- [#292](https://github.com/thatmattlove/hyperglass/pull/292): Updates Mikrotik BGP route command so supernets are selected as well as exact matches. - @GrandArcher

### Removed

- Remove the unused BGP community input plugin. Built-in syntax checks and directive rules still validate community targets.

### Contributors

- @jsenecal wrote the automatic worker sizing ([#357](https://github.com/hyperglass-community/hyperglass/pull/357)), the real SSH transport tests ([#410](https://github.com/hyperglass-community/hyperglass/pull/410)) and the Renovate configuration ([#411](https://github.com/hyperglass-community/hyperglass/pull/411)). These were merged inside [#420](https://github.com/hyperglass-community/hyperglass/pull/420).
- @CarlosSuporteISP wrote the Huawei and MikroTik structured output in [#340](https://github.com/hyperglass-community/hyperglass/pull/340). The migration transferred that work in [#398](https://github.com/hyperglass-community/hyperglass/pull/398) and [#400](https://github.com/hyperglass-community/hyperglass/pull/400).
- @ant-atsyganov wrote the mixed-vendor query type resolution in [Ultraglass #17](https://github.com/WilhelmZA/ultraglass/pull/17), transferred in [#399](https://github.com/hyperglass-community/hyperglass/pull/399).
- @bronson-calif reported the command injection defect in [#383](https://github.com/hyperglass-community/hyperglass/issues/383) and proposed the first fix in [#382](https://github.com/hyperglass-community/hyperglass/pull/382).
- @ndegwairungu, @LucaTheHacker, @pva, @mconf248, @sinuscosinustan, @AleksBelytskyi, @Rishi556, @tobiaspal and @ttiot proposed fixes that this release carries in another pull request.
- [CONTRIBUTORS.md](CONTRIBUTORS.md) lists every contributor, superseded pull request and issue reporter for this release.

## 2.0.4 - 2024-06-30

### Fixed

- [#264](https://github.com/thatmattlove/hyperglass/issues/264): Fixed issue where IPv6 traceroutes fail on Juniper devices due to `traceroute: wait must be >1 sec.` error. Thanks @renatoornelas!
- [#267](https://github.com/thatmattlove/hyperglass/issues/267): Fixed issue where responses were incorrectly cached, resulting in no data being shown in the AS Path viewer.
- [#268](https://github.com/thatmattlove/hyperglass/issues/268): Fixed issue where some Mikrotik commands failed to execute properly.
- [#269](https://github.com/thatmattlove/hyperglass/issues/269): Updated documentation regarding `structured.rpki.mode`.
- Removed unnecessary logging statements which caused logging errors.
- Fixed issue where validation of structured BGP route data may have failed under certain conditions.

### Changed
- Error responses are no longer cached.

## 2.0.3 - 2024-06-16

### Fixed

- [#262](https://github.com/thatmattlove/hyperglass/issues/262): Fix issue where Mikrotik output was improperly parsed and displayed an error as a result.
- Fixed issue where incorrect error styles were displayed.
- Fixed issue where 'results' accordion component did not re-open when closed.
- Fixed issue where pattern-based directive rules failed validation.

### Changed

- Set default logo width (back) to 50%, adjusted how the `web.logo.width` setting is handled in the UI.

## 2.0.2 - 2024-06-01

### Fixed

- [#257](https://github.com/thatmattlove/hyperglass/issues/257): Fix issue where if `web.location_display_mode` is set to `dropdown` (automatically or otherwise), the menu would remain open but become detached from the main element because the Query Type element came into view.
- [#253](https://github.com/thatmattlove/hyperglass/issues/253): _Actually_ fix issue where configuration values were improperly prepended with the `HYPERGLASS_APP_PATH` value.
- [#258](https://github.com/thatmattlove/hyperglass/issues/258): Center logo alignment on small screens.
- Fix broken license link in default credit menu.

### Added

- Added license to docs.
- [#254](https://github.com/thatmattlove/hyperglass/issues/254): Users may specify their own DNS over HTTPS provider if desired.

## 2.0.1 - 2024-05-31

### Fixed
- [#244](https://github.com/thatmattlove/hyperglass/issues/244): Fix issue with UI build where UI build directory already existed and therefore could not be created.
- [#249](https://github.com/thatmattlove/hyperglass/issues/249): Fix issue where configuration values were improperly prepended with the `HYPERGLASS_APP_PATH` value.
- [#251](https://github.com/thatmattlove/hyperglass/issues/251): Fix issue where browser-based DNS resolution did not show, causing FQDN queries to fail due to validation.
- Fix issue where logo was improperly sized on small screens.

## 2.0.0 - 2024-05-28

_v2.0.0 is a major release of hyperglass. Many things have changed, and it is likely best to redeploy hyperglass in a new environment to migrate to v2._

### Added

- Commands are now defined as [directives](https://hyperglass.dev/configuration/directives), which is a configuration definition of one or more commands to run on a device. A directive defines:
  - What command (or commands) to run on the device
  - Type of UI field, text input or select
  - If the field can accept multiple values
  - Help information to show about the directive
  - Validation rules
- hyperglass now supports Docker, and using Docker is the default and recommended method for deployment.
- The list of locations (devices) is displayed as a gallery when the number of devices is 5 or less. This is a default value and is configurable.
- hyperglass now supports custom [input or output plugins](https://hyperglass.dev/plugins).
  - Input Plugins: Apply custom validation logic or transform user input before the query is sent to a device.
  - Output Plugins: Interact with the output from a device before it's displayed to the user.
- [#206](https://github.com/thatmattlove/hyperglass/issues/206): OpenBGPD is natively supported by hyperglass.
- [#176](https://github.com/thatmattlove/hyperglass/issues/176): Custom javascript or HTML can be injected into the web page (for tracking applications such as Google Analytics).
- [#173](https://github.com/thatmattlove/hyperglass/issues/173): Any output, such as BGP Communities, can be highlighted in the UI by defining [highlight patterns](https://hyperglass.dev/configuration/config/web-ui#highlighting).
- [#155](https://github.com/thatmattlove/hyperglass/issues/155): A user can now use the "My IP" button to insert their own IP into the query target field.
- [#143](https://github.com/thatmattlove/hyperglass/issues/143): Any HTTP endpoint may be configured as device from which to collect output.

### Fixed
- [#229](https://github.com/thatmattlove/hyperglass/issues/229): Fixed an issue where the logo was not visible when using Firefox.
- [#180](https://github.com/thatmattlove/hyperglass/issues/180): Fixed an issue where certain FQDNs were considered invalid.
- [#178](https://github.com/thatmattlove/hyperglass/issues/178): Fixed an issue where parsing of Arista EOS routes failed if MED is unset.
- [#145](https://github.com/thatmattlove/hyperglass/issues/145): Fixed an issue where menu links were improperly generated.

## 1.0.4 - 2021-07-03

### Fixed
- [#148](https://github.com/thatmattlove/hyperglass/issues/148): Update Debian/Ubuntu Python package name in installer and documentation.
- [#151](https://github.com/thatmattlove/hyperglass/issues/151): Fix issue with Junos structured output parsing from d1160fe where hyperglass would always query both IPv4 and IPv6 for any query type.

### Changed
- Improve handling of Junos XML errors. When a Junos device returns an error in the XML output, it will be displayed in the UI.
- Improve `hyperglass system-info` output. NodeJS version is now included in the output.

## 1.0.3 - 2021-06-23

_1.0.3 is a cosmetic release to factor in code-level changes related to the repository name change from checktheroads to thatmattlove._

## 1.0.2 - 2021-06-18

### Fixed
- [#150](https://github.com/thatmattlove/hyperglass/issues/150): Fix handling of BIRD AS_PATH/Community targets.

## 1.0.1 - 2021-06-17

### Fixed
- UI: fix body overflow issue

## 1.0.0 - 2021-05-30

### BREAKING CHANGES
- The `external_link`, `help`, and `terms` parameters no longer exist and have been replaced with generic `links` and `menus` options.
- The transitionary `frr_ssh` and `bird_ssh` NOS parameters no longer exist — `frr` and `bird` can now be used for SSH-based connectivity. hyperglass-agent users must now use `frr_legacy` and `bird_legacy` until hyperglass-agent is fully deprecated.

### Fixed
- [#139](https://github.com/thatmattlove/hyperglass/issues/139): Fix an issue where the API cannot be queried by device name.

### Changed
- Updated UI dependencies

### Added
- [#140](https://github.com/thatmattlove/hyperglass/issues/140): Genericize links and menus so that multiple links and/or menus can be defined and fully customized.

## 1.0.0-beta.82 - 2021-04-22

### BREAKING CHANGE
**NodeJS 14.15 or later is required**. See [the docs](https://hyperglass.dev/docs/getting-started) for installation instructions.

### Fixed
- [#135](https://github.com/thatmattlove/hyperglass/issues/135): Fix an issue where Juniper indirect next-hops were empty.
- Fix an issue where Juniper structured AS_PATH or Community queries would appear to fail if one address family (IPv4 or IPv6) had an empty response. For example, if an AS_PATH query for `.* 29414 .*` was made (which only returns IPv4 routes), the query would fail.

### Changed
- Updated major Python dependencies (FastAPI, Scrapli, Netmiko, Pydantic, Uvicorn, Gunicorn, etc.)
- Updated UI dependencies
- [#128](https://github.com/thatmattlove/hyperglass/pull/128): Add `best` to all Juniper BGP Route queries. See [Juniper docs](https://www.juniper.net/documentation/us/en/software/junos/bgp/topics/ref/command/show-route-best.html) for more details.

### Added
- The driver for devices can now be overridden with the `driver` parameter.

## 1.0.0-beta.81 - 2021-04-10

### Fixed
- [#124](https://github.com/thatmattlove/hyperglass/issues/124): Fix an issue where networks weren't always sorted alphabetically.
- [#126](https://github.com/thatmattlove/hyperglass/issues/126): Fix rendering of markdown tables.
- [#132](https://github.com/thatmattlove/hyperglass/issues/132): Fix an issue where iBGP routes on Arista devices caused output parsing to fail.
- [#133](https://github.com/thatmattlove/hyperglass/issues/133): Use body styles for background/foreground color, allowing the user to override the `light` and `dark` colors per the docs.
- Fix an issue with select menu list style.

### 1.0.0-beta.80 - 2021-03-03

### Fixed
- Fix an issue where the UI did not properly filter and detect the correct Query VRF when only one was defined.
- [#121](https://github.com/thatmattlove/hyperglass/issues/121): Fix issue with select menu styling in light mode.

### 1.0.0-beta.79 - 2021-02-26

### BREAKING CHANGE
**Major changes have been made to how VRFs are defined and handled.** Previously, you would signal to hyperglass that a VRF was the "default" VRF (meaning, a VRF does not need to be specified in any commands) by setting `name: default` in the VRF block. This limitation meant that a VRF named `default` _had_ to be defined, and that any users who keep their global routing table in a non-default VRF must define it separately.

Moving forward, the `name` field is only used to define the name of the VRF **as known by the device**. To signal that hyperglass should use the device's default VRF, set `default: true` on the VRF. **This is not the default**.

### Fixed
- Fix an issue where long-running commands, such as traceroutes that never complete, time out and display an error instead of the output.

### Changed
- Don't do external RPKI lookups for non global unicast prefixes.
- Migrate to palette-by-numbers for theming.
- Update UI dependencies.

### 1.0.0-beta.78 - 2021-02-12

### Added
- Experimental table output/structured data support for Arista EOS.

### Fixed
- Corrected warning color on active routes in table output.

### Changed
- Caught fetch errors now display the HTTP status text in the UI, instead of the caught error message.

### 1.0.0-beta.77 - 2021-02-10

**POTENTIALLY BREAKING CHANGE**: The device `display_name` field is being deprecated, in favor of a single `name` field, which will be displayed to the end user. The `display_name` field still works, but you should migrate away from it as soon as possible.

### Fixed
- [#117](https://github.com/thatmattlove/hyperglass/issues/117): Fix naming and mapping of the Arista EOS driver. `arista` and `arista_eos` will both work now.

### Changed
- Removed `display_name` field from device model. The `name` field will be used in the UI. If a `display_name` is defined, it will be used, for backwards compatibility.

### 1.0.0-beta.76 - 2021-02-06

**NOTICE**: *[hyperglass-agent](https://github.com/thatmattlove/hyperglass-agent) will be deprecated soon. Use `frr_ssh` or `bird_ssh` for SSH connectivity in the meantime.*

### Added
- FRR & BIRD may now be accessed via standard SSH using the `frr_ssh` and `bird_ssh` NOS. [See the docs](https://hyperglass.dev/docs/platforms#caveats) for important caveats.

### Changed
- `port` in `devices.yaml` now defaults to 22 if not specified.

### Fixed
- AS Path graph view now uses [dagre](https://github.com/dagrejs/dagre) to properly arrange each AS.
- Added timeout argument to `hyperglass start --build` - fixes issue where running a UI build in this way failed due to a missing timeout argument error.

### 1.0.0-beta.75 - 2021-01-28

### Changed
- Default UI build timeout is now 180 seconds.
- The hyperglass `build-ui` CLI command now accepts a `--timeout` argument to override the UI build timeout.

### 1.0.0-beta.74 - 2021-01-25

### Changed
- The Scrapli driver no longer specifically ignores the system's SSH config file.
- Updated UI dependencies.

### Fixed
- [#109](https://github.com/thatmattlove/hyperglass/issues/109): Remove the custom error page, because it doesn't work and doesn't really add much.

### 1.0.0-beta.73 - 2021-01-18

### Added
- [#106](https://github.com/thatmattlove/hyperglass/issues/106): Add built-in support for Nokia SR OS (thanks @paunadeu!).

### Changed
- [#105](https://github.com/thatmattlove/hyperglass/issues/105): Check NodeJS version on startup to ensure the minimum supported version is present.
- Update UI dependencies.

### Fixed
- [#107](https://github.com/thatmattlove/hyperglass/issues/107): Fix footer menu styling so it doesn't overflow the viewport, especially on mobile.

### 1.0.0-beta.72 - 2021-01-16

### Fixed
- [#104](https://github.com/thatmattlove/hyperglass/issues/104): Handle the usage of `juniper_junos` as a NOS. `juniper_junos` will now automatically be mapped to `juniper`.
- Fix an issue with dual RP juniper devices and structured output, where output containing `{master}` outside of the XML output was improperly stripped out, causing a parsing failure.

### Changed
- **BREAKING**: The installer no longer generates a Systemd service file. While this was likely convenient for most, it introduced significant complexity and caused most installations using `~/hyperglass` as the app path to fail, with no clear way to resolve it. Further, while Systemd is arguably the most common, it is not the *only* process manager available. As such, the docs will be updated with a Systemd example, much like the current reverse proxy documentation.

### 1.0.0-beta.71 - 2021-01-10

### Added
- Added Google Analytics Support. Use the `google_analytics` field for the tracking ID in `hyperglass.yaml`.

### Changed
- Minor frontend code improvements.

### 1.0.0-beta.70 - 2021-01-05

### Fixed

- [#100](https://github.com/thatmattlove/hyperglass/issues/100): Fix result panel bug where incorrect panels would open, or panels would not open at all. Resolved by accessing internal state of the `Accordion />` component via `useAccordionContext()` instead of directly changing the index prop via state.

### Changed
- Query results now automatically cancel when each result panel unmounts (e.g. when one clicks the back button).

### 1.0.0-beta.69 - 2021-01-03

### Fixed

- Fix Safari browser-specific issues
- Setup no longer fails when `commands.yaml` doesn't exist, even though it isn't needed.

### Changed

- Setup no longer adds example files

### 1.0.0-beta.67 - 2021-01-02

### Fixed

- Fix handling of `web.theme.default_color_mode`. Starting in 1.0.0-beta.65, it was completely ignored and used the library's default of `light`. Now, it's handled properly.
- Fix table output layout issues, particularly on mobile.

### 1.0.0-beta.66 - 2021-01-02

### Fixed

- Fixed Safari browser-specific issues
- Fixed mobile layout issues

### Changed

- `web.theme.colors.black` and `web.theme.colors.white` are now `web.theme.colors.dark` and `web.theme.colors.light respectively`

### 1.0.0-beta.65 - 2021-01-01

### Added

- [#72](https://github.com/thatmattlove/hyperglass/issues/72): _EXPERIMENTAL_ BGP map support for devices supporting structured output (Juniper Junos, currently).

### Fixed

- Fix an issue causing Juniper Junos BGP output parsing to fail if the XML output contains a banner.

### Changed

- `web.text.title` and `web.text.subtitle` now carry a 32 character limit for simpler styling.
- Various UI layout, styling improvements, and stability improvements.

### 1.0.0-beta.63 - 2020-10-18

### Added

- [#87](https://github.com/thatmattlove/hyperglass/issues/87): [TNSR] Support. To add a TNSR device, use the `tnsr` [NOS key](https://hyperglass.dev/docs/adding-devices#all-device-parameters).

### Fixed

- Fix an issue causing hyperglass custom exceptions to not be properly raised, which caused more generic error messages in the UI/API.

### 1.0.0-beta.62 - 2020-10-17

### Fixed

- Fix an issue causing exceptions not to be logged to the log file (but logged to stdout).

### 1.0.0-beta.61 - 2020-10-11

### POTENTIALLY BREAKING CHANGE

When hyperglass starts up, it will check to see if `~/hyperglass` or `/etc/hyperglass/` exists. Previously, it would silently choose the first one found, even if both exist. Now, if both exist, an exception is raised with instruction to delete one of them. If your system has both directories, hyperglass may not start up normally after you upgrade.

### Fixed

- Fix a DNS resolution issue which caused Debian systems to be unable to resolve the hostnames of any devices. This was due to differences in how the Python socket module works on Debian vs other distros (even Ubuntu).

### Added

- [#81](https://github.com/thatmattlove/hyperglass/issues/81): Add support for SSH key authentication. See [the docs](https://hyperglass.dev/docs/adding-devices#credential) for more details.

### 1.0.0-beta.60 - 2020-10-10

### Fixed

- [#90](https://github.com/thatmattlove/hyperglass/issues/90): Fix a typing error that caused ping & traceroute queries to fail for certain devices.

### Added

- [#82](https://github.com/thatmattlove/hyperglass/issues/82): Add support for Redis password authentication. Authentication can be configured in the following manner:

```yaml
# hyperglass.yaml
cache:
  password: examplepassword
```

This would correspond with the following stanza in the Redis configuration file:

```
requirepass examplepassword
```

### 1.0.0-beta.59 - 2020-10-05

### Added

- Native Mikrotik support.
- `hyperglass clear-cache` command for easy manual clearing of the Redis cache.

### Changed

- Improve output parsing scalability - parsers can now be defined on a per-NOS basis regardless of whether or not structured-data is used.
- Restructure model locations & importing to remove some complexities.

### 1.0.0-beta.58 - 2020-09-28

### Changed

- [#79](https://github.com/thatmattlove/hyperglass/issues/79): Run the UI build on startup & clarify docs.
- Removed all f-strings from log messages.
- Migrate icon library to [@meronex/icons](https://github.com/meronex/meronex-icons) for better tree-shaking.
- Improve console (stdout) logging
- Fix file logging format

### Fixed

- [#74](https://github.com/thatmattlove/hyperglass/issues/74): Fix UI build failures caused by `.alias.js`.
- [#75](https://github.com/thatmattlove/hyperglass/issues/75): Fix whitespace stripping of query target.
- [#77](https://github.com/thatmattlove/hyperglass/issues/77): Allow dashes in FQDN validation pattern.
- [#83](https://github.com/thatmattlove/hyperglass/issues/83): Fix lack of support for `protocol-nh` field in Juniper XML BGP table.

### 1.0.0-beta.57 - 2020-07-30

### BREAKING CHANGE

If you use [hyperglass-agent](https://github.com/thatmattlove/hyperglass-agent), you must upgrade your version of hyperglass-agent to 0.1.6 or later. If using hyperglass-agent with SSL, this release will require you to re-generate & re-send your SSL certificates to hyperglass:

```console
$ hyperglass-agent certificate
$ hyperglass-agent send-certificate
```

### Changed

- Verify a device's address is either an IPv4 or IPv6 address, or a resolvable hostname.
- Devices using hyperglass-agent (FRR, BIRD) no longer need to use a DNS-resolvable hostname in the `address:` field, as long as the certificate has been generated by hyperglass-agent, and the proper IP addresses were selected during the prompts to generate the certificate. _If using your own certificate and you want to connect to hyperglass-agent via an IP address instead of a hostname, you need to ensure the IP address of hyperglass-agent is listed as a Subject Alternative Name in the certificate extensions._
- Refactored device, query, proxy models to no longer scrub unsupported characters from the device name for the purposes of Python class attribute accessing.
- Updated hyperglass-agent docs.

### 1.0.0-beta.56 - 2020-07-28

### Changed

- Improved Gunicorn address formatting.
- Improved Redis connection error handling.

### Fixed

- [#56](https://github.com/thatmattlove/hyperglass/issues/56): Fix a silent Redis connection error if the Redis server was anything other than `localhost`, preventing hyperglass from starting.

### 1.0.0-beta.55 - 2020-07-27

### Changed

- Removed JS favicon build process in favor of native Python implementation ([favicons](https://github/thatmattlove/favicons))

### 1.0.0-beta.54 - 2020-07-25

### Fixed

- Queries to hyperglass-agent devices failed due to the error `AttributeError: 'AgentConnection' object has no attribute 'collect'`

### 1.0.0-beta.53 - 2020-07-23

### Added

- **BREAKING CHANGE**: [Scrapli](https://github.com/carlmontanari/scrapli) is now used for SSH connectivity to Cisco IOS, Cisco IOS-XE, Cisco IOS-XR, Cisco NX-OS Juniper Junos, and Arista EOS, which should improve the speed at which output is gathered from devices. _As of this release, Cisco IOS/IOS-XE and Juniper Junos have been directly tested and worked without issue. However, if you discover any anomalies with any of these operating systems, please [open an issue](https://github.com/thatmattlove/hyperglass/issues)._

### Changed

- Refactor of SSH & HTTPS command execution to enable pluggable underlying driver capabilities.
- Remove `aiofile` dependency by removing unnecessary asyncio file operations in the UI build process.
- Added `scrapli[asyncssh]` dependency for Scrapli driver support.

### Fixed

- UI: Error messages couldn't be copied with the copy button

### 1.0.0-beta.52 - 2020-07-19

### Added

- API route `/api/info`, which displays general system information such as the name of the organization and version of hyperglass.
- API docs configuration parameters for the `/api/info` route.
- [#63](https://github.com/thatmattlove/hyperglass/issues/63): Minimum RAM requirements.
- `hyperglass system-info` CLI command to gather system CPU, Memory, Disk, Python Version, hyperglass Version, & OS info. _Note: this information is only gathered if you run the command, and even then, is printed to the console and not otherwise shared or exported_.

### Changed

- Updated docs dependencies.
- Improved YAML alias & anchor docs.
- [#55](https://github.com/thatmattlove/hyperglass/issues/55): Removed YAML alias & anchors from default examples to avoid confusion.

### Fixed

- API docs logo URL now displays correctly.
- [#62](https://github.com/thatmattlove/hyperglass/issues/62): Added `epel-release` to CentOS installation instructions.
- [#59](https://github.com/thatmattlove/hyperglass/issues/59): Fixed copy output for Juniper devices on non-table output query types.
- [hyperglass-agent #6](https://github.com/hyperglass-agent/issues/6): Fixed hyperglass-agent documentation issues.
- Improve command customization docs.
- [#61](https://github.com/thatmattlove/hyperglass/issues/61): Fixed copy output for table data. Output is now a bulleted list of parsed data.

### 1.0.0-beta.51 - 2020-07-13

### Changed

- Improved config import process & error handling.
- Improved logging initialization so that noisy logs aren't generated on startup unless debugging is enabled.

### Fixed

- [#54](https://github.com/thatmattlove/hyperglass/issues/54): A Junos parsing error caused routes with no communities to raise an error.
- Pre-validated config files are no longer logged on startup unless debugging is enabled.

### 1.0.0-beta.50 - 2020-07-12

### Added

- Synchronous API for Redis caching.
- New `redis-py` dependency for synchronous Redis communication.

### Changed

- Improved cache type conversion when reading cached data.
- External data via [bgp.tools](https://bgp.tools) is now gathered via their bulk mode API.
- External data via [bgp.tools](https://bgp.tools) is now cached via Redis to reduce external traffic and improve performance.
- RPKI validation via [Cloudflare](https://rpki.cloudflare.com/) is now cached via Redis to reduce external traffic and improve performance.
- Update Python dependencies.

### Fixed

- [#54](https://github.com/thatmattlove/hyperglass/issues/54): A Junos structured/table output parsing error caused routes with multiple next-hops to raise an error.
- RPKI validation no longer occurs twice (once on serialization of the output, once on validation of the API response).

### 1.0.0-beta.49 - 2020-07-05

### Changed

- Update UI dependencies
- Removed react-textfit in favor of responsive font sizes and line breaking
- Refactor & clean up React components

### Fixed

- Route lookups for private (RFC 1918) addresses failed due to an unnecessary lookup to [bgp.tools](https://bgp.tools)

### 1.0.0-beta.48 - 2020-07-04

### Added

- New NOS: **VyOS**. [See docs for important caveats](https://hyperglass.dev/docs/commands).

### Fixed

- UI: If the logo `width` parameter was set to ~ 50% and the `title_mode` was set to `logo_subtitle`, the subtitle would appear next to the logo instead of underneath.
- When copying the opengraph image, the copied image was not deleted.
- Default traceroute help link now _actually_ points to the new docs site.

### 1.0.0-beta.47 - 2020-07-04

### Added

- Opengraph images are now automatically generated in the correct format from any valid image file.
- Better color mode toggle icons (they now match [hyperglass.dev](https://hyperglass.dev)).

### Changed

- Improved SEO & Accessibility for UI.
- Default traceroute help link now points to new docs site.
- Slightly different default black & white colors (they now match [hyperglass.dev](https://hyperglass.dev)).
- Various docs site improvements

### Fixed

- Remove `platform.linux_distribution()` which was removed in Python 3.8
- Width of page is no longer askew when `logo_subtitle` is set as the `title_mode`
- Generated favicon manifest files now go to the correct directory.
- Various docs site fixes

### 1.0.0-beta.46 - 2020-06-28

### Added

- Support for hyperglass-agent [0.1.5](https://github.com/thatmattlove/hyperglass-agent)

### 1.0.0-beta.45 - 2020-06-27

### Changed

- Removed RIPEStat for external data gathering, switched to [bgp.tools](https://bgp.tools)

### Fixed

- Webhook construction bugs that caused webhooks not to send
- Empty response handling for table output

### 1.0.0-beta.44 - 2020-06-26

### Added

- Support for Microsoft Teams webhook

### Fixed

- If webhooks were enabled, a hung test connection to RIPEStat would cause the query to time out

### 1.0.0-beta.43 - 2020-06-22

### Fixed

- Logo path handling in UI

### 1.0.0-beta.42 - 2020-06-21

### Added

- Automatic favicon generation

### Changed

- **BREAKING CHANGE**: The `logo` section now requires the full path for logo files. See [the docs](https://hyperglass.dev/docs/ui/logo) for details.
