# Redash MCP Server

Model Context Protocol (MCP) server for integrating Redash with AI assistants like Claude.

<a href="https://glama.ai/mcp/servers/j9bl90s3tw">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/j9bl90s3tw/badge" alt="Redash Server MCP server" />
</a>

## Features

- Connect to Redash instances via the Redash API
- List available queries and dashboards as resources
- Execute queries and retrieve results
- Create and manage queries (create, update, archive)
- List data sources for query creation
- Get dashboard details and visualizations

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
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
   npm install
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
   npm run build
   ```

5. Start the server:
   ```bash
   npm start
   ```

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

## Available Tools

### Query Management
- `list-queries`: List all available queries in Redash
- `get-query`: Get details of a specific query 
- `create-query`: Create a new query in Redash
- `update-query`: Update an existing query in Redash
- `archive-query`: Archive (soft-delete) a query
- `list-data-sources`: List all available data sources

### Query Execution
- `execute-query`: Execute a query and return results
- `execute-adhoc-query`: Execute an ad-hoc query without saving it to Redash
- `get-query-results-csv`: Get query results in CSV format (supports optional refresh for latest data)

### Dashboard Management
- `list-dashboards`: List all available dashboards
- `get-dashboard`: Get dashboard details and visualizations 
- `get-visualization`: Get details of a specific visualization

### Visualization Management
- `create-visualization`: Create a new visualization for a query
- `update-visualization`: Update an existing visualization
- `delete-visualization`: Delete a visualization

## Development

Run in development mode:
```bash
npm run dev
```

## Version History

- v1.1.0: Added query management functionality (create, update, archive)
- v1.0.0: Initial release

## License

MIT
