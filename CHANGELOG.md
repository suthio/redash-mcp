# Changelog

## [v0.0.16](https://github.com/suthio/redash-mcp/compare/v0.0.15...v0.0.16) - 2026-08-07

- Reuse Redash request error formatting by @kahirokunn in https://github.com/suthio/redash-mcp/pull/77
- Correct the ad hoc query tool description by @kahirokunn in https://github.com/suthio/redash-mcp/pull/79
- chore(deps-dev): bump ts-jest from 29.4.11 to 29.4.12 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/82
- chore(deps): bump @opentelemetry/host-metrics from 0.38.3 to 0.39.0 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/85
- chore(deps-dev): bump @playwright/test from 1.60.0 to 1.62.1 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/89
- chore(deps): bump hono from 4.12.33 to 4.12.34 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/92
- chore(deps-dev): bump jest and @types/jest by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/87
- chore(deps-dev): bump @jest/globals from 29.7.0 to 30.4.1 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/91
- chore(deps): bump actions/setup-node from 6 to 7 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/83
- chore(deps): bump actions/checkout from 6 to 7 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/84
- Require Node 22.13 and pnpm 11 by @kahirokunn in https://github.com/suthio/redash-mcp/pull/78
- Prevent OOM when reading large BigQuery schemas by @kahirokunn in https://github.com/suthio/redash-mcp/pull/80
- Remove RedashClient.getSchema by @kahirokunn in https://github.com/suthio/redash-mcp/pull/81

## [v0.0.15](https://github.com/suthio/redash-mcp/compare/v0.0.14...v0.0.15) - 2026-08-03

