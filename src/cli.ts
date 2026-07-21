#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import * as path from 'path';

// Check if .env file exists in current directory and load it
const envPath = path.join(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

// Import application modules only after .env has been loaded. The startup
// module initializes OpenTelemetry before it imports Axios and the MCP server,
// and performs required-environment-variable validation (including the
// stdio-vs-http REDASH_API_KEY distinction; see startup.ts).
const { runConfiguredServerCli } = await import('./startup.js');
await runConfiguredServerCli();
