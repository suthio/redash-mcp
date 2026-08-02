# Redash MCP Server

Model Context Protocol (MCP) server for integrating Redash with AI assistants like Claude.

<a href="https://glama.ai/mcp/servers/j9bl90s3tw">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/j9bl90s3tw/badge" alt="Redash Server MCP server" />
</a>

## Features

- Connect to Redash instances via the Redash API
- List available queries and dashboards as resources
- Execute queries and retrieve results
- Execute saved parameterized queries with typed values and saved defaults
- Create and manage queries (create, update, archive)
- Manage query parameters, dashboard parameters, and widget parameter mappings
- Inspect and update dashboard widget layouts and grid positions
- List data sources for query creation
- Get dashboard details and visualizations
- Update chart visualization options with Redash chart-specific settings

## Prerequisites

- Node.js (v20 or later)
- pnpm
- Access to a Redash instance
- Redash API key

## Environment Variables

The server requires the following environment variables:

- `REDASH_URL`: Your Redash instance URL (e.g., https://redash.example.com)
- `REDASH_API_KEY`: Your Redash API key

Optional variables:
- `REDASH_TIMEOUT`: Timeout for API requests in milliseconds (default: 30000)
- `REDASH_MAX_RESULTS`: Maximum number of results to return (default: 1000)
- `REDASH_EXTRA_HEADERS`: Extra HTTP headers to include with every Redash request. Accepts either a JSON object string or a semicolon/comma-separated list of `key=value` pairs.
- `REDASH_SOCKS_PROXY`: SOCKS proxy URL for routing requests through a proxy (e.g., `socks5h://localhost:1080`). Use `socks5h://` (with `h`) to delegate DNS resolution to the proxy, which is required for internal hostnames that don't resolve on the local machine.
- `MCP_TRANSPORT`: MCP transport to use. Supported values are `stdio`, `http`, and `streamable-http` (default: `stdio`).
- `MCP_HTTP_HOST`: Host for Streamable HTTP mode (default: `127.0.0.1`).
- `MCP_HTTP_PORT`: Port for Streamable HTTP mode (default: `3000`).
- `MCP_HTTP_PATH`: Streamable HTTP endpoint path (default: `/mcp`).
- `MCP_HTTP_ALLOWED_HOSTS`: Comma-separated Host header allowlist for Streamable HTTP mode. Values are hostnames without a scheme, port, path, or wildcard.
- `MCP_HTTP_ALLOWED_ORIGINS`: Comma-separated browser Origin hostname allowlist. Values use the same hostname-only format and also control CORS responses. Set an empty value to reject every request that includes an `Origin` header.

Examples:

JSON (recommended):
```
REDASH_EXTRA_HEADERS='{"CF-Access-Client-Id":"<client_id>","CF-Access-Client-Secret":"<client_secret>"}'
```

Key/value list:
```
REDASH_EXTRA_HEADERS=CF-Access-Client-Id=<client_id>;CF-Access-Client-Secret=<client_secret>
```

Notes:
- The `Authorization` header is managed by the server (`Key <REDASH_API_KEY>`) and cannot be overridden.
- All extra headers are added to every request made to Redash.

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/suthio/redash-mcp.git
   cd redash-mcp
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Create a `.env` file with your Redash configuration:
   ```
   REDASH_URL=https://your-redash-instance.com
   REDASH_API_KEY=your_api_key
   # Optional: Cloudflare Access (or other gateway) headers
   # REDASH_EXTRA_HEADERS='{"CF-Access-Client-Id":"<client_id>","CF-Access-Client-Secret":"<client_secret>"}'
   ```

4. Build the project:
   ```bash
   pnpm run build
   ```

5. Start the server:
   ```bash
   pnpm start
   ```

   The default transport is stdio, which is the mode expected by most desktop MCP clients. The stdio entrypoint accepts both 2025-era MCP clients and clients that negotiate the current protocol.

## Usage with Claude for Desktop

To use this MCP server with Claude for Desktop, configure it in your Claude for Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following configuration (edit paths as needed):

```json
{
  "mcpServers": {
    "redash": {
      "command": "npx",
      "args": [
         "-y",
         "@suthio/redash-mcp"
      ],
      "env": {
        "REDASH_API_KEY": "your-api-key",
        "REDASH_URL": "https://your-redash-instance.com"
      }
    }
  }
}
```

## Streamable HTTP Transport

The server can also run as a stateless Streamable HTTP MCP server. The HTTP entrypoint is a Hono application served by `@hono/node-server`; environment variables configure the listener:

```bash
REDASH_URL=https://your-redash-instance.com \
REDASH_API_KEY=your_api_key \
MCP_TRANSPORT=http \
pnpm start
```

This starts `POST http://127.0.0.1:3000/mcp` by default. CLI flags override environment variables:

```bash
REDASH_URL=https://your-redash-instance.com \
REDASH_API_KEY=your_api_key \
pnpm start --transport http --host 127.0.0.1 --port 3333 --path /mcp
```

For a non-local bind behind an authenticated, TLS-terminating reverse proxy, explicitly configure which request hosts and browser origins may reach the server. The equivalent CLI options are `--allowed-hosts` and `--allowed-origins`.

```bash
REDASH_URL=https://redash.example.com \
REDASH_API_KEY=your_api_key \
MCP_TRANSPORT=http \
MCP_HTTP_HOST=0.0.0.0 \
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
MCP_HTTP_ALLOWED_ORIGINS=app.example.com \
pnpm start
```

| Who uses the server | MCP URL | Allowed Host header | Allowed browser Origin |
| --- | --- | --- | --- |
| Local MCP client | `http://127.0.0.1:3000/mcp` | `127.0.0.1` | `localhost`, `127.0.0.1`, `[::1]` |
| Local Docker client | `http://localhost:3000/mcp` | `localhost` | `localhost`, `127.0.0.1`, `[::1]` |
| Browser app at `https://app.example.com` through an authenticated reverse proxy | `https://mcp.example.com/mcp` | `mcp.example.com` | `app.example.com` |

Host and Origin matching is case-insensitive and port-agnostic. For example, allowing `app.example.com` accepts the browser Origin `https://app.example.com:8443`. In HTTP mode, binding `MCP_HTTP_HOST` to a non-local address fails at startup unless both allowlist settings are explicitly present.

Host and Origin allowlists protect against DNS rebinding and unwanted browser origins; they do not authenticate MCP clients. Do not expose the server listener directly to the internet. For `https://mcp.example.com/mcp`, keep the listener on a private network and require authentication at the reverse proxy or gateway.

HTTP mode is stateless: the server does not issue `Mcp-Session-Id`, does not provide a standalone GET SSE stream, and handles each `POST /mcp` with a fresh MCP server instance. Both current MCP clients and 2025-era Streamable HTTP clients use that same URL. `GET /mcp` and `DELETE /mcp` return `405 Method Not Allowed`.

The default bind is localhost-only (`127.0.0.1`) with Host and Origin protection. Browser requests from allowed origins receive CORS response headers; other origins are rejected with `403 Forbidden`.

The CLI handles `SIGINT` and `SIGTERM` gracefully. For example, `docker stop` sends `SIGTERM`; the server closes active MCP streams and then waits for the HTTP listener to stop before the process exits.

## Docker

Container images are published to GitHub Container Registry for both `linux/amd64` and `linux/arm64`.

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  -e REDASH_URL=https://your-redash-instance.com \
  -e REDASH_API_KEY=your_api_key \
  ghcr.io/suthio/redash-mcp:latest
```

The container runs Streamable HTTP internally on `0.0.0.0:3000`, while the example publishes that port on the host's loopback interface only. Its default Host and Origin allowlists accept localhost access. When placing the container behind an authenticated reverse proxy or a private cluster service, set `MCP_HTTP_ALLOWED_HOSTS` and `MCP_HTTP_ALLOWED_ORIGINS` to the concrete DNS names used by clients.
Published images are signed with keyless cosign.

## Available Tools

### Query Management
- `list_queries`: List all available queries in Redash
- `get_query`: Get details of a specific query
- `create_query`: Create a new query in Redash
- `update_query`: Update an existing query in Redash
- `get_query_parameters`: Inspect saved query parameter definitions
- `update_query_parameters`: Update saved query parameter definitions
- `archive_query`: Archive (soft-delete) a query
- `list_data_sources`: List all available data sources

### Query Execution
- `execute_query`: Execute a query and return results, with optional `maxAge`
- `execute_parameterized_query`: Execute a saved parameterized query with type-aware value coercion, saved defaults, and optional `maxAge`
- `execute_adhoc_query`: Execute an ad-hoc query without saving it to Redash
- `get_query_results_csv`: Get query results in CSV format (supports optional refresh for latest data)

### Dashboard Management
- `list_dashboards`: List all available dashboards
- `get_dashboard`: Get dashboard details and visualizations
- `get_dashboard_layout`: Inspect widget positions, sizes, and visibility on a dashboard
- `get_visualization`: Get details of a specific visualization
- `get_dashboard_parameters`: Inspect dashboard parameter values and widget mappings
- `update_dashboard_parameters`: Update dashboard parameter values and order
- `update_dashboard_layout`: Move or resize multiple widgets in one call
- `update_widget_layout`: Move or resize a single widget
- `get_widget_parameter_mappings`: Inspect a widget's parameter mappings
- `update_widget_parameter_mappings`: Update a widget's parameter mappings

### Visualization Management
- `create_visualization`: Create a new visualization for a query
- `update_visualization`: Update an existing visualization
- `update_chart_visualization`: Patch chart-specific options like `globalSeriesType`, `columnMapping`, `seriesOptions`, `legend`, and axis settings
- `delete_visualization`: Delete a visualization

## Development

Run in development mode:
```bash
pnpm run dev
```

## Testing

### Unit Tests

```bash
pnpm test
```

### E2E Tests

```bash
pnpm run e2e:test
```

E2E tests use these default values (can be overridden with environment variables):
- `REDASH_URL`: https://demo.redash.io
- `REDASH_API_KEY`: test_api_key

Override example:
```bash
REDASH_URL=https://your-instance.com REDASH_API_KEY=your_key pnpm run e2e:test
```

### Manual Testing

```bash
pnpm run inspector
```

## Version History

- v1.1.0: Added query management functionality (create, update, archive)
- v1.0.0: Initial release

## License

MIT