- Add npm metadata for source and issues by @wowsofine in https://github.com/suthio/redash-mcp/pull/61
- Allow disabling apply_auto_limit in execute_adhoc_query (fixes #58) by @suthio in https://github.com/suthio/redash-mcp/pull/59
- chore(deps): bump actions/setup-node from 4 to 6 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/44
- Refresh security-sensitive runtime dependencies by @suthio in https://github.com/suthio/redash-mcp/pull/71
- chore(deps): bump actions/checkout from 4 to 6 by @dependabot[bot] in https://github.com/suthio/redash-mcp/pull/45
- Make npm publishing single-path and rerunnable by @suthio in https://github.com/suthio/redash-mcp/pull/72
- Publish npm releases with trusted OIDC by @suthio in https://github.com/suthio/redash-mcp/pull/73
- Preserve the CLI entry with npm 11 by @suthio in https://github.com/suthio/redash-mcp/pull/74
- fix: normalize repository metadata before npm publish by @suthio in https://github.com/suthio/redash-mcp/pull/75
- Migrate package management to pnpm by @kahirokunn in https://github.com/suthio/redash-mcp/pull/62
- fix: add type-safe schedule schema with day_of_week default by @ryo-imai-bit in https://github.com/suthio/redash-mcp/pull/69
- Add streamable HTTP transport by @kahirokunn in https://github.com/suthio/redash-mcp/pull/63
- Add OpenTelemetry observability by @kahirokunn in https://github.com/suthio/redash-mcp/pull/76

## [v0.0.14](https://github.com/suthio/redash-mcp/compare/v0.0.13...v0.0.14) - 2026-07-31
- Add tools for query parameters, widget layout, and chart config by @noaahh in https://github.com/suthio/redash-mcp/pull/57

## [v0.0.13](https://github.com/suthio/redash-mcp/compare/v0.0.12...v0.0.13) - 2026-03-26
- Add get_dashboard_by_slug tool for slug-based dashboard lookup by @ryo-imai-bit in https://github.com/suthio/redash-mcp/pull/41
- Add Dependabot for automated npm and GitHub Actions updates by @suthio in https://github.com/suthio/redash-mcp/pull/37

## [v0.0.12](https://github.com/suthio/redash-mcp/compare/v0.0.11...v0.0.12) - 2026-03-19
- Add npm publish to tagpr workflow by @suthio in https://github.com/suthio/redash-mcp/pull/38

## [v0.0.11](https://github.com/suthio/redash-mcp/compare/v0.0.10...v0.0.11) - 2026-03-09
- Add SOCKS proxy support by @suthio in https://github.com/suthio/redash-mcp/pull/34
- fix: use z.coerce.number() to handle string-typed numeric params from MCP clients by @strotgen in https://github.com/suthio/redash-mcp/pull/35

## [v0.0.10](https://github.com/suthio/redash-mcp/compare/v0.0.9...v0.0.10) - 2026-03-05
- Fix API key leakage in error logs (fixes #1) by @deemoowoor in https://github.com/suthio/redash-mcp/pull/32

## [v0.0.9](https://github.com/suthio/redash-mcp/compare/v0.0.8...v0.0.9) - 2026-02-07
- Add Dashboard, Alert, Widget, Query Snippet APIs by @dtaniwaki in https://github.com/suthio/redash-mcp/pull/27

## [v0.0.8](https://github.com/suthio/redash-mcp/compare/v0.0.7...v0.0.8) - 2026-01-13
- Add tests by @dtaniwaki in https://github.com/suthio/redash-mcp/pull/25

## [v0.0.7](https://github.com/suthio/redash-mcp/compare/v0.0.6...v0.0.7) - 2026-01-07
- Support custom HTTP headers via REDASH_EXTRA_HEADERS by @suthio in https://github.com/suthio/redash-mcp/pull/23

## [v0.0.6](https://github.com/suthio/redash-mcp/compare/v0.0.5...v0.0.6) - 2025-11-26
- feat: Add CSV export support for query results by @suthio in https://github.com/suthio/redash-mcp/pull/20

## [v0.0.5](https://github.com/suthio/redash-mcp/compare/v0.0.4...v0.0.5) - 2025-11-05
- Add get_schema tool by @winebarrel in https://github.com/suthio/redash-mcp/pull/19

## [v0.0.4](https://github.com/suthio/redash-mcp/commits/v0.0.4) - 2025-08-16
- add MCP server badge by @punkpeye in https://github.com/suthio/redash-mcp/pull/1
- Update naming convention from kebab-case to snake_case by @suthio in https://github.com/suthio/redash-mcp/pull/3
- (feat) add search to the `list_queries` tool by @wncm in https://github.com/suthio/redash-mcp/pull/4
- Fix: Expose error details from executeQuery and pollQueryResults (#7) by @suthio in https://github.com/suthio/redash-mcp/pull/8
- feat: Add execute_adhoc_query tool for temporary query execution by @tera911 in https://github.com/suthio/redash-mcp/pull/9
- feat: Add tagpr for automated version management and npm publishing by @suthio in https://github.com/suthio/redash-mcp/pull/10
- Add Visualization Management Tools by @tera911 in https://github.com/suthio/redash-mcp/pull/11
- Release for v0.0.4 by @github-actions[bot] in https://github.com/suthio/redash-mcp/pull/13

## [v0.0.4](https://github.com/suthio/redash-mcp/commits/v0.0.4) - 2025-08-16
- add MCP server badge by @punkpeye in https://github.com/suthio/redash-mcp/pull/1
- Update naming convention from kebab-case to snake_case by @suthio in https://github.com/suthio/redash-mcp/pull/3
- (feat) add search to the `list_queries` tool by @wncm in https://github.com/suthio/redash-mcp/pull/4
- Fix: Expose error details from executeQuery and pollQueryResults (#7) by @suthio in https://github.com/suthio/redash-mcp/pull/8
- feat: Add execute_adhoc_query tool for temporary query execution by @tera911 in https://github.com/suthio/redash-mcp/pull/9
- feat: Add tagpr for automated version management and npm publishing by @suthio in https://github.com/suthio/redash-mcp/pull/10
- Add Visualization Management Tools by @tera911 in https://github.com/suthio/redash-mcp/pull/11
